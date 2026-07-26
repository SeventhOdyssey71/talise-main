//! Native proving-cost breakdown for the Talise privacy circuit.
//!
//! The headline "140 ms native prove" hides where the time actually goes on a
//! phone. The browser prover (`src/wasm/mod.rs::prove`) does FOUR expensive
//! things on every single call, and only one of them is the Groth16 prove:
//!
//!   1. hex-decode the proving key       (3.87 MB binary arrives as a 7.74 MB
//!                                        hex STRING across the wasm boundary)
//!   2. `ProvingKey::deserialize_compressed`  (decompress + subgroup-check every
//!                                        G1/G2 point in the key — tens of
//!                                        thousands of modular square roots)
//!   3. synthesize constraints twice     (once for the `is_satisfied` sanity
//!                                        check, once inside `prove`)
//!   4. `Groth16::prove`                 (the MSMs + FFTs)
//!
//! This binary times each stage separately so the WASM total measured by
//! `test/wasm_bench.mjs` can be apportioned, and so we can say plainly whether
//! the 3.8 MB key or the prove itself is the mobile blocker.
//!
//! Usage:
//!   cargo run --release --bin bench_prove -- [--pk <path>] [--iters N]

use ark_bn254::{Bn254, Fr};
use ark_groth16::{prepare_verifying_key, Groth16, ProvingKey};
use ark_relations::r1cs::{ConstraintSynthesizer, ConstraintSystem};
use ark_serialize::{CanonicalDeserialize, CanonicalSerialize, Compress, Validate};
use std::path::{Path, PathBuf};
use std::time::Instant;

use talise_privacy_circuit::prover::{build_deposit_circuit, prove_deposit};

fn arg(name: &str) -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1).cloned())
}

fn ms(t: Instant) -> f64 {
    t.elapsed().as_secs_f64() * 1000.0
}

fn stat(label: &str, xs: &mut Vec<f64>) {
    xs.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let n = xs.len();
    let median = xs[n / 2];
    let mean = xs.iter().sum::<f64>() / n as f64;
    println!(
        "  {label:<38} n={n:<3} min {:>8.1}  median {:>8.1}  mean {:>8.1}  max {:>8.1}  (ms)",
        xs[0],
        median,
        mean,
        xs[n - 1]
    );
}

fn main() -> anyhow::Result<()> {
    let circuit_dir = Path::new(env!("CARGO_MANIFEST_DIR")).to_path_buf();
    let repo_root = circuit_dir
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .ok_or_else(|| anyhow::anyhow!("cannot locate repo root"))?
        .to_path_buf();
    let pk_path = arg("--pk")
        .map(PathBuf::from)
        .unwrap_or_else(|| repo_root.join("web/public/shield/proving_key.bin"));
    let iters: usize = arg("--iters").map_or(Ok(5), |s| s.parse())?;

    println!("=== TALISE PRIVACY — NATIVE PROVING COST BREAKDOWN ===");
    println!("host: {} / {}", std::env::consts::OS, std::env::consts::ARCH);
    println!("proving key: {}", pk_path.display());

    let pk_bytes = std::fs::read(&pk_path)?;
    println!(
        "proving key size: {} bytes ({:.2} MB binary, {:.2} MB as hex)\n",
        pk_bytes.len(),
        pk_bytes.len() as f64 / 1_048_576.0,
        (pk_bytes.len() * 2) as f64 / 1_048_576.0
    );

    // ---- circuit size -----------------------------------------------------
    let circuit = build_deposit_circuit(1000, 600, 400)?;
    let cs = ConstraintSystem::<Fr>::new_ref();
    let t = Instant::now();
    circuit.clone().generate_constraints(cs.clone())?;
    let synth_ms = ms(t);
    println!(
        "circuit: {} constraints, {} instance vars, {} witness vars \
         (synthesis {synth_ms:.1} ms)\n",
        cs.num_constraints(),
        cs.num_instance_variables(),
        cs.num_witness_variables(),
    );

    // ---- stage timings ----------------------------------------------------
    println!("STAGE TIMINGS ({iters} iterations each):");

    // (1) hex encode/decode — what the wasm boundary forces.
    let pk_hex = hex::encode(&pk_bytes);
    let mut v = vec![];
    for _ in 0..iters {
        let t = Instant::now();
        let d = hex::decode(&pk_hex)?;
        v.push(ms(t));
        std::hint::black_box(d);
    }
    stat("1. hex-decode proving key", &mut v);

    // (2a) deserialize WITH validation — what `wasm::prove` does today.
    let mut v = vec![];
    for _ in 0..iters {
        let t = Instant::now();
        let pk = ProvingKey::<Bn254>::deserialize_compressed(&pk_bytes[..])?;
        v.push(ms(t));
        std::hint::black_box(pk);
    }
    stat("2a. PK deserialize (Validate::Yes)", &mut v);

    // (2b) deserialize skipping subgroup checks. Safe here ONLY because the key
    //      is a fixed, integrity-checked asset the app ships itself — the points
    //      are not attacker-supplied. Included to size the possible win.
    let mut v = vec![];
    for _ in 0..iters {
        let t = Instant::now();
        let pk = ProvingKey::<Bn254>::deserialize_with_mode(
            &pk_bytes[..],
            Compress::Yes,
            Validate::No,
        )?;
        v.push(ms(t));
        std::hint::black_box(pk);
    }
    stat("2b. PK deserialize (Validate::No)", &mut v);

    let pk = ProvingKey::<Bn254>::deserialize_compressed(&pk_bytes[..])?;

    // (2c) THE FIX WORTH KNOWING ABOUT: the 3.7 MB is *compressed* — every G1/G2
    //      point stores only x, so loading it costs one modular square root per
    //      point to recover y. That, not the subgroup check, is where stage 2
    //      goes. Serving the key UNCOMPRESSED doubles the download (cached once
    //      in IndexedDB) and makes loading nearly free. Measure the trade.
    let mut pk_unc = Vec::new();
    pk.serialize_uncompressed(&mut pk_unc)?;
    let mut v = vec![];
    for _ in 0..iters {
        let t = Instant::now();
        let p = ProvingKey::<Bn254>::deserialize_with_mode(
            &pk_unc[..],
            Compress::No,
            Validate::No,
        )?;
        v.push(ms(t));
        std::hint::black_box(p);
    }
    println!(
        "  (uncompressed key would be {} bytes / {:.2} MB)",
        pk_unc.len(),
        pk_unc.len() as f64 / 1_048_576.0
    );
    stat("2c. PK deserialize UNCOMPRESSED, no validate", &mut v);

    // (3) the `is_satisfied` sanity check `wasm::prove` runs before proving.
    let mut v = vec![];
    for _ in 0..iters {
        let c = build_deposit_circuit(1000, 600, 400)?;
        let t = Instant::now();
        let cs = ConstraintSystem::<Fr>::new_ref();
        c.generate_constraints(cs.clone())?;
        let ok = cs.is_satisfied()?;
        v.push(ms(t));
        assert!(ok);
    }
    stat("3. witness build + is_satisfied check", &mut v);

    // (4) the Groth16 prove itself.
    let mut v = vec![];
    for _ in 0..iters {
        let c = build_deposit_circuit(1000, 600, 400)?;
        let t = Instant::now();
        let (proof, pubs) = prove_deposit(&pk, c)?;
        v.push(ms(t));
        std::hint::black_box((proof, pubs));
    }
    stat("4. Groth16 prove", &mut v);

    // (5) verify, for completeness.
    let c = build_deposit_circuit(1000, 600, 400)?;
    let (proof, pubs) = prove_deposit(&pk, c)?;
    let pvk = prepare_verifying_key(&pk.vk);
    let mut v = vec![];
    for _ in 0..iters {
        let t = Instant::now();
        let ok = Groth16::<Bn254>::verify_proof(&pvk, &proof, &pubs)?;
        v.push(ms(t));
        assert!(ok);
    }
    stat("5. Groth16 verify", &mut v);

    println!(
        "\nNOTE: stages 1 + 2a + 3 + 4 are ALL paid on every `wasm::prove()` call,\n\
         because the wasm export takes the proving key as a hex string and\n\
         re-deserializes it each time. See test/wasm_bench.mjs for the WASM totals."
    );
    Ok(())
}
