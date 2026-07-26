#!/usr/bin/env bash
# STEP 2 — CONTRIBUTOR. This is the whole job. One command.
#
#   ./02_contribute.sh circuit.r1cs ceremony_0000.zkey "Your Name"
#
# WHAT YOU ARE DOING
# ------------------
# You are injecting a random secret into Talise's shielded-pool proving
# parameters and then destroying it. If ANY ONE contributor destroys their
# secret, nobody can forge a proof and mint money out of the pool. You do not
# need to trust Talise, the other contributors, or each other — only yourself.
#
# WHY YOU DO NOT HAVE TO TRUST US
# -------------------------------
# Before touching anything, this script:
#   1. downloads the Phase-1 Powers-of-Tau transcript from the URL the snarkjs
#      project publishes (not from us) and checks its BLAKE2b digest against the
#      digest in the snarkjs README (not from us);
#   2. runs `snarkjs zkey verify` on the file we handed you. That re-derives the
#      base parameters from (circuit.r1cs, Phase-1) and checks every prior
#      contribution. If we gave you a doctored file, this fails and stops;
#   3. installs snarkjs from the public npm registry at a pinned version, using
#      your npm. We ship you no binaries.
#
# YOUR SECRET NEVER LEAVES YOUR MACHINE. It is generated here from your OS
# CSPRNG (plus anything you type), used once, and dropped. Nothing is uploaded.
# When you are done you publish a HASH, not a secret.
#
# AFTERWARDS
#   * publish the attestation file this prints (a gist, a tweet, a PR — anywhere
#     public and timestamped). Sign it with GPG if you have a key.
#   * hand the output .zkey to the coordinator or the next contributor.
#   * you are done. Nothing to keep, nothing to protect.

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

R1CS="${1:-}"
IN_ZKEY="${2:-}"
NAME="${3:-}"

if [[ -z "$R1CS" || -z "$IN_ZKEY" || -z "$NAME" ]]; then
  cat >&2 <<'USAGE'
usage: ./02_contribute.sh <circuit.r1cs> <input.zkey> "Your Name"

  circuit.r1cs  the circuit, published by the coordinator
  input.zkey    the parameters so far (ceremony_0000.zkey for the first
                contributor, ceremony_0001.zkey for the second, ...)
  "Your Name"   how you want to be credited in the transcript

Everything else — the Phase-1 transcript, snarkjs, your entropy — this script
fetches or generates itself.
USAGE
  exit 2
fi
[[ -f "$R1CS" ]]    || die "no such file: $R1CS"
[[ -f "$IN_ZKEY" ]] || die "no such file: $IN_ZKEY"

# Next index from the input filename (ceremony_0003.zkey -> 0004).
BASE="$(basename "$IN_ZKEY")"
IDX="$(printf '%s' "$BASE" | sed -n 's/.*_\([0-9][0-9]*\)\.zkey/\1/p')"
[[ -n "$IDX" ]] || die "cannot read a contribution index out of '$BASE'.
  Expected a name like ceremony_0000.zkey."
NEXT="$(printf '%04d' $((10#$IDX + 1)))"
OUT_ZKEY="$(dirname "$IN_ZKEY")/ceremony_${NEXT}.zkey"
ATTEST="$(dirname "$IN_ZKEY")/attestation_${NEXT}.txt"
[[ ! -e "$OUT_ZKEY" ]] || die "$OUT_ZKEY already exists — refusing to overwrite."

c_bold "=== TALISE SHIELDED-POOL CEREMONY — CONTRIBUTION #${NEXT} ==="
echo "contributor : $NAME"
echo "input       : $IN_ZKEY"
echo "output      : $OUT_ZKEY"
echo
check_prereqs

# --- 1. the Phase-1 transcript, verified by you ----------------------------
fetch_and_verify_phase1

# --- 2. verify what we handed you ------------------------------------------
echo
c_bold "Verifying the parameters you were given (this is the step that means you"
c_bold "do not have to trust anyone). It re-derives the base from the circuit +"
c_bold "Phase-1 transcript and checks every contribution before yours."
echo
if ! sj zkey verify "$R1CS" "$PHASE1_PATH" "$IN_ZKEY"; then
  c_red "VERIFICATION FAILED."
  echo "The file you were given does not descend from the published Phase-1"
  echo "transcript and this circuit, or a prior contribution is malformed."
  die "STOP. Do not contribute. Report this publicly."
fi
c_green "Input parameters VERIFIED. Safe to contribute."

# --- 3. your entropy -------------------------------------------------------
echo
c_bold "Generating your secret."
echo "It comes from your operating system's CSPRNG. You may also type random"
echo "characters to mix in — optional, and it is NOT a password, so do not use"
echo "one. Press ENTER to skip."
echo
OS_ENTROPY="$(openssl rand -hex 64)"
TYPED=""
if [[ -t 0 ]]; then
  read -r -p "extra random characters (optional): " TYPED || true
fi
# Mix: OS CSPRNG || anything typed || high-resolution time. The OS bytes alone
# are sufficient; the rest can only add.
ENTROPY="$(printf '%s|%s|%s|%s' "$OS_ENTROPY" "$TYPED" "$(date +%s%N 2>/dev/null || date +%s)" "$(openssl rand -hex 32)")"
unset OS_ENTROPY TYPED

# --- 4. contribute ---------------------------------------------------------
echo
c_bold "Contributing (a minute or two)..."
CONTRIB_LOG="$(mktemp)"
if ! sj zkey contribute "$IN_ZKEY" "$OUT_ZKEY" --name="$NAME" -e="$ENTROPY" -v 2>&1 | tee "$CONTRIB_LOG"; then
  unset ENTROPY
  rm -f "$CONTRIB_LOG"
  die "contribution failed"
fi
# Drop the secret from this shell immediately.
unset ENTROPY

# --- 5. verify your own output ---------------------------------------------
echo
c_bold "Verifying your output..."
sj zkey verify "$R1CS" "$PHASE1_PATH" "$OUT_ZKEY" >/dev/null \
  || die "your output zkey does not verify — do NOT publish it, re-run this script"
c_green "Your contribution VERIFIED."

# --- 6. the attestation you publish ---------------------------------------
CONTRIB_HASH="$(sed -n '/Contribution Hash/,$p' "$CONTRIB_LOG" | tr -d ' \t' | grep -Eo '^[0-9a-f]{8,}$' | head -6 | tr -d '\n')"
CIRCUIT_HASH="$(sed -n '/Circuit Hash/,$p' "$CONTRIB_LOG" | tr -d ' \t' | grep -Eo '^[0-9a-f]{8,}$' | head -12 | tr -d '\n')"
rm -f "$CONTRIB_LOG"

cat > "$ATTEST" <<EOF
Talise shielded-pool Groth16 Phase-2 ceremony — contribution #${NEXT}

contributor        : ${NAME}
date (UTC)         : $(date -u +"%Y-%m-%dT%H:%M:%SZ")
snarkjs version    : ${SNARKJS_VERSION}

circuit
  file             : $(basename "$R1CS")
  sha256           : $(sha256_file "$R1CS")
  circuit hash     : ${CIRCUIT_HASH:-<see snarkjs output>}

phase 1 transcript
  file             : ${PHASE1_FILE}
  blake2b512       : ${PHASE1_BLAKE2B}

input parameters
  file             : $(basename "$IN_ZKEY")
  sha256           : $(sha256_file "$IN_ZKEY")

my contribution
  output file      : $(basename "$OUT_ZKEY")
  sha256           : $(sha256_file "$OUT_ZKEY")
  contribution hash: ${CONTRIB_HASH:-<see snarkjs output>}

I generated my secret randomness on my own machine, used it once, and destroyed
it. I did not record it, copy it, or transmit it. To the best of my knowledge my
machine was not compromised while I ran this.

Anyone can check this contribution is in the final parameters by running
  snarkjs zkey verify $(basename "$R1CS") ${PHASE1_FILE} <final.zkey>
and looking for "contribution #${NEXT} ${NAME}" with the contribution hash above.
EOF

echo
c_green "=== DONE. THANK YOU. ==="
echo
cat "$ATTEST"
echo
c_bold "Two things to do:"
echo "  1. PUBLISH ${ATTEST}"
echo "     somewhere public and timestamped (gist, PR, social post). Sign it if"
echo "     you have a GPG key:  gpg --clearsign ${ATTEST}"
echo "  2. Send ${OUT_ZKEY} to the coordinator or the next contributor."
echo
c_bold "Nothing to keep. Nothing to protect. Your secret is gone."
