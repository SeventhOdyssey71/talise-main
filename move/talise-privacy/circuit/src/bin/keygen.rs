//! DEV / TEST Groth16 key generation for the Talise privacy circuit.
//!
//! WARNING: These are DEVELOPMENT keys, NOT a trusted-setup ceremony output.
//! The toxic waste is generated locally with OsRng and discarded in-process,
//! which is fine for tests/integration but UNSAFE for production funds.

use ark_bn254::Bn254;
use ark_groth16::Groth16;
use ark_serialize::CanonicalSerialize;
use rand::rngs::OsRng;

use std::fs;
use std::path::Path;
use talise_privacy_circuit::circuit::TransactionCircuit;

pub fn main() -> anyhow::Result<()> {
    println!("[DEV KEYS] Generating Groth16 proving/verifying keys (NOT a ceremony)...");

    let circuit = TransactionCircuit::empty();

    // Real entropy from the OS CSPRNG (NOT Vortex's [0u8; 32] ChaCha seed).
    let mut rng = OsRng;

    println!("Running setup (this may take a few minutes)...");
    let pk = Groth16::<Bn254>::generate_random_parameters_with_reduction(circuit, &mut rng)?;

    let vk = pk.vk.clone();

    let keys_dir = Path::new("keys");
    if !keys_dir.exists() {
        fs::create_dir_all(keys_dir)?;
    }

    // Verifying key — arkworks canonical compressed. This is byte-for-byte the
    // format Sui's `groth16::prepare_verifying_key(&bn254, &vk)` expects.
    let mut vk_bytes = Vec::new();
    vk.serialize_compressed(&mut vk_bytes)?;

    let mut pk_bytes = Vec::new();
    pk.serialize_compressed(&mut pk_bytes)?;

    fs::write(keys_dir.join("verification_key.bin"), &vk_bytes)?;
    fs::write(keys_dir.join("verification_key.hex"), hex::encode(&vk_bytes))?;
    fs::write(keys_dir.join("proving_key.bin"), &pk_bytes)?;
    fs::write(keys_dir.join("proving_key.hex"), hex::encode(&pk_bytes))?;

    println!(
        "[DEV KEYS] Done. Written to ./keys/ (vk {} bytes).",
        vk_bytes.len()
    );
    Ok(())
}
