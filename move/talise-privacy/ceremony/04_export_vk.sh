#!/usr/bin/env bash
# STEP 4 — COORDINATOR. Turn the final zkey into the bytes Sui verifies with.
#
#   ./04_export_vk.sh <circuit.r1cs> <ceremony_final.zkey>
#
# Two conversions happen here, and both are checked:
#
#   1. zkey -> verification_key.json   (snarkjs)
#   2. verification_key.json -> 520 arkworks-compressed bytes
#      (`cargo run --bin ceremony_vk_import`), which is exactly what
#      `sui::groth16::prepare_verifying_key` parses and what goes into
#      `sources/constants.move::verifying_key!()`.
#
# Step 2 is the boundary that had to be proven lossless before any of this was
# worth doing — see CEREMONY.md §1 and `circuit/tests/snarkjs_vk_roundtrip.rs`.
#
# The proving key for the browser prover also comes out of the final zkey, but
# converting it needs `ark-circom`'s `read_zkey` and a `CircomReduction` prover —
# see CEREMONY.md §2. That is deliberately NOT automated here, because getting it
# wrong produces proofs that silently fail to verify.

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

R1CS="${1:-}"
FINAL="${2:-}"
[[ -n "$R1CS" && -n "$FINAL" ]] || die "usage: $0 <circuit.r1cs> <ceremony_final.zkey>"
[[ -f "$R1CS" ]]  || die "no such file: $R1CS"
[[ -f "$FINAL" ]] || die "no such file: $FINAL"
need cargo "Install Rust from https://rustup.rs"

OUT="$(dirname "$FINAL")"

c_bold "=== TALISE CEREMONY — STEP 4: EXPORT THE VERIFYING KEY ==="
check_prereqs
fetch_and_verify_phase1

echo
c_bold "Final sanity check on the parameters..."
sj zkey verify "$R1CS" "$PHASE1_PATH" "$FINAL"

echo
c_bold "Exporting verification_key.json..."
sj zkey export verificationkey "$FINAL" "${OUT}/verification_key.json"
echo "  sha256(verification_key.json) = $(sha256_file "${OUT}/verification_key.json")"

echo
c_bold "Converting to Sui VK bytes (arkworks-compressed)..."
( cd "${CEREMONY_DIR}/../circuit" && \
  cargo run --release --quiet --bin ceremony_vk_import -- \
    "${OUT}/verification_key.json" --expect-npublic 8 --out "${OUT}/vk_sui.hex" )

echo
c_green "STEP 4 DONE."
echo "  verification_key.json : ${OUT}/verification_key.json"
echo "  vk_sui.hex            : ${OUT}/vk_sui.hex"
echo
c_bold "Remaining, in order:"
cat <<'EOF'
  1. Paste vk_sui.hex into sources/constants.move::verifying_key!() and replace
     the single-party-key warning in that module header with the ceremony's
     provenance (transcript digest, contribution hashes, beacon round).
  2. Convert the final zkey into a browser proving key. This is NOT a paste job:
     see CEREMONY.md §2. The arkworks prover must switch to
     `Groth16::<Bn254, CircomReduction>`; the default `LibsnarkReduction` will
     produce proofs that do not verify.
  3. Re-run `sui move test` (the verify tests must pass against the new VK) and
     `node circuit/test/wasm_prove.test.mjs` with the new proving key.
  4. Mint a NEW pool. The VK binds at `new()`, so the old pool keeps the old key.
  5. Publish everything listed in ceremony/PUBLICATION.md.
EOF
