//! PHASE-0 FIXTURE PROVER for `talise_privacy::poc_relayer_fee_drain_tests`.
//!
//! Generates the three REAL Groth16 proofs that module pastes as constants, all
//! bound to the deterministic `test_scenario` pool address and all verified here
//! against the PERSISTED package VK (`constants.move::verifying_key!()`), so
//! `sui::groth16` accepts them on-chain:
//!
//!   LEG A — DEP: an honest DEPOSIT of `--amount` into ONE note (note0 holds the
//!           whole amount, note1 is a zero sibling). Funds the pool and gives
//!           LEG C something real to spend. Lands at leaves 0 and 1.
//!
//!   LEG B — ATK: a trivial ALL-ZERO-VALUE internal transfer (`public_amount ==
//!           0`), provable by anyone with no notes at all because zero-amount
//!           inputs skip the Merkle-membership constraint. This is the leg the
//!           F-1 drain rode on: it carries no value, so no fee is fundable, and
//!           `shielded_pool` must now REFUSE any `relayer_fee` on it (811).
//!           With `relayer_fee == 0` it is a legitimate private transfer and
//!           must still succeed, leaving the pool balance untouched.
//!
//!   LEG C — WD: a PARTIAL WITHDRAW of `--withdraw` that spends LEG A's note0
//!           against the POST-DEPOSIT root, leaving `amount - withdraw` as
//!           change in a fresh note. This is the leg a legitimate relayer fee is
//!           payable on, and the fixture the fee-cap tests exercise.
//!
//! NOTE (this is the point of the F-1 fix, kept visible here): NOTHING about
//! LEG C's proof depends on the relayer fee. `ext_data.public_value()` on a
//! withdraw is `-value`, fee-independent, so the SAME proof is valid for fee 0,
//! for the capped fee, and for an over-cap fee. The fee is therefore bounded
//! ON-CHAIN, not by the circuit — see UPGRADE-PHASE0.md.
//!
//! Usage (the proving key is gitignored; point at wherever keygen left it):
//!   cargo run --release --bin relayer_fee_fixture_proofs -- \
//!     --pool 0xdba72804cc9504a82bbaa13ed4a83a0e2c6219d7e45125cf57fd10cbab957a97 \
//!     --root 4023688209857926016730691838838984168964497755397275208674494663143007853450 \
//!     --amount 1000000 --withdraw 400000 \
//!     --keys-dir /abs/path/to/move/talise-privacy/circuit/keys
//!
//! `--pool` / `--root` are the values `fixture_binding_is_stable` asserts in
//! `poc_relayer_fee_drain_tests.move` (test_scenario ids are deterministic).

use ark_bn254::{Bn254, Fr};
use ark_crypto_primitives::snark::SNARK;
use ark_ff::{AdditiveGroup, PrimeField, UniformRand};
use ark_groth16::{prepare_verifying_key, Groth16};
use rand::rngs::OsRng;
use std::path::Path as FsPath;

use talise_privacy_circuit::circuit::TransactionCircuit;
use talise_privacy_circuit::constants::{MERKLE_TREE_LEVEL, ZERO_VALUE};
use talise_privacy_circuit::merkle_tree::{Path, SparseMerkleTree};
use talise_privacy_circuit::poseidon_opt::{hash1, hash3, hash4, PoseidonOptimized};
use talise_privacy_circuit::prover::{
    load_keys, pool_address_to_field, proof_hex, u256_decimal_to_field, vk_hex,
};

/// nullifier = Poseidon3(commitment, path_index, Poseidon3(privkey, commitment, path_index)).
fn nullifier(privkey: &Fr, commitment: &Fr, path_index: &Fr) -> Fr {
    let sig = hash3(privkey, commitment, path_index);
    hash3(commitment, path_index, &sig)
}

fn dec(fe: &Fr) -> String {
    fe.into_bigint().to_string()
}

fn main() -> anyhow::Result<()> {
    let mut pool = None::<String>;
    let mut root = None::<String>;
    let mut amount: u64 = 1_000_000;
    let mut withdraw: u64 = 400_000;
    let mut keys_dir = "keys".to_string();
    let mut it = std::env::args().skip(1);
    while let Some(a) = it.next() {
        match a.as_str() {
            "--pool" => pool = it.next(),
            "--root" => root = it.next(),
            "--amount" => amount = it.next().unwrap().parse()?,
            "--withdraw" => withdraw = it.next().unwrap().parse()?,
            "--keys-dir" => keys_dir = it.next().unwrap(),
            other => anyhow::bail!("unknown arg {other}"),
        }
    }
    let pool = pool.ok_or_else(|| anyhow::anyhow!("--pool required"))?;
    let root = root.ok_or_else(|| anyhow::anyhow!("--root required"))?;
    if withdraw == 0 || withdraw > amount {
        anyhow::bail!("--withdraw must be in 1..=amount");
    }

    let vortex = pool_address_to_field(&pool)?;
    let root_fe = u256_decimal_to_field(&root)?;
    let (pk, vk) = load_keys(FsPath::new(&keys_dir))?;
    let pvk = prepare_verifying_key(&vk);
    let hasher = PoseidonOptimized::new_t3();
    let empty_leaf = u256_decimal_to_field(ZERO_VALUE)?;
    let mut rng = OsRng;

    eprintln!("VK == {}", vk_hex(&vk)?);

    // ── LEG A: honest deposit of `amount`, ALL of it in note0 ────────────────
    let note0_privkey = Fr::rand(&mut rng);
    let note0_blinding = Fr::rand(&mut rng);
    let note0_amount = Fr::from(amount);
    let note0_pubkey = hash1(&note0_privkey);
    let note0_commitment = hash4(&note0_amount, &note0_pubkey, &note0_blinding, &vortex);

    let note1_privkey = Fr::rand(&mut rng);
    let note1_blinding = Fr::rand(&mut rng);
    let note1_pubkey = hash1(&note1_privkey);
    let note1_commitment = hash4(&Fr::ZERO, &note1_pubkey, &note1_blinding, &vortex);

    // Two distinct random dummy zero-value inputs (amount 0 ⇒ membership skipped).
    let din0_privkey = Fr::rand(&mut rng);
    let din0_blinding = Fr::rand(&mut rng);
    let din0_idx = Fr::from(0u64);
    let din0_commitment = hash4(&Fr::ZERO, &hash1(&din0_privkey), &din0_blinding, &vortex);
    let dep_null0 = nullifier(&din0_privkey, &din0_commitment, &din0_idx);
    let din1_privkey = Fr::rand(&mut rng);
    let din1_blinding = Fr::rand(&mut rng);
    let din1_idx = Fr::from(1u64);
    let din1_commitment = hash4(&Fr::ZERO, &hash1(&din1_privkey), &din1_blinding, &vortex);
    let dep_null1 = nullifier(&din1_privkey, &din1_commitment, &din1_idx);
    assert_ne!(dep_null0, dep_null1, "deposit dummy nullifiers must differ");

    let dep_circuit = TransactionCircuit::new(
        vortex,
        root_fe,
        Fr::from(amount), // public_amount = +amount (deposit)
        dep_null0,
        dep_null1,
        note0_commitment,
        note1_commitment,
        Fr::ZERO,
        Fr::ZERO,
        [din0_privkey, din1_privkey],
        [Fr::ZERO, Fr::ZERO],
        [din0_blinding, din1_blinding],
        [din0_idx, din1_idx],
        [Path::<MERKLE_TREE_LEVEL>::empty(), Path::empty()],
        [note0_pubkey, note1_pubkey],
        [note0_amount, Fr::ZERO],
        [note0_blinding, note1_blinding],
    )?;
    let dep_pi = dep_circuit.get_public_inputs();
    let dep_proof = Groth16::<Bn254>::prove(&pk, dep_circuit, &mut rng)
        .map_err(|e| anyhow::anyhow!("dep prove: {e}"))?;
    anyhow::ensure!(
        Groth16::<Bn254>::verify_proof(&pvk, &dep_proof, &dep_pi)
            .map_err(|e| anyhow::anyhow!("{e}"))?,
        "deposit proof must verify against the persisted VK"
    );

    // ── LEG B: the F-1 leg — all-zero internal transfer (public_amount = 0) ──
    let ain0_privkey = Fr::rand(&mut rng);
    let ain0_blinding = Fr::rand(&mut rng);
    let ain0_idx = Fr::from(2u64);
    let ain0_commitment = hash4(&Fr::ZERO, &hash1(&ain0_privkey), &ain0_blinding, &vortex);
    let atk_null0 = nullifier(&ain0_privkey, &ain0_commitment, &ain0_idx);
    let ain1_privkey = Fr::rand(&mut rng);
    let ain1_blinding = Fr::rand(&mut rng);
    let ain1_idx = Fr::from(3u64);
    let ain1_commitment = hash4(&Fr::ZERO, &hash1(&ain1_privkey), &ain1_blinding, &vortex);
    let atk_null1 = nullifier(&ain1_privkey, &ain1_commitment, &ain1_idx);
    assert_ne!(atk_null0, atk_null1);

    let aout0_privkey = Fr::rand(&mut rng);
    let aout0_blinding = Fr::rand(&mut rng);
    let aout0_pubkey = hash1(&aout0_privkey);
    let atk_comm0 = hash4(&Fr::ZERO, &aout0_pubkey, &aout0_blinding, &vortex);
    let aout1_privkey = Fr::rand(&mut rng);
    let aout1_blinding = Fr::rand(&mut rng);
    let aout1_pubkey = hash1(&aout1_privkey);
    let atk_comm1 = hash4(&Fr::ZERO, &aout1_pubkey, &aout1_blinding, &vortex);

    let atk_circuit = TransactionCircuit::new(
        vortex,
        root_fe, // the genesis root — still in the ring buffer after LEG A
        Fr::ZERO, // public_amount = 0 (internal transfer, no value)
        atk_null0,
        atk_null1,
        atk_comm0,
        atk_comm1,
        Fr::ZERO,
        Fr::ZERO,
        [ain0_privkey, ain1_privkey],
        [Fr::ZERO, Fr::ZERO],
        [ain0_blinding, ain1_blinding],
        [ain0_idx, ain1_idx],
        [Path::<MERKLE_TREE_LEVEL>::empty(), Path::empty()],
        [aout0_pubkey, aout1_pubkey],
        [Fr::ZERO, Fr::ZERO],
        [aout0_blinding, aout1_blinding],
    )?;
    let atk_pi = atk_circuit.get_public_inputs();
    let atk_proof = Groth16::<Bn254>::prove(&pk, atk_circuit, &mut rng)
        .map_err(|e| anyhow::anyhow!("atk prove: {e}"))?;
    anyhow::ensure!(
        Groth16::<Bn254>::verify_proof(&pvk, &atk_proof, &atk_pi)
            .map_err(|e| anyhow::anyhow!("{e}"))?,
        "zero-value transfer proof must verify against the persisted VK"
    );

    // ── POST-DEPOSIT TREE: LEG A's pair at leaves 0 and 1 ────────────────────
    // `merkle::append_pair` on-chain computes the same root (Phase-0 Poseidon
    // parity gate), and the Move test asserts `pool.root() == WD_ROOT`.
    let mut tree = SparseMerkleTree::<MERKLE_TREE_LEVEL>::new_empty(&hasher, &empty_leaf);
    tree.insert_pair(note0_commitment, note1_commitment, &hasher)?;
    let post_deposit_root = tree.root();
    let note0_path: Path<MERKLE_TREE_LEVEL> = tree.generate_membership_proof(0)?;
    assert_eq!(
        note0_path.calculate_root(&note0_commitment, &hasher)?,
        post_deposit_root,
        "note0 membership must recompute the post-deposit root"
    );

    // ── LEG C: partial withdraw of `withdraw`, spending LEG A's note0 ────────
    let win0_idx = Fr::from(0u64); // note0's real leaf index
    let wd_null0 = nullifier(&note0_privkey, &note0_commitment, &win0_idx);
    let win1_privkey = Fr::rand(&mut rng);
    let win1_blinding = Fr::rand(&mut rng);
    let win1_idx = Fr::from(7u64); // distinct; amount 0 ⇒ membership skipped
    let win1_commitment = hash4(&Fr::ZERO, &hash1(&win1_privkey), &win1_blinding, &vortex);
    let wd_null1 = nullifier(&win1_privkey, &win1_commitment, &win1_idx);
    assert_ne!(wd_null0, wd_null1);
    for other in [dep_null0, dep_null1, atk_null0, atk_null1] {
        assert_ne!(wd_null0, other, "withdraw nullifier must not collide");
        assert_ne!(wd_null1, other, "withdraw nullifier must not collide");
    }

    // Change note holds `amount - withdraw`; the second output is a zero note.
    let change = amount - withdraw;
    let wout0_privkey = Fr::rand(&mut rng);
    let wout0_blinding = Fr::rand(&mut rng);
    let wout0_pubkey = hash1(&wout0_privkey);
    let wout0_amount = Fr::from(change);
    let wd_comm0 = hash4(&wout0_amount, &wout0_pubkey, &wout0_blinding, &vortex);
    let wout1_privkey = Fr::rand(&mut rng);
    let wout1_blinding = Fr::rand(&mut rng);
    let wout1_pubkey = hash1(&wout1_privkey);
    let wd_comm1 = hash4(&Fr::ZERO, &wout1_pubkey, &wout1_blinding, &vortex);

    let wd_circuit = TransactionCircuit::new(
        vortex,
        post_deposit_root,
        Fr::ZERO - Fr::from(withdraw), // public_amount = r - withdraw
        wd_null0,
        wd_null1,
        wd_comm0,
        wd_comm1,
        Fr::ZERO,
        Fr::ZERO,
        [note0_privkey, win1_privkey],
        [note0_amount, Fr::ZERO],
        [note0_blinding, win1_blinding],
        [win0_idx, win1_idx],
        [note0_path, Path::empty()],
        [wout0_pubkey, wout1_pubkey],
        [wout0_amount, Fr::ZERO],
        [wout0_blinding, wout1_blinding],
    )?;
    let wd_pi = wd_circuit.get_public_inputs();
    let wd_proof = Groth16::<Bn254>::prove(&pk, wd_circuit, &mut rng)
        .map_err(|e| anyhow::anyhow!("wd prove: {e}"))?;
    anyhow::ensure!(
        Groth16::<Bn254>::verify_proof(&pvk, &wd_proof, &wd_pi)
            .map_err(|e| anyhow::anyhow!("{e}"))?,
        "withdraw proof must verify against the persisted VK"
    );

    // ── Emit Move constants ──────────────────────────────────────────────────
    println!("// --- paste into poc_relayer_fee_drain_tests.move ---");
    println!("const DEPOSIT_AMOUNT: u64 = {amount};");
    println!("const WITHDRAW_AMOUNT: u64 = {withdraw};");
    println!("const DEP_PROOF: vector<u8> = x\"{}\";", proof_hex(&dep_proof)?);
    println!("const DEP_ROOT: u256 = {};", dec(&dep_pi[1]));
    println!("const DEP_PUBLIC_VALUE: u256 = {};", dec(&dep_pi[2]));
    println!("const DEP_NULL0: u256 = {};", dec(&dep_pi[3]));
    println!("const DEP_NULL1: u256 = {};", dec(&dep_pi[4]));
    println!("const DEP_COMM0: u256 = {};", dec(&dep_pi[5]));
    println!("const DEP_COMM1: u256 = {};", dec(&dep_pi[6]));
    println!("const ATK_PROOF: vector<u8> = x\"{}\";", proof_hex(&atk_proof)?);
    println!("const ATK_ROOT: u256 = {};", dec(&atk_pi[1]));
    println!("// ATK public_value (field, == 0) = {}", dec(&atk_pi[2]));
    println!("const ATK_NULL0: u256 = {};", dec(&atk_pi[3]));
    println!("const ATK_NULL1: u256 = {};", dec(&atk_pi[4]));
    println!("const ATK_COMM0: u256 = {};", dec(&atk_pi[5]));
    println!("const ATK_COMM1: u256 = {};", dec(&atk_pi[6]));
    println!("const WD_PROOF: vector<u8> = x\"{}\";", proof_hex(&wd_proof)?);
    println!("const WD_ROOT: u256 = {}; // == post-deposit on-chain root", dec(&wd_pi[1]));
    println!("const WD_PUBLIC_VALUE: u256 = {};", dec(&wd_pi[2]));
    println!("const WD_NULL0: u256 = {};", dec(&wd_pi[3]));
    println!("const WD_NULL1: u256 = {};", dec(&wd_pi[4]));
    println!("const WD_COMM0: u256 = {};", dec(&wd_pi[5]));
    println!("const WD_COMM1: u256 = {};", dec(&wd_pi[6]));
    Ok(())
}
