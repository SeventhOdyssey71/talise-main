//! arkworks ⇄ snarkjs interchange for BN254 Groth16 artefacts.
//!
//! WHY THIS EXISTS
//! ---------------
//! The trusted-setup ceremony ecosystem (Perpetual Powers of Tau, snarkjs
//! `zkey contribute` / `zkey beacon`) speaks **snarkjs JSON / `.zkey`**. Talise's
//! on-chain verifier (`sui::groth16::prepare_verifying_key`) speaks
//! **arkworks `CanonicalSerialize::serialize_compressed`**. Before a ceremony is
//! worth running we must know that a verifying key can cross that boundary
//! WITHOUT losing a bit — otherwise the ceremony output is unusable on Sui.
//!
//! This module implements the mapping and is exercised by
//! `tests/snarkjs_vk_roundtrip.rs`, which asserts a **byte-exact** round trip of
//! the shipped 520-byte VK, and by `src/bin/ceremony_roundtrip.rs`, which emits
//! real snarkjs `verification_key.json` / `proof.json` / `public.json` so that
//! *actual snarkjs* — not our reimplementation of it — verifies an *arkworks*
//! proof against the *exported* key.
//!
//! THE FORMATS
//! -----------
//! arkworks compressed `VerifyingKey<Bn254>` (520 bytes for 8 public inputs):
//!
//!   alpha_g1 (32, compressed G1) ‖ beta_g2 (64) ‖ gamma_g2 (64) ‖ delta_g2 (64)
//!   ‖ len(gamma_abc_g1) as u64-LE (8) ‖ gamma_abc_g1[0..9] (9 × 32)
//!
//! A compressed G1 is `x` as a 32-byte little-endian integer with the two top
//! bits of the LAST byte carrying arkworks' `SWFlags` (infinity / which square
//! root of `y` to take). A compressed G2 is the same over Fq2 = c0 + c1·u,
//! serialized c0 then c1.
//!
//! snarkjs `verification_key.json` carries the SAME points as **uncompressed
//! affine coordinates in base-10 decimal strings**:
//!
//!   vk_alpha_1: [x, y, "1"]
//!   vk_beta_2 : [[x.c0, x.c1], [y.c0, y.c1], ["1", "0"]]
//!   IC        : [[x, y, "1"], ...]                      (== gamma_abc_g1)
//!
//! ffjavascript's `Fp2.fromObject` writes `a[0]` into the low limb and `a[1]`
//! into the high limb (`ffjavascript/src/wasm_field2.js`), i.e. `[c0, c1]` — the
//! same ordering arkworks' `QuadExtField { c0, c1 }` serializes. (This is NOT
//! the reversed ordering the Solidity/EVM pairing precompile wants; that
//! reversal lives in snarkjs' Solidity template, not in the JSON.)
//!
//! Because the JSON carries `y` explicitly, the direction JSON → arkworks
//! reproduces the compression flag bit-for-bit: arkworks derives it from the
//! exact `y` it is handed. A lossless round trip is therefore *expected*; the
//! tests prove it rather than assuming it.
//!
//! `vk_alphabeta_12` is emitted for drop-in compatibility with snarkjs tooling
//! (`zkey export solidityverifier` reads it) but is NOT consumed by
//! `groth16.verify` — see `snarkjs/src/groth16_verify.js`, which builds the
//! pairing check from `vk_alpha_1` / `vk_beta_2` directly.
//!
//! Not compiled for wasm32: the browser prover has no use for it and we do not
//! want to grow the shipped `.wasm`.

use ark_bn254::{Bn254, Fq, Fq2, Fr, G1Affine, G2Affine};
use ark_ec::pairing::Pairing;
use ark_ff::{BigInteger, PrimeField};
use ark_groth16::{Proof, VerifyingKey};
use ark_serialize::{CanonicalDeserialize, CanonicalSerialize};
use num_bigint::BigUint;
use num_traits::{One, Zero};
use serde_json::{json, Value};

// ---------------------------------------------------------------------------
// Base field helpers
// ---------------------------------------------------------------------------

fn fq_to_dec(x: &Fq) -> String {
    BigUint::from_bytes_le(&x.into_bigint().to_bytes_le()).to_string()
}

fn fq_modulus() -> BigUint {
    BigUint::from_bytes_le(&<Fq as PrimeField>::MODULUS.to_bytes_le())
}

fn fr_modulus() -> BigUint {
    BigUint::from_bytes_le(&<Fr as PrimeField>::MODULUS.to_bytes_le())
}

fn dec_str(v: &Value, what: &str) -> anyhow::Result<String> {
    match v {
        Value::String(s) => Ok(s.trim().to_string()),
        // snarkjs always writes strings, but tolerate a JSON number.
        Value::Number(n) => Ok(n.to_string()),
        _ => anyhow::bail!("{what}: expected a decimal string, got {v}"),
    }
}

/// Parse a base-10 base-field element, REJECTING (not silently reducing)
/// anything at or above the modulus. Silent reduction would let a malformed
/// ceremony artefact round-trip to different bytes than it came in as.
fn fq_from_dec(v: &Value, what: &str) -> anyhow::Result<Fq> {
    let s = dec_str(v, what)?;
    let b = BigUint::parse_bytes(s.as_bytes(), 10)
        .ok_or_else(|| anyhow::anyhow!("{what}: not a base-10 integer: {s:?}"))?;
    if b >= fq_modulus() {
        anyhow::bail!("{what}: value >= Fq modulus (not a canonical field element)");
    }
    Ok(Fq::from(b))
}

fn fr_from_dec(v: &Value, what: &str) -> anyhow::Result<Fr> {
    let s = dec_str(v, what)?;
    let b = BigUint::parse_bytes(s.as_bytes(), 10)
        .ok_or_else(|| anyhow::anyhow!("{what}: not a base-10 integer: {s:?}"))?;
    if b >= fr_modulus() {
        anyhow::bail!("{what}: value >= Fr modulus (not a canonical scalar)");
    }
    Ok(Fr::from(b))
}

fn fq2_to_json(x: &Fq2) -> Value {
    json!([fq_to_dec(&x.c0), fq_to_dec(&x.c1)])
}

fn fq2_from_json(v: &Value, what: &str) -> anyhow::Result<Fq2> {
    let a = v
        .as_array()
        .ok_or_else(|| anyhow::anyhow!("{what}: expected [c0, c1]"))?;
    if a.len() != 2 {
        anyhow::bail!("{what}: expected 2 Fq2 coordinates, got {}", a.len());
    }
    Ok(Fq2::new(
        fq_from_dec(&a[0], &format!("{what}.c0"))?,
        fq_from_dec(&a[1], &format!("{what}.c1"))?,
    ))
}

// ---------------------------------------------------------------------------
// Curve points
// ---------------------------------------------------------------------------

fn g1_to_json(p: &G1Affine) -> Value {
    // ffjavascript reads `z == 0` as the point at infinity
    // (`wasm_curve.js::fromObject`). Our VKs contain no infinity points, but be
    // explicit rather than emitting a bogus (0, 0, 1).
    if p.infinity {
        json!(["0", "0", "0"])
    } else {
        json!([fq_to_dec(&p.x), fq_to_dec(&p.y), "1"])
    }
}

fn g1_from_json(v: &Value, what: &str) -> anyhow::Result<G1Affine> {
    let a = v
        .as_array()
        .ok_or_else(|| anyhow::anyhow!("{what}: expected [x, y, z]"))?;
    if a.len() != 2 && a.len() != 3 {
        anyhow::bail!("{what}: expected 2 or 3 G1 coordinates, got {}", a.len());
    }
    if a.len() == 3 {
        let z = dec_str(&a[2], &format!("{what}.z"))?;
        if z == "0" {
            return Ok(G1Affine::identity());
        }
        if z != "1" {
            anyhow::bail!("{what}: projective z={z} — only normalized (z==1) points supported");
        }
    }
    let p = G1Affine::new_unchecked(
        fq_from_dec(&a[0], &format!("{what}.x"))?,
        fq_from_dec(&a[1], &format!("{what}.y"))?,
    );
    anyhow::ensure!(p.is_on_curve(), "{what}: G1 point is not on the curve");
    anyhow::ensure!(
        p.is_in_correct_subgroup_assuming_on_curve(),
        "{what}: G1 point is not in the prime-order subgroup"
    );
    Ok(p)
}

fn g2_to_json(p: &G2Affine) -> Value {
    if p.infinity {
        json!([["0", "0"], ["0", "0"], ["0", "0"]])
    } else {
        json!([fq2_to_json(&p.x), fq2_to_json(&p.y), ["1", "0"]])
    }
}

fn g2_from_json(v: &Value, what: &str) -> anyhow::Result<G2Affine> {
    let a = v
        .as_array()
        .ok_or_else(|| anyhow::anyhow!("{what}: expected [x, y, z]"))?;
    if a.len() != 2 && a.len() != 3 {
        anyhow::bail!("{what}: expected 2 or 3 G2 coordinates, got {}", a.len());
    }
    if a.len() == 3 {
        let z = fq2_from_json(&a[2], &format!("{what}.z"))?;
        if z.is_zero() {
            return Ok(G2Affine::identity());
        }
        if !z.is_one() {
            anyhow::bail!("{what}: projective z != 1 — only normalized points supported");
        }
    }
    let p = G2Affine::new_unchecked(
        fq2_from_json(&a[0], &format!("{what}.x"))?,
        fq2_from_json(&a[1], &format!("{what}.y"))?,
    );
    anyhow::ensure!(p.is_on_curve(), "{what}: G2 point is not on the curve");
    anyhow::ensure!(
        p.is_in_correct_subgroup_assuming_on_curve(),
        "{what}: G2 point is not in the prime-order subgroup"
    );
    Ok(p)
}

// ---------------------------------------------------------------------------
// Verifying key
// ---------------------------------------------------------------------------

/// `e(alpha_g1, beta_g2)` as snarkjs' nested `vk_alphabeta_12`: Fq12 == Fq6²,
/// Fq6 == Fq2³, so the JSON is `[2][3][2]` decimal strings.
fn alphabeta_12_json(vk: &VerifyingKey<Bn254>) -> Value {
    let gt = Bn254::pairing(vk.alpha_g1, vk.beta_g2).0;
    let six =
        |c: &ark_bn254::Fq6| json!([fq2_to_json(&c.c0), fq2_to_json(&c.c1), fq2_to_json(&c.c2)]);
    json!([six(&gt.c0), six(&gt.c1)])
}

/// arkworks `VerifyingKey<Bn254>` → snarkjs `verification_key.json`.
pub fn vk_to_snarkjs(vk: &VerifyingKey<Bn254>) -> Value {
    json!({
        "protocol": "groth16",
        "curve": "bn128",
        "nPublic": vk.gamma_abc_g1.len().saturating_sub(1),
        "vk_alpha_1": g1_to_json(&vk.alpha_g1),
        "vk_beta_2": g2_to_json(&vk.beta_g2),
        "vk_gamma_2": g2_to_json(&vk.gamma_g2),
        "vk_delta_2": g2_to_json(&vk.delta_g2),
        "vk_alphabeta_12": alphabeta_12_json(vk),
        "IC": vk.gamma_abc_g1.iter().map(g1_to_json).collect::<Vec<_>>(),
    })
}

/// snarkjs `verification_key.json` → arkworks `VerifyingKey<Bn254>`.
///
/// This is the direction a ceremony output must travel: `snarkjs zkey export
/// verificationkey` emits the JSON; this turns it into the 520 bytes
/// `sui::groth16::prepare_verifying_key` consumes.
pub fn vk_from_snarkjs(v: &Value) -> anyhow::Result<VerifyingKey<Bn254>> {
    if let Some(p) = v.get("protocol").and_then(Value::as_str) {
        anyhow::ensure!(p == "groth16", "unsupported protocol {p:?} (want groth16)");
    }
    if let Some(c) = v.get("curve").and_then(Value::as_str) {
        anyhow::ensure!(
            c == "bn128",
            "unsupported curve {c:?} (want bn128 == BN254/alt_bn128)"
        );
    }

    let ic = v
        .get("IC")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow::anyhow!("verification_key.json: missing IC array"))?;
    anyhow::ensure!(!ic.is_empty(), "verification_key.json: IC is empty");

    if let Some(n) = v.get("nPublic").and_then(Value::as_u64) {
        anyhow::ensure!(
            ic.len() as u64 == n + 1,
            "verification_key.json: nPublic={n} but IC has {} entries (want {})",
            ic.len(),
            n + 1
        );
    }

    let mut gamma_abc_g1 = Vec::with_capacity(ic.len());
    for (i, p) in ic.iter().enumerate() {
        gamma_abc_g1.push(g1_from_json(p, &format!("IC[{i}]"))?);
    }

    Ok(VerifyingKey {
        alpha_g1: g1_from_json(
            v.get("vk_alpha_1")
                .ok_or_else(|| anyhow::anyhow!("missing vk_alpha_1"))?,
            "vk_alpha_1",
        )?,
        beta_g2: g2_from_json(
            v.get("vk_beta_2")
                .ok_or_else(|| anyhow::anyhow!("missing vk_beta_2"))?,
            "vk_beta_2",
        )?,
        gamma_g2: g2_from_json(
            v.get("vk_gamma_2")
                .ok_or_else(|| anyhow::anyhow!("missing vk_gamma_2"))?,
            "vk_gamma_2",
        )?,
        delta_g2: g2_from_json(
            v.get("vk_delta_2")
                .ok_or_else(|| anyhow::anyhow!("missing vk_delta_2"))?,
            "vk_delta_2",
        )?,
        gamma_abc_g1,
    })
}

// ---------------------------------------------------------------------------
// Proof + public signals
// ---------------------------------------------------------------------------

/// arkworks `Proof<Bn254>` → snarkjs `proof.json`.
pub fn proof_to_snarkjs(p: &Proof<Bn254>) -> Value {
    json!({
        "pi_a": g1_to_json(&p.a),
        "pi_b": g2_to_json(&p.b),
        "pi_c": g1_to_json(&p.c),
        "protocol": "groth16",
        "curve": "bn128",
    })
}

/// snarkjs `proof.json` → arkworks `Proof<Bn254>`.
pub fn proof_from_snarkjs(v: &Value) -> anyhow::Result<Proof<Bn254>> {
    Ok(Proof {
        a: g1_from_json(
            v.get("pi_a").ok_or_else(|| anyhow::anyhow!("missing pi_a"))?,
            "pi_a",
        )?,
        b: g2_from_json(
            v.get("pi_b").ok_or_else(|| anyhow::anyhow!("missing pi_b"))?,
            "pi_b",
        )?,
        c: g1_from_json(
            v.get("pi_c").ok_or_else(|| anyhow::anyhow!("missing pi_c"))?,
            "pi_c",
        )?,
    })
}

/// Public inputs → snarkjs `public.json` (a flat array of decimal strings).
pub fn public_signals_to_snarkjs(pubs: &[Fr]) -> Value {
    Value::Array(
        pubs.iter()
            .map(|fe| {
                Value::String(
                    BigUint::from_bytes_le(&fe.into_bigint().to_bytes_le()).to_string(),
                )
            })
            .collect(),
    )
}

/// snarkjs `public.json` → public inputs.
pub fn public_signals_from_snarkjs(v: &Value) -> anyhow::Result<Vec<Fr>> {
    let a = v
        .as_array()
        .ok_or_else(|| anyhow::anyhow!("public.json: expected an array"))?;
    a.iter()
        .enumerate()
        .map(|(i, s)| fr_from_dec(s, &format!("public[{i}]")))
        .collect()
}

// ---------------------------------------------------------------------------
// Convenience: the exact bytes Sui consumes
// ---------------------------------------------------------------------------

/// Serialize a VK to the arkworks-compressed bytes that
/// `sui::groth16::prepare_verifying_key` parses (520 bytes for 8 public inputs).
pub fn vk_to_sui_bytes(vk: &VerifyingKey<Bn254>) -> anyhow::Result<Vec<u8>> {
    let mut out = Vec::new();
    vk.serialize_compressed(&mut out)?;
    Ok(out)
}

/// Parse arkworks-compressed VK bytes (the `vk_sui.hex` / `constants.move`
/// blob) back into a `VerifyingKey`.
pub fn vk_from_sui_bytes(bytes: &[u8]) -> anyhow::Result<VerifyingKey<Bn254>> {
    Ok(VerifyingKey::<Bn254>::deserialize_compressed(bytes)?)
}

/// The full loop this crate must trust before a ceremony is worth running:
/// `sui bytes → arkworks → snarkjs JSON → arkworks → sui bytes`. Returns the
/// re-serialized bytes plus the intermediate JSON so callers can hand the JSON
/// to real snarkjs.
pub fn roundtrip_vk_through_snarkjs(sui_bytes: &[u8]) -> anyhow::Result<(Vec<u8>, Value)> {
    let vk = vk_from_sui_bytes(sui_bytes)?;
    let json = vk_to_snarkjs(&vk);
    let back = vk_from_snarkjs(&json)?;
    let bytes = vk_to_sui_bytes(&back)?;
    Ok((bytes, json))
}
