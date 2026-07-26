//! THE LANDMINE HARNESS — arkworks VK ⇄ snarkjs, end to end.
//!
//! `tests/snarkjs_vk_roundtrip.rs` proves the round trip is byte-exact in pure
//! Rust. That is only half the evidence: our own encoder and decoder could agree
//! with each other and both disagree with snarkjs. This binary produces the
//! artefacts that let *real snarkjs* and *real Sui* be the judges:
//!
//!   1. Read the shipped 520-byte VK (`keys/vk_sui.hex`, byte-identical to
//!      `sources/constants.move::verifying_key!()`).
//!   2. Round-trip it `arkworks → snarkjs JSON → arkworks → bytes` and assert
//!      byte equality with the input.
//!   3. Load the REAL proving key that ships to browsers
//!      (`web/public/shield/proving_key.bin`) and check its embedded VK is the
//!      same key — i.e. the shipped prover and the on-chain VK are a matched
//!      pair.
//!   4. Produce a real deposit proof with it and verify natively.
//!   5. Write `verification_key.json`, `proof.json`, `public.json` in snarkjs
//!      format, so `snarkjs groth16 verify` can be run over an arkworks proof.
//!   6. Print the round-tripped VK / proof / public-input hex blobs for
//!      `tests/ceremony_roundtrip_tests.move`, which asserts Sui's native
//!      `groth16::verify_groth16_proof` accepts them.
//!
//! Usage:
//!   cargo run --release --bin ceremony_roundtrip -- \
//!     [--pk <proving_key.bin>] [--out <dir>] [--amount N --out0 N --out1 N]
//!
//! Read-only with respect to the repo: it writes ONLY under `--out`.

use ark_bn254::Bn254;
use ark_crypto_primitives::snark::SNARK;
use ark_groth16::{prepare_verifying_key, Groth16, ProvingKey};
use ark_serialize::CanonicalDeserialize;
use std::path::{Path, PathBuf};

use talise_privacy_circuit::prover::{
    build_deposit_circuit_for_pool, pool_address_to_field, proof_hex, prove_deposit,
    public_inputs_hex, u256_decimal_to_field,
};
use talise_privacy_circuit::snarkjs::{
    proof_to_snarkjs, public_signals_to_snarkjs, roundtrip_vk_through_snarkjs, vk_to_sui_bytes,
};

fn arg(name: &str) -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1).cloned())
}

fn main() -> anyhow::Result<()> {
    let circuit_dir = Path::new(env!("CARGO_MANIFEST_DIR")).to_path_buf();
    // circuit/ -> talise-privacy/ -> move/ -> repo root
    let repo_root = circuit_dir
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .ok_or_else(|| anyhow::anyhow!("cannot locate repo root from {}", circuit_dir.display()))?
        .to_path_buf();

    let vk_path = circuit_dir.join("keys/vk_sui.hex");
    let pk_path = arg("--pk").map(PathBuf::from).unwrap_or_else(|| {
        // The proving key that actually ships to browsers. `circuit/keys/` is
        // git-ignored for the 3.8 MB PK, so this is the committed copy.
        repo_root.join("web/public/shield/proving_key.bin")
    });
    let out_dir = PathBuf::from(arg("--out").unwrap_or_else(|| "roundtrip-out".to_string()));

    let amount: u64 = arg("--amount").map_or(Ok(1000), |s| s.parse())?;
    let out0: u64 = arg("--out0").map_or(Ok(600), |s| s.parse())?;
    let out1: u64 = arg("--out1").map_or(Ok(400), |s| s.parse())?;
    let pool = arg("--pool").unwrap_or_else(|| "0x1".to_string());
    let root = arg("--root").unwrap_or_else(|| "0".to_string());

    println!("=== TALISE PRIVACY — snarkjs ⇄ arkworks VK ROUND-TRIP HARNESS ===\n");

    // ---------------------------------------------------------------- step 1/2
    let vk_hex_in = std::fs::read_to_string(&vk_path)?.trim().to_string();
    let vk_bytes_in = hex::decode(&vk_hex_in)?;
    println!("[1] shipped VK        : {} ({} bytes)", vk_path.display(), vk_bytes_in.len());
    anyhow::ensure!(
        vk_bytes_in.len() == 520,
        "expected a 520-byte VK, got {}",
        vk_bytes_in.len()
    );

    let (vk_bytes_out, vk_json) = roundtrip_vk_through_snarkjs(&vk_bytes_in)?;
    let byte_exact = vk_bytes_out == vk_bytes_in;
    println!(
        "[2] round trip        : arkworks -> snarkjs JSON -> arkworks -> bytes = {}",
        if byte_exact {
            "BYTE-EXACT ✓"
        } else {
            "*** MISMATCH ***"
        }
    );
    anyhow::ensure!(byte_exact, "VK round trip is NOT byte-exact — see the test for a diff");

    // ---------------------------------------------------------------- step 3
    let pk_bytes = std::fs::read(&pk_path).map_err(|e| {
        anyhow::anyhow!(
            "cannot read proving key {} ({e}).\nPass --pk <path>, or rebuild it with \
             `cargo run --bin keygen` (WARNING: --force changes the VK).",
            pk_path.display()
        )
    })?;
    let pk = ProvingKey::<Bn254>::deserialize_compressed(&pk_bytes[..])?;
    let pk_vk_bytes = vk_to_sui_bytes(&pk.vk)?;
    let matched = pk_vk_bytes == vk_bytes_in;
    println!(
        "[3] proving key       : {} ({} bytes)\n    embedded VK matches the shipped VK: {}",
        pk_path.display(),
        pk_bytes.len(),
        if matched { "YES ✓" } else { "NO — MISMATCHED PAIR" }
    );
    anyhow::ensure!(
        matched,
        "the proving key's embedded VK != keys/vk_sui.hex, so no proof it makes can \
         verify against constants.move's VK"
    );

    // ---------------------------------------------------------------- step 4
    let vortex = pool_address_to_field(&pool)?;
    let root_fe = u256_decimal_to_field(&root)?;
    let (circuit, _notes) = build_deposit_circuit_for_pool(vortex, root_fe, amount, out0, out1)?;
    let t0 = std::time::Instant::now();
    let (proof, public_inputs) = prove_deposit(&pk, circuit)?;
    let prove_ms = t0.elapsed().as_secs_f64() * 1000.0;

    let pvk = prepare_verifying_key(&pk.vk);
    let native_ok = Groth16::<Bn254>::verify_proof(&pvk, &proof, &public_inputs)?;
    println!(
        "[4] native prove      : deposit {amount} = {out0}+{out1}, pool {pool}, root {root} \
         ({prove_ms:.0} ms)\n    native arkworks verify: {}",
        if native_ok { "PASS ✓" } else { "FAIL" }
    );
    anyhow::ensure!(native_ok, "the proof does not verify natively — nothing else matters");

    // ---------------------------------------------------------------- step 5
    std::fs::create_dir_all(&out_dir)?;
    let write = |name: &str, v: &serde_json::Value| -> anyhow::Result<()> {
        let p = out_dir.join(name);
        std::fs::write(&p, serde_json::to_string_pretty(v)?)?;
        println!("    wrote {}", p.display());
        Ok(())
    };
    println!("[5] snarkjs artefacts :");
    write("verification_key.json", &vk_json)?;
    write("proof.json", &proof_to_snarkjs(&proof))?;
    write("public.json", &public_signals_to_snarkjs(&public_inputs))?;
    std::fs::write(out_dir.join("vk_roundtripped.hex"), hex::encode(&vk_bytes_out))?;
    println!("    wrote {}", out_dir.join("vk_roundtripped.hex").display());

    // ---------------------------------------------------------------- step 6
    let proof_h = proof_hex(&proof)?;
    let pubs_h = public_inputs_hex(&public_inputs);
    println!("\n[6] paste into tests/ceremony_roundtrip_tests.move:\n");
    println!("// ROUND-TRIPPED VK ({} bytes) — byte-identical to constants::verifying_key!()", vk_bytes_out.len());
    println!("const VK_ROUNDTRIPPED: vector<u8> =\n    x\"{}\";\n", hex::encode(&vk_bytes_out));
    println!("// PROOF ({} bytes) A32‖B64‖C32", proof_h.len() / 2);
    println!("const PROOF: vector<u8> =\n    x\"{proof_h}\";\n");
    println!("// PUBLIC INPUTS ({} bytes) 8 × 32B LE", pubs_h.len() / 2);
    println!("const PUBLIC_INPUTS: vector<u8> =\n    x\"{pubs_h}\";\n");

    println!("Next: `snarkjs groth16 verify {0}/verification_key.json {0}/public.json {0}/proof.json`", out_dir.display());
    println!("      (or run ceremony/verify_roundtrip.sh, which does all of it)");
    Ok(())
}
