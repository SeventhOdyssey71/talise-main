/// CEREMONY PRE-FLIGHT — the on-chain half of the snarkjs ⇄ arkworks proof.
///
/// THE QUESTION THIS ANSWERS
/// ------------------------
/// A trusted-setup ceremony (Perpetual Powers of Tau + snarkjs `zkey
/// contribute`) emits its verifying key as **snarkjs JSON**. This package's
/// verifier consumes **arkworks-compressed bytes** via
/// `groth16::prepare_verifying_key`. If a VK cannot cross that boundary without
/// losing a byte, every artefact a ceremony produces is unusable on Sui and the
/// ceremony has to be redesigned. See `CEREMONY.md` §1.
///
/// THE EVIDENCE CHAIN
/// ------------------
///   * `circuit/tests/snarkjs_vk_roundtrip.rs` — the shipped 520-byte VK
///     survives `arkworks bytes → snarkjs JSON → arkworks bytes` byte-exactly,
///     and a corrupted JSON is rejected rather than silently coerced.
///   * `circuit/src/bin/ceremony_roundtrip.rs` — emits the exported
///     `verification_key.json` plus a real arkworks proof in snarkjs format, and
///     `ceremony/verify_roundtrip.sh` feeds them to REAL snarkjs
///     (`snarkjs groth16 verify` → `OK!`).
///   * THIS FILE — Sui's native BN254 verifier accepts the bytes that came back
///     out of the snarkjs representation, against a real proof.
///
/// `VK_ROUNDTRIPPED` below is the output of that round trip. The first assertion
/// is that it is byte-identical to `constants::verifying_key!()` — so the thing
/// being verified on-chain is provably the same key the pool binds at `new()`,
/// after a full trip through the ceremony ecosystem's format.
///
/// Regenerate all three blobs with:
///   cd circuit && cargo run --release --bin ceremony_roundtrip -- --out /tmp/rt
///
/// NOTE: this test does NOT claim the VK is ceremony-derived. It is still the
/// single-party key described in `constants.move`'s header. What it establishes
/// is that the *format bridge* a ceremony needs is sound, so the ceremony is
/// worth running.
#[test_only]
#[allow(implicit_const_copy)]
module talise_privacy::ceremony_roundtrip_tests;

use std::unit_test::assert_eq;
use sui::groth16;
use talise_privacy::constants;

/// The shipped VK after `arkworks → snarkjs verification_key.json → arkworks`.
/// Asserted below to be byte-identical to `constants::verifying_key!()`.
const VK_ROUNDTRIPPED: vector<u8> =
    x"0400f07bc59c5d8eea2d649783a55fcbc64dd793fa1d102e87bb7872bf7fc6853adb445f837298fe2cdc8f935f1658612acec5d538831b9a6542412bbf36321ff5acd09efdf65b13e029ed3b8b3f5a6ebe1b68c12c0c847918db75267527e5a87a0201288a0d169552021541b9ffd92e959ad3dac3e8a21608369684683ae512a1868d2f05c002d9fc6dd1d61d6741a4c262970b896abbda2ee5c8c8b28085ac7226a2ac22840639b823f79dc682d2ffbabf053562c44c018e5c3326e1ca3e04703e766fdc2aeaade5b3d890979bb2b27e9fed88542f9e0e12597e697624309d09000000000000008ff673d2e70b20cf402f0eb3ac0c2c5b29acacacde983fdf16ae05d0e390b512de33cdb8f0886968fd89b590b0674679306803af6e8ee1a6ea595da51918122c81b949bd05f397ccec60a1a10c3fb7c7e9fb26c654654b7595b157249bd4439729479f9487d16c5590dbd6c9d5e6f25ec46ceabc3ae9af3b4101b7f132c40f233dd7031fdb1257e7a66b7bd72d7982913efc556c0782faf2a026b9855591f383e223ccce2f9cc47c2e85ba4c0223d3442cfea04104d3b48014da37aa19b57306cd18602b8c1955902007e772e70eac9fd19b9e520b3e54bb37015f8309d0e922883762fc1fc4aa8956e1c5f7b352db26b5f46996df5baf69100adaad7e9d7118cb4ae1fbbed3ea13f96779f1be6fb248ba5622afb4ebc92bcdf93f62c72a4b14";

/// A REAL deposit proof (1000 = 600 + 400, pool 0x1, root 0) produced by the
/// proving key that ships to browsers (`web/public/shield/proving_key.bin`),
/// whose embedded VK the harness checks equals `constants::verifying_key!()`.
/// 128 bytes: A(32) ‖ B(64) ‖ C(32), arkworks-compressed.
const PROOF: vector<u8> =
    x"eca0a440ff006d5810b643a0041f58a5725596cb36573c59c6f93bd58e5dc0a8967ec366bfe57a6cc44de3d6b8f8627e9fd3a9f9eba748c7b3f3ae792b5d781ce13973cfccfe318a21b4049b22dbdb147102dc4b9e81e234dcfdc80578c7e087490e101b5be0141ea53fec93f4ee243a4215a5fbe608603d287878f02a08790a";

/// 8 × 32-byte little-endian field elements, in the fixed order
/// [pool, root, public_value, null0, null1, comm0, comm1, hashed_secret].
/// public_value == 0x3e8 == 1000; hashed_secret == 0 (unsponsored `transact`).
const PUBLIC_INPUTS: vector<u8> =
    x"01000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e80300000000000000000000000000000000000000000000000000000000000068b59b5fc66d054e1d339dce435e50b8e1525d7c0b30c34bdaa67a3c7bc23425e768d3af10f791ea50d1cbc9ffd770ef6805ce05e748d6d571f98665dd99600ff7a09a217f9c58811c8a03387e65e5a56e0675b7f6bd4656be6144c68495de2c935e2af009e2e7403f54ca670f378eaa4b36aa8ab6ee3e4bec57af64172f34050000000000000000000000000000000000000000000000000000000000000000";

/// THE ROUND-TRIP IS LOSSLESS. If the snarkjs JSON representation dropped or
/// reordered anything — field-element endianness, G1 point compression, the Fq2
/// (c0, c1) limb order in G2, or the IC/gamma_abc vector — these 520 bytes would
/// differ from the package VK and this assertion would fail.
#[test]
fun roundtripped_vk_is_byte_identical_to_the_package_vk() {
    assert_eq!(VK_ROUNDTRIPPED, constants::verifying_key!());
}

/// THE ROUND-TRIPPED BYTES STILL VERIFY ON-CHAIN. This is the exact native call
/// `shielded_pool::process_transaction` makes, fed the VK that came back out of
/// the ceremony ecosystem's format plus a real proof.
#[test]
fun roundtripped_vk_verifies_a_real_proof_on_chain() {
    let curve = groth16::bn254();
    let pvk = groth16::prepare_verifying_key(&curve, &VK_ROUNDTRIPPED);
    let proof_points = groth16::proof_points_from_bytes(PROOF);
    let public_inputs = groth16::public_proof_inputs_from_bytes(PUBLIC_INPUTS);

    assert!(curve.verify_groth16_proof(&pvk, &public_inputs, &proof_points));
}

/// The same proof against the package VK read straight from `constants.move`
/// (not the pasted blob). Until now the suite's real-proof test used a DIFFERENT
/// single-party VK than the one the pool binds, so `constants::verifying_key!()`
/// had never been shown to accept a real proof. It has now.
#[test]
fun package_vk_verifies_a_real_proof_on_chain() {
    let curve = groth16::bn254();
    let pvk = groth16::prepare_verifying_key(&curve, &constants::verifying_key!());
    let proof_points = groth16::proof_points_from_bytes(PROOF);
    let public_inputs = groth16::public_proof_inputs_from_bytes(PUBLIC_INPUTS);

    assert!(curve.verify_groth16_proof(&pvk, &public_inputs, &proof_points));
}

// ===========================================================================
// PROOF THAT A REAL CEREMONY OUTPUT WORKS ON SUI
// ===========================================================================
// The blobs above establish that OUR key survives the snarkjs representation.
// They do not establish that a key which came OUT of an actual ceremony can be
// consumed by Sui. So a full ceremony was run end to end against the real,
// published Phase-1 transcript (`ceremony/verify.sh` reproduces it):
//
//   powersOfTau28_hez_final_15.ptau   (55 contributions, blake2b verified)
//     -> snarkjs groth16 setup
//     -> 3 independent `zkey contribute` rounds
//     -> `zkey beacon` with drand quicknet round 30749720
//        (randomness 051b2f1c368e48d5b4dc4ca40af5038ba87bfbee636b8de5f3fda1b5616a325d)
//     -> `zkey verify` == "ZKey Ok!"  (descent + every contribution + beacon)
//     -> `zkey export verificationkey`
//     -> `cargo run --bin ceremony_vk_import` -> the bytes below
//
// The circuit used was snarkjs' own `Multiplier(1000)` test circuit, NOT the
// Talise circuit — Talise's circuit has no `.r1cs` yet (see CEREMONY.md §2,
// "The blocker"). So this proves the PIPELINE and the FORMAT, not the Talise
// parameters. It has 1 public input, hence a 296-byte VK instead of 520.

/// Ceremony-derived VK (1 public input => 296 bytes), imported from the
/// ceremony's `verification_key.json`.
const CEREMONY_VK: vector<u8> =
    x"e2f26dbea299f5223b646cb1fb33eadb059d9407559d7441dfd902e3a79a4d2dabb73dc17fbc13021e2471e0c08bd67d8401f52b73d6d07483794cad4778180e0c06f33bbc4c79a9cadef253a68084d382f17788f885c9afd176f7cb2f036789edf692d95cbdde46ddda5ef7d422436779445c5e66006a42761e1f12efde0018c212f3aeb785e49712e7a9353349aaf1255dfb31b7bf60723a480d9293938e198bfbf895b8c6f144b04bd408b5d165b36fd406302c668f3a080f4faa5a2b990ea59cf62d976b8054ceecbb6902b3b2cc788d10b28bcb76527fa0d713f38db11c0200000000000000887b602f3c03a739ef00de3541ae0aeef6c52c0af8759502ff1993dd7896611a0312cf1aac44cdda674014961ba35b613a66c9d999655b06765e7e8181cca6a6";

/// A proof produced by SNARKJS (not arkworks) against that ceremony key.
const CEREMONY_PROOF: vector<u8> =
    x"07c736e77584043516d806e715005a082f9efdf2a6f4c3f2ada50de0a336749f5793fef7ce596b81ee530286dcf21b5bc42821d0066d8016567a6314370a8a226580219242c732d5e652afc244c158cfb01b57ac328a12d8ae74be1820fca7077db5d8a68052879782277d5bfb4ec5024e2c07ee5aa9d65ceaada38e7491658c";

/// Its single public signal, 32 bytes little-endian.
const CEREMONY_PUBLIC_INPUTS: vector<u8> =
    x"08aba90163b227d54013b7d1a892b20edf149a23acf810acf78e8baf8e770d11";

/// THE HEADLINE RESULT. A verifying key that came out of a genuine multi-party
/// ceremony — Perpetual Powers of Tau, three contributions, a public randomness
/// beacon, exported as snarkjs JSON — is accepted by Sui's native BN254 Groth16
/// verifier, and verifies a proof snarkjs produced. The ceremony ecosystem's
/// output is usable on Sui.
#[test]
fun a_real_ceremony_derived_vk_verifies_a_snarkjs_proof_on_chain() {
    let curve = groth16::bn254();
    let pvk = groth16::prepare_verifying_key(&curve, &CEREMONY_VK);
    let proof_points = groth16::proof_points_from_bytes(CEREMONY_PROOF);
    let public_inputs = groth16::public_proof_inputs_from_bytes(CEREMONY_PUBLIC_INPUTS);

    assert!(curve.verify_groth16_proof(&pvk, &public_inputs, &proof_points));
}

/// And it rejects a wrong public signal, so the acceptance above is meaningful.
#[test]
fun ceremony_vk_rejects_a_wrong_public_signal() {
    let curve = groth16::bn254();
    let pvk = groth16::prepare_verifying_key(&curve, &CEREMONY_VK);
    let proof_points = groth16::proof_points_from_bytes(CEREMONY_PROOF);

    let mut tampered = CEREMONY_PUBLIC_INPUTS;
    *&mut tampered[0] = 0x09;
    let public_inputs = groth16::public_proof_inputs_from_bytes(tampered);

    assert!(!curve.verify_groth16_proof(&pvk, &public_inputs, &proof_points));
}

/// Soundness floor for the round-tripped key: it must still REJECT a proof whose
/// public inputs were tampered with (public_value 1000 -> 1001). A VK that
/// accepted anything would trivially "pass" the test above.
#[test]
fun roundtripped_vk_rejects_tampered_public_inputs() {
    let curve = groth16::bn254();
    let pvk = groth16::prepare_verifying_key(&curve, &VK_ROUNDTRIPPED);
    let proof_points = groth16::proof_points_from_bytes(PROOF);

    // Byte 64 is the low byte of public input [2] (public_value): 0xe8 -> 0xe9,
    // i.e. 1000 -> 1001. Value is no longer conserved, so the proof must fail.
    let mut tampered = PUBLIC_INPUTS;
    *&mut tampered[64] = 0xe9;
    let public_inputs = groth16::public_proof_inputs_from_bytes(tampered);

    assert!(!curve.verify_groth16_proof(&pvk, &public_inputs, &proof_points));
}
