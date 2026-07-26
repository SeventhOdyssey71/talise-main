//! Turn a ceremony's `verification_key.json` into the bytes Sui verifies with.
//!
//! This is the last step of the ceremony: `snarkjs zkey export verificationkey`
//! emits snarkjs JSON; `sui::groth16::prepare_verifying_key` wants
//! arkworks-compressed bytes. `circuit/src/snarkjs.rs` does the conversion and
//! `tests/snarkjs_vk_roundtrip.rs` proves it is lossless.
//!
//! Usage:
//!   cargo run --release --bin ceremony_vk_import -- <verification_key.json> \
//!     [--expect-npublic 8] [--out <vk_sui.hex>]
//!
//! Prints the 520-byte hex blob to paste into
//! `sources/constants.move::verifying_key!()`, plus its SHA-256 so the published
//! artefact and the deployed constant can be compared by anyone.
//!
//! SAFETY RAILS this enforces, because a wrong VK here is a silently broken or
//! silently unsound pool:
//!   * protocol == groth16, curve == bn128 (BN254);
//!   * every point is on the curve AND in the prime-order subgroup;
//!   * no coordinate is >= the field modulus (rejected, never reduced);
//!   * nPublic matches `--expect-npublic` (8 for this circuit) — a VK for a
//!     different circuit arity would otherwise be accepted and then fail
//!     mysteriously at verify time;
//!   * the bytes re-export to the same JSON, i.e. the conversion round-trips.

use ark_bn254::Bn254;
use ark_groth16::{prepare_verifying_key, Groth16};
use ark_serialize::CanonicalSerialize;
use talise_privacy_circuit::snarkjs::{
    proof_from_snarkjs, public_signals_from_snarkjs, vk_from_snarkjs, vk_to_snarkjs,
    vk_to_sui_bytes,
};

fn arg(name: &str) -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1).cloned())
}

/// Minimal SHA-256 so this binary needs no new dependency. The digest is a
/// convenience label for publication, not a security boundary.
fn sha256(data: &[u8]) -> String {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];
    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];
    let mut msg = data.to_vec();
    let bitlen = (data.len() as u64) * 8;
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bitlen.to_be_bytes());

    for chunk in msg.chunks(64) {
        let mut w = [0u32; 64];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([
                chunk[i * 4],
                chunk[i * 4 + 1],
                chunk[i * 4 + 2],
                chunk[i * 4 + 3],
            ]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }
        let mut v = h;
        for i in 0..64 {
            let s1 = v[4].rotate_right(6) ^ v[4].rotate_right(11) ^ v[4].rotate_right(25);
            let ch = (v[4] & v[5]) ^ ((!v[4]) & v[6]);
            let t1 = v[7]
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let s0 = v[0].rotate_right(2) ^ v[0].rotate_right(13) ^ v[0].rotate_right(22);
            let maj = (v[0] & v[1]) ^ (v[0] & v[2]) ^ (v[1] & v[2]);
            let t2 = s0.wrapping_add(maj);
            v[7] = v[6];
            v[6] = v[5];
            v[5] = v[4];
            v[4] = v[3].wrapping_add(t1);
            v[3] = v[2];
            v[2] = v[1];
            v[1] = v[0];
            v[0] = t1.wrapping_add(t2);
        }
        for i in 0..8 {
            h[i] = h[i].wrapping_add(v[i]);
        }
    }
    h.iter().map(|x| format!("{x:08x}")).collect()
}

fn main() -> anyhow::Result<()> {
    let path = std::env::args()
        .nth(1)
        .filter(|a| !a.starts_with("--"))
        .ok_or_else(|| {
            anyhow::anyhow!(
                "usage: ceremony_vk_import <verification_key.json> \
                 [--expect-npublic N] [--out <file>]"
            )
        })?;
    let expect_npublic: usize = arg("--expect-npublic").map_or(Ok(8), |s| s.parse())?;

    let raw = std::fs::read_to_string(&path)?;
    let json: serde_json::Value = serde_json::from_str(&raw)?;

    let n = json
        .get("nPublic")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| anyhow::anyhow!("{path}: missing nPublic"))? as usize;
    anyhow::ensure!(
        n == expect_npublic,
        "{path}: nPublic == {n}, expected {expect_npublic}. This verification key is \
         for a DIFFERENT circuit. Refusing."
    );

    let vk = vk_from_snarkjs(&json)?;
    let bytes = vk_to_sui_bytes(&vk)?;

    // Round-trip guard: re-export and require the JSON's curve points to match.
    // Catches a truncated or hand-edited input that happens to parse.
    let reexported = vk_to_snarkjs(&vk);
    for k in ["vk_alpha_1", "vk_beta_2", "vk_gamma_2", "vk_delta_2", "IC"] {
        anyhow::ensure!(
            reexported[k] == json[k],
            "{path}: {k} does not survive re-export — input is not canonical snarkjs JSON"
        );
    }

    let hex_out = hex::encode(&bytes);
    println!("source            : {path}");
    println!("nPublic           : {n}");
    println!("Sui VK bytes      : {} bytes", bytes.len());
    println!("sha256(VK bytes)  : {}", sha256(&bytes));
    println!("sha256(vk json)   : {}", sha256(raw.as_bytes()));
    println!();
    println!("// paste into sources/constants.move::verifying_key!()");
    println!("x\"{hex_out}\"");

    if let Some(out) = arg("--out") {
        std::fs::write(&out, &hex_out)?;
        println!("\nwrote {out}");
    }

    // OPTIONAL: if a snarkjs proof + public signals are supplied, verify them
    // against the imported key under ARKWORKS and emit the Sui-format blobs.
    // This is the direction that matters for a ceremony: artefacts produced by
    // snarkjs, consumed by arkworks and then by `sui::groth16`.
    if let (Some(pp), Some(pubp)) = (arg("--proof"), arg("--public")) {
        let proof_json: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&pp)?)?;
        let public_json: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&pubp)?)?;
        let proof = proof_from_snarkjs(&proof_json)?;
        let pubs = public_signals_from_snarkjs(&public_json)?;
        anyhow::ensure!(
            pubs.len() == n,
            "public.json has {} signals but nPublic == {n}",
            pubs.len()
        );

        let pvk = prepare_verifying_key(&vk);
        let ok = Groth16::<Bn254>::verify_proof(&pvk, &proof, &pubs)?;
        println!("\nsnarkjs proof verified under arkworks: {}", if ok { "PASS" } else { "FAIL" });
        anyhow::ensure!(ok, "the snarkjs proof does NOT verify against the imported VK");

        let mut a = Vec::new();
        let mut b = Vec::new();
        let mut c = Vec::new();
        proof.a.serialize_compressed(&mut a)?;
        proof.b.serialize_compressed(&mut b)?;
        proof.c.serialize_compressed(&mut c)?;
        let mut points = Vec::with_capacity(128);
        points.extend_from_slice(&a);
        points.extend_from_slice(&b);
        points.extend_from_slice(&c);

        let pubs_hex = talise_privacy_circuit::prover::public_inputs_hex(&pubs);
        println!("\n// Sui-format proof points ({} bytes)", points.len());
        println!("x\"{}\"", hex::encode(&points));
        println!("\n// Sui-format public inputs ({} bytes, {n} x 32B LE)", pubs_hex.len() / 2);
        println!("x\"{pubs_hex}\"");
    }

    Ok(())
}
