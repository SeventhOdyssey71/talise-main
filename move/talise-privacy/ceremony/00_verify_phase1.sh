#!/usr/bin/env bash
# STEP 0 — fetch and verify the Phase-1 Powers-of-Tau transcript.
#
# Phase 1 is NOT run for Talise. The Talise circuit is 18,166 constraints, which
# fits inside the 2^15 (32,768) prepared Perpetual Powers of Tau transcript for
# BN254 — a transcript with 55 published contributions that already exists and is
# used by most of the BN254 ecosystem. Re-running Phase 1 would produce something
# strictly weaker (fewer contributors) at large cost.
#
# What this script does:
#   1. downloads powersOfTau28_hez_final_15.ptau from the published URL,
#   2. checks its size and BLAKE2b-512 against the digest published in the
#      snarkjs README,
#   3. optionally re-verifies the entire 55-contribution chain with
#      `snarkjs powersoftau verify` (slow: expect 10+ minutes).
#
# Usage:
#   ./00_verify_phase1.sh              # digest check only (seconds)
#   ./00_verify_phase1.sh --full       # also re-verify the whole chain (slow)
#
# Work directory defaults to ./talise-ceremony; override with
# TALISE_CEREMONY_WORK.

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

c_bold "=== TALISE CEREMONY — STEP 0: PHASE-1 TRANSCRIPT ==="
echo
check_prereqs
fetch_and_verify_phase1

if [[ "${1:-}" == "--full" ]]; then
  echo
  c_bold "Re-verifying the full Phase-1 contribution chain with snarkjs."
  c_bold "This checks all 55 contributions and the beacon. IT IS SLOW (10+ min)."
  echo
  sj powersoftau verify "$PHASE1_PATH"
  c_green "Phase-1 chain re-verified independently."
else
  echo
  echo "Digest check only. To re-verify all 55 contributions yourself:"
  echo "  $0 --full"
fi

echo
c_green "STEP 0 DONE. Transcript at: $PHASE1_PATH"
