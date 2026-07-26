#!/usr/bin/env bash
# STEP 1 — COORDINATOR ONLY. Create the zero-contribution zkey.
#
# `snarkjs groth16 setup` is deterministic: given the same `.r1cs` and the same
# Phase-1 transcript it always produces the same `ceremony_0000.zkey`. It
# contains NO secret and is NOT safe to use — it has zero contributions. Its only
# job is to be the base of the contribution chain, and because it is
# deterministic every verifier re-derives it rather than trusting ours (that is
# exactly what `snarkjs zkey verify <r1cs> <ptau> <zkey>` does internally).
#
# Usage:
#   ./01_init.sh <circuit.r1cs>
#
# Publishes (see PUBLICATION.md):
#   ceremony_0000.zkey        the base
#   circuit.r1cs + sha256     so anyone can re-derive the base
#   phase1 digest             already checked in step 0

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

R1CS="${1:-}"
[[ -n "$R1CS" ]] || die "usage: $0 <circuit.r1cs>
  Talise's circuit does not have a .r1cs yet — see CEREMONY.md §2 'The blocker'.
  This script is complete and tested, but it cannot be run for the real circuit
  until the constraint system is available in circom's .r1cs format."
[[ -f "$R1CS" ]] || die "no such file: $R1CS"

c_bold "=== TALISE CEREMONY — STEP 1: INITIALISE (coordinator) ==="
echo
check_prereqs
fetch_and_verify_phase1

mkdir -p "$WORK_DIR"
cp -f "$R1CS" "${WORK_DIR}/circuit.r1cs"
R1CS="${WORK_DIR}/circuit.r1cs"

echo
c_bold "Circuit:"
sj r1cs info "$R1CS"
echo "  sha256(circuit.r1cs) = $(sha256_file "$R1CS")"

echo
c_bold "Checking the circuit fits the Phase-1 transcript..."
CONSTRAINTS="$(sj r1cs info "$R1CS" 2>&1 | sed -n 's/.*# of Constraints: *\([0-9]*\).*/\1/p' | head -1)"
if [[ -n "$CONSTRAINTS" ]]; then
  echo "  constraints: $CONSTRAINTS / $PHASE1_MAX_CONSTRAINTS available"
  if (( CONSTRAINTS > PHASE1_MAX_CONSTRAINTS )); then
    die "Circuit has $CONSTRAINTS constraints but this transcript only supports
  $PHASE1_MAX_CONSTRAINTS. Use powersOfTau28_hez_final_16.ptau (or larger) and
  update PHASE1_* in lib.sh — including the published digest."
  fi
fi

echo
c_bold "Running groth16 setup (deterministic, no secrets)..."
sj groth16 setup "$R1CS" "$PHASE1_PATH" "${WORK_DIR}/ceremony_0000.zkey"

echo
c_green "STEP 1 DONE."
echo "  base zkey : ${WORK_DIR}/ceremony_0000.zkey"
echo "  sha256    : $(sha256_file "${WORK_DIR}/ceremony_0000.zkey")"
echo
c_red "ceremony_0000.zkey has ZERO contributions and MUST NOT be used to secure funds."
echo "Next: publish circuit.r1cs + ceremony_0000.zkey + their digests, then hand"
echo "      ceremony_0000.zkey to contributor 1 (see 02_contribute.sh)."
