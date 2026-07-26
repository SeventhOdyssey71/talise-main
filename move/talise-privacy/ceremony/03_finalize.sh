#!/usr/bin/env bash
# STEP 3 — COORDINATOR. Finalise with a public randomness beacon.
#
# WHY A BEACON AT ALL. The last contributor in the chain is the only participant
# who sees the near-final parameters before choosing their secret. A beacon whose
# value nobody could know at announcement time removes that last-mover advantage
# and, per Bowe–Gabizon–Miers (eprint 2017/1050), removes the need for a
# precommitment round — that is what makes an open, come-as-you-are ceremony
# sound. It does NOT weaken or replace the 1-of-N honesty assumption.
#
# TWO-PHASE USE — this is the whole point, do not collapse it:
#
#   ./03_finalize.sh --announce "2026-08-01T12:00:00Z"
#       Prints the drand round number that will be produced at that instant.
#       PUBLISH THAT ROUND NUMBER NOW, before the round exists. Anyone can then
#       confirm afterwards that you did not shop for a favourable value.
#
#   ./03_finalize.sh --finalize <round> <circuit.r1cs> <last.zkey>
#       After the round has happened: fetches its randomness, feeds it to
#       `snarkjs zkey beacon`, and verifies the result.
#
# drand quicknet is unchained BLS (round N is signed independently), so round N
# cannot be produced early. Precedent note: the reference ceremonies used
# Ethereum RANDAO (PSE Perpetual Powers of Tau, 2023) or a future Bitcoin block
# hash (Zcash, 2018). drand is sound on the same argument but less precedented;
# if you prefer precedent over convenience, use a future Ethereum RANDAO value
# and pass its hex here instead — everything downstream is identical.

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

MODE="${1:-}"

case "$MODE" in
--announce)
  WHEN="${2:-}"
  [[ -n "$WHEN" ]] || die "usage: $0 --announce <ISO8601 UTC instant, e.g. 2026-08-01T12:00:00Z>"
  # GNU date and BSD date disagree; try both.
  TS="$(date -u -d "$WHEN" +%s 2>/dev/null || date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$WHEN" +%s 2>/dev/null)" \
    || die "cannot parse '$WHEN' — use the form 2026-08-01T12:00:00Z"
  NOW="$(date -u +%s)"
  (( TS > NOW + 3600 )) || die "pick an instant at least an hour in the future, or the
  announcement proves nothing."
  ROUND="$(drand_round_at "$TS")"
  BACK="$(drand_time_of_round "$ROUND")"

  c_bold "=== BEACON ANNOUNCEMENT — PUBLISH THIS NOW ==="
  cat <<EOF

Talise shielded-pool ceremony — beacon commitment

  beacon source     : drand (League of Entropy), quicknet chain
  chain hash        : ${DRAND_CHAIN}
  round             : ${ROUND}
  round produced at : $(date -u -r "$BACK" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -d "@$BACK" +"%Y-%m-%dT%H:%M:%SZ")
  iterations exp    : ${BEACON_ITERATIONS_EXP}   (snarkjs applies 2^${BEACON_ITERATIONS_EXP} SHA-256 iterations)
  verify with       : curl ${DRAND_API}/${DRAND_CHAIN}/public/${ROUND}

The final parameters will be produced by applying the randomness of exactly this
round. It does not exist yet and cannot be produced early, so nobody — including
Talise — can choose it.
EOF
  echo
  c_red "Publish the block above BEFORE round ${ROUND} occurs, or the beacon is worthless."
  ;;

--finalize)
  ROUND="${2:-}"
  R1CS="${3:-}"
  LAST="${4:-}"
  [[ -n "$ROUND" && -n "$R1CS" && -n "$LAST" ]] \
    || die "usage: $0 --finalize <round> <circuit.r1cs> <last.zkey>"
  [[ -f "$R1CS" ]] || die "no such file: $R1CS"
  [[ -f "$LAST" ]] || die "no such file: $LAST"

  c_bold "=== TALISE CEREMONY — STEP 3: FINALISE ==="
  check_prereqs
  fetch_and_verify_phase1

  echo
  c_bold "Verifying the contribution chain before finalising..."
  sj zkey verify "$R1CS" "$PHASE1_PATH" "$LAST" || die "chain does not verify — do not finalise"

  echo
  c_bold "Fetching drand round ${ROUND}..."
  BEACON="$(drand_randomness "$ROUND")"
  echo "  randomness: $BEACON"

  FINAL="$(dirname "$LAST")/ceremony_final.zkey"
  [[ ! -e "$FINAL" ]] || die "$FINAL already exists — refusing to overwrite."

  echo
  c_bold "Applying the beacon..."
  sj zkey beacon "$LAST" "$FINAL" "$BEACON" "$BEACON_ITERATIONS_EXP" \
    -n="drand quicknet round ${ROUND}"

  echo
  c_bold "Verifying the FINAL parameters..."
  sj zkey verify "$R1CS" "$PHASE1_PATH" "$FINAL"

  echo
  c_green "STEP 3 DONE."
  echo "  final zkey : $FINAL"
  echo "  sha256     : $(sha256_file "$FINAL")"
  echo "  beacon     : drand quicknet round ${ROUND} = ${BEACON}, 2^${BEACON_ITERATIONS_EXP} iterations"
  echo
  echo "Next: ./04_export_vk.sh $R1CS $FINAL"
  ;;

*)
  die "usage:
  $0 --announce <ISO8601 UTC instant>
  $0 --finalize <round> <circuit.r1cs> <last.zkey>"
  ;;
esac
