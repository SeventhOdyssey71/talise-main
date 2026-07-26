#!/usr/bin/env bash
# THIRD-PARTY VERIFICATION. Run this to check Talise's claims yourself.
#
#   ./verify.sh <circuit.r1cs> <ceremony_final.zkey> [expected_vk_sui.hex]
#
# You need nothing from Talise except the published artefacts. Everything this
# checks is checkable against sources Talise does not control.
#
# WHAT IT PROVES
#   1. The Phase-1 transcript is the published Perpetual Powers of Tau file for
#      BN254 — size and BLAKE2b-512 match the digest in the snarkjs README.
#   2. The final parameters DESCEND FROM that transcript and from this exact
#      circuit. `snarkjs zkey verify` re-derives the zero-contribution base
#      itself from (r1cs, ptau) and refuses anything that does not match, so a
#      zkey built on a different Phase 1 or a different circuit cannot pass.
#   3. Every contribution in the chain is well formed, and each one's hash is
#      printed so you can match it against the contributors' own published
#      attestations.
#   4. The finalising beacon is reproducible: snarkjs re-derives the beacon
#      contribution from the published (beacon hash, iterations) and checks it.
#      You can independently fetch the drand round and confirm the hash.
#   5. The verifying key exported from these parameters converts to exactly the
#      bytes that are in `sources/constants.move` (if you pass the third arg).
#
# WHAT IT CANNOT PROVE
#   That a contributor actually destroyed their secret. Nothing can. That is the
#   1-of-N assumption — see CEREMONY.md §4.

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

R1CS="${1:-}"
FINAL="${2:-}"
EXPECT_VK="${3:-}"
[[ -n "$R1CS" && -n "$FINAL" ]] \
  || die "usage: $0 <circuit.r1cs> <ceremony_final.zkey> [expected_vk_sui.hex]"
[[ -f "$R1CS" ]]  || die "no such file: $R1CS"
[[ -f "$FINAL" ]] || die "no such file: $FINAL"

c_bold "=== TALISE CEREMONY — INDEPENDENT VERIFICATION ==="
echo
check_prereqs

c_bold "[1/5] Phase-1 transcript"
fetch_and_verify_phase1

echo
c_bold "[2/5] Artefact digests (compare these against the published manifest)"
echo "  sha256(circuit.r1cs)        = $(sha256_file "$R1CS")"
echo "  sha256(ceremony_final.zkey) = $(sha256_file "$FINAL")"
echo
sj r1cs info "$R1CS" 2>&1 | sed 's/^/  /'

echo
c_bold "[3/5] Descent + every contribution + the beacon"
echo "  (snarkjs re-derives the base from the circuit and the transcript, then"
echo "   walks the whole chain. This is the load-bearing check.)"
echo
if ! sj zkey verify "$R1CS" "$PHASE1_PATH" "$FINAL"; then
  c_red "FAILED. These parameters do NOT descend from the published Phase-1"
  c_red "transcript and this circuit, or a contribution is malformed."
  exit 1
fi
c_green "  Chain VERIFIED."

echo
c_bold "[4/5] Beacon, independently"
echo "  snarkjs printed the beacon generator and iteration count above. If the"
echo "  published manifest says drand round R, confirm the value yourself:"
echo "    curl ${DRAND_API}/${DRAND_CHAIN}/public/<R>"
echo "  and check that its 'randomness' equals the 'Beacon generator' snarkjs"
echo "  printed. Then confirm the round number was published BEFORE that round's"
echo "  timestamp: round R is produced at ${DRAND_GENESIS} + (R-1)*${DRAND_PERIOD} unix seconds."

echo
c_bold "[5/5] Verifying key -> the bytes actually deployed on Sui"
OUT="$(mktemp -d)"
sj zkey export verificationkey "$FINAL" "${OUT}/verification_key.json" >/dev/null
echo "  sha256(verification_key.json) = $(sha256_file "${OUT}/verification_key.json")"

if command -v cargo >/dev/null 2>&1; then
  ( cd "${CEREMONY_DIR}/../circuit" && \
    cargo run --release --quiet --bin ceremony_vk_import -- \
      "${OUT}/verification_key.json" --expect-npublic 8 --out "${OUT}/vk_sui.hex" ) \
    | sed 's/^/  /'
  if [[ -n "$EXPECT_VK" ]]; then
    if [[ ! -f "$EXPECT_VK" ]]; then
      die "no such file: $EXPECT_VK"
    fi
    A="$(tr -d '[:space:]' < "${OUT}/vk_sui.hex")"
    B="$(tr -d '[:space:]"x' < "$EXPECT_VK")"
    if [[ "$A" == "$B" ]]; then
      c_green "  DEPLOYED VK MATCHES THE CEREMONY OUTPUT, byte for byte."
    else
      c_red "  MISMATCH between the ceremony's VK and the one you supplied."
      echo "    ceremony : $A"
      echo "    supplied : $B"
      rm -rf "$OUT"
      exit 1
    fi
  else
    echo
    echo "  Pass a third argument (a file containing the hex from"
    echo "  sources/constants.move::verifying_key!()) to also check that the key"
    echo "  deployed on-chain is this one."
  fi
else
  c_red "  cargo not found — skipping the VK byte conversion."
  echo "  Install Rust (https://rustup.rs) to complete this step."
fi
rm -rf "$OUT"

echo
c_green "=== VERIFICATION COMPLETE ==="
echo
echo "What you have established: these proving parameters are built on the"
echo "published BN254 Powers-of-Tau transcript and this exact circuit, they"
echo "contain every published contribution, and they were finalised with a"
echo "reproducible public beacon."
echo
echo "What remains an assumption: that at least one contributor destroyed their"
echo "secret. No amount of verification can establish that. See CEREMONY.md §4."
