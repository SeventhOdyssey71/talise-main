//! Native Groth16 prover + Sui-format serialization for the Talise privacy
//! circuit.
//!
//! This vendors the proving logic from Vortex's `wasm/mod.rs` but as a native
//! (non-wasm) helper, and uses REAL OS entropy (`OsRng`) for proof randomness
//! rather than Vortex's deterministic `ChaCha20Rng::from_seed([0u8; 32])`.
//!
//! Serialization formats produced here match what the Sui Move verifier
//! consumes (see `vortex_proof::make_public_inputs` /
//! `groth16::proof_points_from_bytes` / `groth16::prepare_verifying_key`):
//!
//! * `vk_hex`             — arkworks `VerifyingKey::serialize_compressed`
//!   (alpha_g1 ‖ beta_g2 ‖ gamma_g2 ‖ delta_g2 ‖ u64-LE-len ‖ gamma_abc_g1[]).
//!   This is byte-identical to what `groth16::prepare_verifying_key` expects.
//! * `proof_hex`          — proofA (32B compressed G1) ‖ proofB (64B compressed
//!   G2) ‖ proofC (32B compressed G1).
//! * `public_inputs_hex`  — the 8 public inputs, each a 32-byte little-endian
//!   field element, concatenated in allocation order:
//!   [pool/vortex, root, public_value, null0, null1, comm0, comm1, hashed_secret].

use crate::circuit::TransactionCircuit;
use crate::constants::{MERKLE_TREE_LEVEL, N_INS, N_OUTS};
use crate::merkle_tree::Path;
use crate::poseidon_opt::{hash1, hash3, hash4};

use ark_bn254::{Bn254, Fr};
use ark_crypto_primitives::snark::SNARK;
use ark_ff::{BigInteger, PrimeField};
use ark_groth16::{Groth16, Proof, ProvingKey, VerifyingKey};
use ark_serialize::CanonicalSerialize;
use rand::rngs::OsRng;

/// Result of building + proving a deposit transaction.
pub struct DepositArtifacts {
    pub pk: ProvingKey<Bn254>,
    pub vk: VerifyingKey<Bn254>,
    pub proof: Proof<Bn254>,
    pub public_inputs: Vec<Fr>,
}

/// Generate DEV/TEST Groth16 keys with real OS entropy.
///
/// NOT a trusted setup ceremony — the toxic waste lives (briefly) in this
/// process. Fine for tests / artifact generation, unsafe for production funds.
pub fn dev_setup() -> anyhow::Result<(ProvingKey<Bn254>, VerifyingKey<Bn254>)> {
    let mut rng = OsRng;
    let pk = Groth16::<Bn254>::generate_random_parameters_with_reduction(
        TransactionCircuit::empty(),
        &mut rng,
    )?;
    let vk = pk.vk.clone();
    Ok((pk, vk))
}

/// Build a witness for the SIMPLEST shielded op: a DEPOSIT of `amount` that
/// creates two output notes whose amounts sum to `amount`, with dummy (zero)
/// input notes.
///
/// `out0_amount + out1_amount` MUST equal `amount` for the value-conservation
/// constraint `sum_ins + public_amount == sum_outs` to hold (sum_ins == 0).
pub fn build_deposit_circuit(
    amount: u64,
    out0_amount: u64,
    out1_amount: u64,
) -> anyhow::Result<TransactionCircuit> {
    // Pool / "vortex" domain separator — an arbitrary fixed field element.
    let vortex = Fr::from(1u64);

    // ---- Dummy input notes (zero amount => Merkle membership check skipped) ----
    let in_private_keys = [Fr::from(12_345u64), Fr::from(67_890u64)];
    let in_amounts = [Fr::from(0u64), Fr::from(0u64)];
    let in_blindings = [Fr::from(999u64), Fr::from(888u64)];
    let in_path_indices = [Fr::from(0u64), Fr::from(1u64)];

    // Nullifiers must differ (circuit enforces null0 != null1).
    let mut input_nullifiers = [Fr::from(0u64); N_INS];
    for i in 0..N_INS {
        let pubkey = hash1(&in_private_keys[i]);
        let commitment = hash4(&in_amounts[i], &pubkey, &in_blindings[i], &vortex);
        let signature = hash3(&in_private_keys[i], &commitment, &in_path_indices[i]);
        input_nullifiers[i] = hash3(&commitment, &in_path_indices[i], &signature);
    }

    // ---- Output notes that sum to `amount` ----
    let out_private_keys = [Fr::from(11_111u64), Fr::from(22_222u64)];
    let out_public_keys = [hash1(&out_private_keys[0]), hash1(&out_private_keys[1])];
    let out_amounts = [Fr::from(out0_amount), Fr::from(out1_amount)];
    let out_blindings = [Fr::from(777u64), Fr::from(666u64)];

    let mut output_commitments = [Fr::from(0u64); N_OUTS];
    for i in 0..N_OUTS {
        output_commitments[i] = hash4(
            &out_amounts[i],
            &out_public_keys[i],
            &out_blindings[i],
            &vortex,
        );
    }

    // ---- Account secret (exercise the real hash1(secret) path) ----
    let account_secret = Fr::from(42u64);
    let hashed_account_secret = hash1(&account_secret);

    // Zero inputs => Merkle check skipped, so root can be 0.
    let root = Fr::from(0u64);

    // DEPOSIT: value flows INTO the pool, so public_amount == +amount and
    // sum_ins(0) + public_amount == sum_outs(amount).
    let public_amount = Fr::from(amount);

    let merkle_paths: [Path<MERKLE_TREE_LEVEL>; N_INS] = [Path::empty(), Path::empty()];

    TransactionCircuit::new(
        vortex,
        root,
        public_amount,
        input_nullifiers[0],
        input_nullifiers[1],
        output_commitments[0],
        output_commitments[1],
        hashed_account_secret,
        account_secret,
        in_private_keys,
        in_amounts,
        in_blindings,
        in_path_indices,
        merkle_paths,
        out_public_keys,
        out_amounts,
        out_blindings,
    )
}

/// Prove a deposit with the given (already-set-up) proving key.
pub fn prove_deposit(
    pk: &ProvingKey<Bn254>,
    circuit: TransactionCircuit,
) -> anyhow::Result<(Proof<Bn254>, Vec<Fr>)> {
    let public_inputs = circuit.get_public_inputs();
    // Real OS entropy for proof randomness — NOT a zero seed.
    let mut rng = OsRng;
    let proof = Groth16::<Bn254>::prove(pk, circuit, &mut rng)
        .map_err(|e| anyhow::anyhow!("Groth16 prove failed: {e}"))?;
    Ok((proof, public_inputs))
}

/// `vk_hex` — arkworks compressed verifying key (== Sui's expected vk bytes).
pub fn vk_hex(vk: &VerifyingKey<Bn254>) -> anyhow::Result<String> {
    let mut bytes = Vec::new();
    vk.serialize_compressed(&mut bytes)?;
    Ok(hex::encode(bytes))
}

/// `proof_hex` — proofA(32B G1) ‖ proofB(64B G2) ‖ proofC(32B G1), all
/// arkworks-compressed, matching `groth16::proof_points_from_bytes`.
pub fn proof_hex(proof: &Proof<Bn254>) -> anyhow::Result<String> {
    let mut a = Vec::new();
    proof.a.serialize_compressed(&mut a)?;
    let mut b = Vec::new();
    proof.b.serialize_compressed(&mut b)?;
    let mut c = Vec::new();
    proof.c.serialize_compressed(&mut c)?;
    debug_assert_eq!(a.len(), 32, "proofA must be 32 bytes (compressed G1)");
    debug_assert_eq!(b.len(), 64, "proofB must be 64 bytes (compressed G2)");
    debug_assert_eq!(c.len(), 32, "proofC must be 32 bytes (compressed G1)");
    let mut out = Vec::with_capacity(128);
    out.extend_from_slice(&a);
    out.extend_from_slice(&b);
    out.extend_from_slice(&c);
    Ok(hex::encode(out))
}

/// `public_inputs_hex` — each field element as a 32-byte LITTLE-ENDIAN integer,
/// concatenated in allocation order. This matches Move's
/// `bcs::to_bytes(&u256)` encoding used in `vortex_proof::make_public_inputs`.
pub fn public_inputs_hex(public_inputs: &[Fr]) -> String {
    let mut out = Vec::with_capacity(public_inputs.len() * 32);
    for fe in public_inputs {
        let mut le = fe.into_bigint().to_bytes_le();
        le.resize(32, 0u8); // pad/truncate to exactly 32 bytes
        out.extend_from_slice(&le);
    }
    hex::encode(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ark_groth16::prepare_verifying_key;
    use ark_relations::r1cs::ConstraintSynthesizer;
    use ark_relations::r1cs::ConstraintSystem;

    /// End-to-end: DEV setup -> deposit witness -> real proof -> native verify
    /// == true. Then print the three Sui-format hex artifacts.
    #[test]
    fn deposit_proof_verifies_and_prints_artifacts() {
        // 1) DEV keys (real entropy, NOT a ceremony).
        let (pk, vk) = dev_setup().expect("dev setup");

        // 2) Deposit of 1000 split into output notes 600 + 400.
        let circuit = build_deposit_circuit(1000, 600, 400).expect("build deposit");

        // Sanity: constraints are satisfiable before proving.
        let cs = ConstraintSystem::<Fr>::new_ref();
        circuit.clone().generate_constraints(cs.clone()).unwrap();
        assert!(
            cs.is_satisfied().unwrap(),
            "deposit witness must satisfy constraints (which: {:?})",
            cs.which_is_unsatisfied()
        );

        // 3) Prove.
        let (proof, public_inputs) = prove_deposit(&pk, circuit).expect("prove");
        assert_eq!(public_inputs.len(), 8, "8 public inputs expected");

        // 4) Native Groth16 verify == true.
        let pvk = prepare_verifying_key(&vk);
        let ok = Groth16::<Bn254>::verify_proof(&pvk, &proof, &public_inputs).expect("verify");
        assert!(ok, "deposit proof MUST verify against its public inputs");

        // 5) Serialize to Sui format + print.
        let vk_h = vk_hex(&vk).expect("vk hex");
        let proof_h = proof_hex(&proof).expect("proof hex");
        let pubs_h = public_inputs_hex(&public_inputs);

        println!("\n================ TALISE PRIVACY — DEPOSIT PROOF ARTIFACTS ================");
        println!("(DEV/TEST keys, real-entropy OsRng proof; NOT a trusted-setup ceremony)\n");
        println!("public_inputs (decimal, allocation order [pool,root,public_value,null0,null1,comm0,comm1,hashed_secret]):");
        let labels = [
            "pool/vortex",
            "root",
            "public_value",
            "null0",
            "null1",
            "comm0",
            "comm1",
            "hashed_secret",
        ];
        for (l, fe) in labels.iter().zip(public_inputs.iter()) {
            println!("  {l:>14} = {}", fe.into_bigint());
        }
        println!("\nvk_hex (len {} bytes):\n{vk_h}", vk_h.len() / 2);
        println!("\nproof_hex (len {} bytes):\n{proof_h}", proof_h.len() / 2);
        println!(
            "\npublic_inputs_hex (len {} bytes, 8 x 32B LE):\n{pubs_h}",
            pubs_h.len() / 2
        );
        println!("=========================================================================\n");
    }

    /// NEGATIVE: a value-conservation-violating witness must FAIL to verify.
    ///
    /// We prove an honest deposit (so the proof is well-formed) but then verify
    /// it against TAMPERED public inputs in which `public_value` no longer
    /// matches the output sum — i.e. value is not conserved. Groth16 must
    /// reject. We also assert the constraint system itself rejects an
    /// inconsistent witness (outputs sum to more than public_amount).
    #[test]
    fn value_conservation_violation_fails() {
        // (a) Constraint-level: outputs (600+500=1100) != public_amount (1000).
        let bad = build_deposit_circuit(1000, 600, 500).expect("build");
        let cs = ConstraintSystem::<Fr>::new_ref();
        bad.generate_constraints(cs.clone()).unwrap();
        assert!(
            !cs.is_satisfied().unwrap(),
            "non-conserving witness (out sum 1100 != public 1000) must NOT satisfy constraints"
        );

        // (b) Verifier-level: honest proof, but tampered public_value rejects.
        let (pk, vk) = dev_setup().expect("dev setup");
        let circuit = build_deposit_circuit(1000, 600, 400).expect("build");
        let (proof, mut public_inputs) = prove_deposit(&pk, circuit).expect("prove");

        // public_inputs[2] is `public_value`; bump it so conservation is broken.
        public_inputs[2] = Fr::from(9999u64);

        let pvk = prepare_verifying_key(&vk);
        let ok = Groth16::<Bn254>::verify_proof(&pvk, &proof, &public_inputs).expect("verify call");
        assert!(
            !ok,
            "proof MUST NOT verify against tampered (non-conserving) public inputs"
        );
    }
}
