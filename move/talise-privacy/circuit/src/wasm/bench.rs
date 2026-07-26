//! MEASUREMENT ONLY — wasm exports that exist so `test/wasm_bench.mjs` can
//! apportion the 5.7-second browser prove into its stages, and so the
//! "ship the proving key uncompressed" recommendation in `CEREMONY.md` §5 rests
//! on a measured number rather than an argument.
//!
//! Nothing in the product calls these. `wasm::prove`/`verify`/
//! `build_deposit_input` are unchanged.
//!
//! WHY SEPARATE EXPORTS INSTEAD OF TIMING INSIDE RUST: `std::time::Instant`
//! panics on `wasm32-unknown-unknown`. So each stage is its own export and JS
//! holds the stopwatch.
//!
//! THE FINDING these exist to prove: the shipped `proving_key.bin` is
//! arkworks-*compressed*, so every curve point stores only `x` and loading the
//! key costs one modular square root per point to recover `y` — tens of
//! thousands of them. Natively that is ~674 ms against a ~147 ms prove
//! (`bench_prove.rs`). The same key served UNCOMPRESSED (2× the bytes, cached
//! once in IndexedDB) deserializes in ~3.7 ms natively. These exports let us
//! confirm the same ratio holds in wasm, where it matters.

use ark_bn254::Bn254;
use ark_groth16::ProvingKey;
use ark_serialize::{CanonicalSerialize, Compress, Validate};
use wasm_bindgen::prelude::*;

use ark_serialize::CanonicalDeserialize;

fn load(hex_str: &str, compress: Compress, validate: Validate) -> Result<ProvingKey<Bn254>, JsValue> {
    let bytes = hex::decode(hex_str.trim())
        .map_err(|e| JsValue::from_str(&format!("hex decode failed: {e}")))?;
    ProvingKey::<Bn254>::deserialize_with_mode(&bytes[..], compress, validate)
        .map_err(|e| JsValue::from_str(&format!("proving key deserialize failed: {e}")))
}

/// Number of G1 + G2 points in the proving key — the thing stage-2 cost scales
/// with. Returned so JS can print it and so the compiler cannot elide the load.
fn point_count(pk: &ProvingKey<Bn254>) -> u32 {
    (pk.a_query.len()
        + pk.b_g1_query.len()
        + pk.b_g2_query.len()
        + pk.h_query.len()
        + pk.l_query.len()
        + pk.vk.gamma_abc_g1.len()) as u32
}

/// Stage 2 as `prove()` does it today: hex-decode + compressed deserialize with
/// full validation. Returns the key's point count.
#[wasm_bindgen]
pub fn bench_load_pk_compressed(proving_key_hex: &str) -> Result<u32, JsValue> {
    Ok(point_count(&load(
        proving_key_hex,
        Compress::Yes,
        Validate::Yes,
    )?))
}

/// Same, skipping subgroup validation. Isolates how much of stage 2 is the
/// subgroup check versus the point decompression.
#[wasm_bindgen]
pub fn bench_load_pk_compressed_unchecked(proving_key_hex: &str) -> Result<u32, JsValue> {
    Ok(point_count(&load(
        proving_key_hex,
        Compress::Yes,
        Validate::No,
    )?))
}

/// Stage 2 if the key were served UNCOMPRESSED. Expects hex of an
/// arkworks-uncompressed proving key (see `bench_recompress_pk_uncompressed`).
#[wasm_bindgen]
pub fn bench_load_pk_uncompressed(proving_key_hex: &str) -> Result<u32, JsValue> {
    Ok(point_count(&load(
        proving_key_hex,
        Compress::No,
        Validate::No,
    )?))
}

// ---------------------------------------------------------------------------
// Isolating the prove itself: cache the deserialized key, then prove repeatedly.
//
// Today's `prove(input_json, proving_key_hex)` re-does stages 1–2 on EVERY call
// because the key crosses the boundary as hex each time. A worker that
// deserialized once and kept the `ProvingKey` would pay stage 2 only on the
// first proof. These two exports measure that architecture so the difference is
// a number, not a hunch.
// ---------------------------------------------------------------------------

use crate::wasm::ProofOutput;
use ark_bn254::Fr;
use ark_crypto_primitives::snark::SNARK;
use ark_ff::{BigInteger, PrimeField};
use ark_groth16::Groth16;
use core::cell::RefCell;
use rand::rngs::OsRng;

thread_local! {
    static CACHED_PK: RefCell<Option<ProvingKey<Bn254>>> = const { RefCell::new(None) };
}

/// Deserialize the compressed proving key ONCE and keep it. Time this call to
/// get the one-off stage-2 cost.
#[wasm_bindgen]
pub fn bench_cache_pk(proving_key_hex: &str) -> Result<u32, JsValue> {
    let pk = load(proving_key_hex, Compress::Yes, Validate::Yes)?;
    let n = point_count(&pk);
    CACHED_PK.with(|c| *c.borrow_mut() = Some(pk));
    Ok(n)
}

/// Prove a representative deposit against the cached key — stages 3 + 4 only,
/// no key reload. Returns the same JSON shape as `wasm::prove`, so
/// `wasm::verify` can check it.
#[wasm_bindgen]
pub fn bench_prove_deposit_cached(amount: u64, out0: u64, out1: u64) -> Result<String, JsValue> {
    CACHED_PK.with(|c| {
        let borrowed = c.borrow();
        let pk = borrowed
            .as_ref()
            .ok_or_else(|| JsValue::from_str("call bench_cache_pk first"))?;

        let vortex = crate::prover::pool_address_to_field("0x1")
            .map_err(|e| JsValue::from_str(&format!("pool: {e}")))?;
        let root = Fr::from(0u64);
        let (circuit, _notes) =
            crate::prover::build_deposit_circuit_for_pool(vortex, root, amount, out0, out1)
                .map_err(|e| JsValue::from_str(&format!("witness: {e}")))?;

        let public_inputs_field = circuit.get_public_inputs();
        let mut rng = OsRng;
        let proof = Groth16::<Bn254>::prove(pk, circuit, &mut rng)
            .map_err(|e| JsValue::from_str(&format!("prove failed: {e}")))?;

        let mut a = Vec::new();
        let mut b = Vec::new();
        let mut cc = Vec::new();
        proof
            .a
            .serialize_compressed(&mut a)
            .map_err(|e| JsValue::from_str(&format!("ser a: {e}")))?;
        proof
            .b
            .serialize_compressed(&mut b)
            .map_err(|e| JsValue::from_str(&format!("ser b: {e}")))?;
        proof
            .c
            .serialize_compressed(&mut cc)
            .map_err(|e| JsValue::from_str(&format!("ser c: {e}")))?;
        let mut ser = Vec::with_capacity(128);
        ser.extend_from_slice(&a);
        ser.extend_from_slice(&b);
        ser.extend_from_slice(&cc);

        let mut pubs_le = Vec::with_capacity(public_inputs_field.len() * 32);
        for fe in &public_inputs_field {
            let mut le = fe.into_bigint().to_bytes_le();
            le.resize(32, 0u8);
            pubs_le.extend_from_slice(&le);
        }

        let out = ProofOutput {
            proof_a: a,
            proof_b: b,
            proof_c: cc,
            public_inputs: public_inputs_field
                .iter()
                .map(|fe| fe.into_bigint().to_string())
                .collect(),
            proof_serialized_hex: hex::encode(ser),
            public_inputs_serialized_hex: hex::encode(pubs_le),
        };
        serde_json::to_string(&out).map_err(|e| JsValue::from_str(&format!("json: {e}")))
    })
}

/// One-shot converter so the benchmark can produce an uncompressed key in the
/// browser without a new build asset: compressed hex in, uncompressed hex out.
/// This is a measurement convenience, NOT how a real deployment should do it —
/// a real deployment would ship the uncompressed key as the static asset.
#[wasm_bindgen]
pub fn bench_recompress_pk_uncompressed(proving_key_hex: &str) -> Result<String, JsValue> {
    let pk = load(proving_key_hex, Compress::Yes, Validate::Yes)?;
    let mut out = Vec::new();
    pk.serialize_uncompressed(&mut out)
        .map_err(|e| JsValue::from_str(&format!("serialize_uncompressed failed: {e}")))?;
    Ok(hex::encode(out))
}
