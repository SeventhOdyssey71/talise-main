//! THE LANDMINE TEST.
//!
//! The trusted-setup ceremony ecosystem emits snarkjs JSON. Sui's on-chain
//! verifier eats arkworks-compressed bytes. If a verifying key cannot make that
//! round trip byte-exactly, every artefact a ceremony produces is unusable on
//! Sui and the ceremony design has to change. This test settles it.
//!
//! What is asserted here:
//!
//!   1. The shipped 520-byte VK (`keys/vk_sui.hex`, byte-identical to
//!      `sources/constants.move::verifying_key!()`) survives
//!      `sui bytes → arkworks → snarkjs JSON → arkworks → sui bytes` with
//!      **zero byte difference**.
//!   2. The intermediate JSON has exactly the shape snarkjs' `groth16.verify`
//!      reads (`protocol`, `curve`, `nPublic`, `vk_alpha_1`, `vk_beta_2`,
//!      `vk_gamma_2`, `vk_delta_2`, `IC`), and `nPublic == 8`.
//!   3. The second single-party VK that the Move suite already carries
//!      (`tests/groth16_verify_tests.move::VK_HEX`, a different keygen run,
//!      matched to a committed real proof) also round-trips byte-exactly.
//!   4. A freshly generated VK + real proof round-trips, AND the proof still
//!      verifies natively against the round-tripped VK. (Byte equality alone
//!      would not catch a mapping that is self-consistently wrong.)
//!   5. Tamper detection: flipping one decimal digit in the JSON must NOT
//!      silently produce a valid key.
//!
//! The complementary half of the evidence — that *real snarkjs* accepts the
//! exported JSON and verifies an arkworks proof with it, and that Sui's native
//! verifier accepts the round-tripped bytes — lives in
//! `src/bin/ceremony_roundtrip.rs` + `ceremony/verify_roundtrip.sh` and
//! `tests/ceremony_roundtrip_tests.move`. Node/snarkjs is not a `cargo test`
//! dependency, so this file stays pure Rust.

use ark_bn254::Bn254;
use ark_groth16::{prepare_verifying_key, Groth16};
use serde_json::Value;

use talise_privacy_circuit::prover::{build_deposit_circuit, dev_setup, prove_deposit};
use talise_privacy_circuit::snarkjs::{
    proof_to_snarkjs, public_signals_to_snarkjs, roundtrip_vk_through_snarkjs, vk_from_snarkjs,
    vk_to_snarkjs, vk_to_sui_bytes,
};

/// The shipped VK — the exact blob pasted into `constants.move`.
const SHIPPED_VK_HEX: &str = include_str!("../keys/vk_sui.hex");

/// The second single-party VK the Move suite carries, matched to the committed
/// real proof in `tests/groth16_verify_tests.move`. Copied here verbatim so this
/// test does not have to parse Move source.
const MOVE_TEST_VK_HEX: &str = "520a8b864b70eb8d801f32760562754f1d7e4e38cbdb28d668b2be9277ba7c022a5eebe30f82ace3fcb4955a860bb52aedc4ca114c2b68dadebb36488220540a5d055500150abf8260a8a7bd467299e9cbd55c4fd80df4bc6a9d22df1dbe1f2f6758de37a6c3e9885c7f14eaa5d622ee3077a5b9419b14ff8fbbebed56210a1fe1297cedbc3021bb963c89788adeb23efc53edfd081e8ace1efd8d3c290f8f82522c865ccd1e8b34deb063d428aca44a2b1c54bccfd97dd59cf42e7944731a23e26b37b2fa7e07b0f41f2cdd070ee5526aa4111dbf1752bf6d1959dbcb3ce6280900000000000000739afa7f7a2184f0c52fa88614ed0eda540da9c5f8a1198418dfd995924a3ea058aa615a6b58482a8f2dfe1092ba13cc059909473452e2bf75d9157232767c002f5e6da8d3992c3dcc5733d6e7a5de71d88018a5ac136686a70c9001d6cb183014871ac6ee6c8c4eefa5675d458561f3a98ce16027160915ce38a93d31e8f6ae243f6470f923577afcc87cbd255c18b49c9ff2a416c6288d5db8a83c08b73c9ef49d4191d643d9dda4ee35d5924a1701e19e28ab99e3e42c2e61230ffe93a50b6e9f5ae3885fbac0163099bad9fc9414e2cb2c0b03df8e51f0f1efcf1286b3127a058e5bfade299b0d4af628979d6f53b8c701027c202b40d629dc9adbb66f045e91da91eb8ff37f04fe006c7045c0b6b92b4522107c7a4d7e715114f34ce91d";

fn assert_roundtrips_byte_exactly(label: &str, vk_hex: &str) -> Value {
    let original = hex::decode(vk_hex.trim()).expect("vk hex decodes");
    assert_eq!(
        original.len(),
        520,
        "{label}: expected a 520-byte VK (8 public inputs), got {}",
        original.len()
    );

    let (back, json) = roundtrip_vk_through_snarkjs(&original)
        .unwrap_or_else(|e| panic!("{label}: round trip errored: {e:?}"));

    assert_eq!(
        back.len(),
        original.len(),
        "{label}: round-tripped VK changed length ({} -> {})",
        original.len(),
        back.len()
    );

    if back != original {
        let first_diff = original
            .iter()
            .zip(back.iter())
            .position(|(a, b)| a != b)
            .unwrap();
        panic!(
            "{label}: VK round trip is NOT byte-exact. First difference at byte {first_diff}: \
             original 0x{:02x} vs round-tripped 0x{:02x}.\n  original     = {}\n  round-tripped = {}",
            original[first_diff],
            back[first_diff],
            hex::encode(&original),
            hex::encode(&back),
        );
    }
    json
}

#[test]
fn shipped_vk_roundtrips_through_snarkjs_json_byte_exactly() {
    let json = assert_roundtrips_byte_exactly("shipped VK (constants.move)", SHIPPED_VK_HEX);

    // The JSON must be the shape snarkjs' groth16_verify.js reads.
    assert_eq!(json["protocol"], "groth16");
    assert_eq!(json["curve"], "bn128");
    assert_eq!(json["nPublic"], 8, "circuit has 8 public inputs");
    for k in [
        "vk_alpha_1",
        "vk_beta_2",
        "vk_gamma_2",
        "vk_delta_2",
        "vk_alphabeta_12",
        "IC",
    ] {
        assert!(json.get(k).is_some(), "verification_key.json missing {k}");
    }
    assert_eq!(
        json["IC"].as_array().unwrap().len(),
        9,
        "IC == gamma_abc_g1 == nPublic + 1"
    );

    // G1 entries are [x, y, "1"]; G2 entries are [[c0,c1],[c0,c1],["1","0"]].
    let alpha = json["vk_alpha_1"].as_array().unwrap();
    assert_eq!(alpha.len(), 3);
    assert_eq!(alpha[2], "1", "vk_alpha_1 must be normalized (z == 1)");
    let beta = json["vk_beta_2"].as_array().unwrap();
    assert_eq!(beta.len(), 3);
    assert_eq!(beta[0].as_array().unwrap().len(), 2, "Fq2 is [c0, c1]");
    assert_eq!(beta[2], serde_json::json!(["1", "0"]));

    // Every coordinate is a base-10 string, not hex, not a number.
    for (i, ic) in json["IC"].as_array().unwrap().iter().enumerate() {
        for (j, c) in ic.as_array().unwrap().iter().enumerate() {
            let s = c.as_str().unwrap_or_else(|| panic!("IC[{i}][{j}] not a string"));
            assert!(
                s.bytes().all(|b| b.is_ascii_digit()),
                "IC[{i}][{j}] = {s:?} is not base-10"
            );
        }
    }
}

#[test]
fn move_suite_vk_roundtrips_through_snarkjs_json_byte_exactly() {
    assert_roundtrips_byte_exactly("Move suite VK (groth16_verify_tests)", MOVE_TEST_VK_HEX);
}

/// Byte equality is necessary but not sufficient: a mapping could be
/// self-consistently wrong (e.g. swap `y` for `-y` in both directions) and still
/// round-trip. So also prove that a REAL proof verifies against the
/// round-tripped key.
#[test]
fn real_proof_still_verifies_against_a_roundtripped_vk() {
    let (pk, vk) = dev_setup().expect("dev setup");
    let circuit = build_deposit_circuit(1000, 600, 400).expect("build deposit");
    let (proof, public_inputs) = prove_deposit(&pk, circuit).expect("prove");

    let original = vk_to_sui_bytes(&vk).expect("serialize vk");
    let (back, json) = roundtrip_vk_through_snarkjs(&original).expect("round trip");
    assert_eq!(back, original, "fresh VK must round-trip byte-exactly too");

    let vk_back = vk_from_snarkjs(&json).expect("re-import");
    let pvk = prepare_verifying_key(&vk_back);
    assert!(
        Groth16::<Bn254>::verify_proof(&pvk, &proof, &public_inputs).expect("verify"),
        "a real proof MUST verify against the snarkjs-round-tripped VK"
    );

    // And the proof/public-signal exporters produce snarkjs-shaped JSON.
    let pj = proof_to_snarkjs(&proof);
    assert_eq!(pj["protocol"], "groth16");
    assert_eq!(pj["curve"], "bn128");
    assert_eq!(pj["pi_b"].as_array().unwrap()[0].as_array().unwrap().len(), 2);
    assert_eq!(
        public_signals_to_snarkjs(&public_inputs)
            .as_array()
            .unwrap()
            .len(),
        8
    );
}

/// The importer must reject a corrupted artefact rather than quietly coercing it
/// into some other valid key — otherwise "the ceremony output round-tripped" is
/// a meaningless statement.
#[test]
fn corrupted_snarkjs_json_is_rejected_not_silently_coerced() {
    let original = hex::decode(SHIPPED_VK_HEX.trim()).unwrap();
    let vk = talise_privacy_circuit::snarkjs::vk_from_sui_bytes(&original).unwrap();
    let good = vk_to_snarkjs(&vk);

    // (a) A point knocked off the curve.
    let mut bad = good.clone();
    bad["vk_alpha_1"][0] = Value::String("1".to_string());
    assert!(
        vk_from_snarkjs(&bad).is_err(),
        "an off-curve vk_alpha_1 must be rejected"
    );

    // (b) A coordinate at/above the Fq modulus (would silently reduce if we let
    //     arkworks' `From<BigUint>` do it).
    let mut bad = good.clone();
    bad["IC"][0][0] = Value::String(
        "21888242871839275222246405745257275088696311157297823662689037894645226208583".to_string(),
    );
    assert!(
        vk_from_snarkjs(&bad).is_err(),
        "a non-canonical (>= modulus) coordinate must be rejected"
    );

    // (c) nPublic disagreeing with IC length.
    let mut bad = good.clone();
    bad["nPublic"] = Value::from(7);
    assert!(
        vk_from_snarkjs(&bad).is_err(),
        "nPublic/IC length mismatch must be rejected"
    );

    // (d) Swapped Fq2 limbs in vk_beta_2 — the exact mistake that would silently
    //     break interop if the JSON convention were [c1, c0]. Must not produce a
    //     key that re-serializes to the original bytes.
    let mut bad = good.clone();
    let x = bad["vk_beta_2"][0].clone();
    bad["vk_beta_2"][0] = Value::Array(vec![x[1].clone(), x[0].clone()]);
    match vk_from_snarkjs(&bad) {
        Err(_) => {} // rejected outright (off-curve) — fine
        Ok(k) => assert_ne!(
            vk_to_sui_bytes(&k).unwrap(),
            original,
            "limb-swapped vk_beta_2 must not reproduce the original bytes"
        ),
    }
}
