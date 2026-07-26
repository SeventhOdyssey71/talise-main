#!/usr/bin/env bash
# Shared constants + helpers for the Talise shielded-pool Groth16 Phase-2
# ceremony. Sourced by every script here.
#
# READ THIS IF YOU ARE A CONTRIBUTOR: everything in this file is a public,
# checkable fact. You are not asked to trust Talise for any of it.
#   * The Phase-1 transcript is fetched from the URL the snarkjs project
#     publishes, and its BLAKE2b-512 digest is compared against the digest
#     printed in the snarkjs README. If either changes, the script stops.
#   * snarkjs is installed from npm at a pinned version by YOUR npm, not shipped
#     by us.
#   * Your entropy comes from your machine's CSPRNG (and optionally your
#     keyboard). It never leaves your machine and we never see it.

set -euo pipefail

# ---------------------------------------------------------------------------
# PHASE 1 — Perpetual Powers of Tau, BN254.
#
# The circom circuit is 16,561 constraints, but snarkjs' Groth16 domain must be
# >= 2x constraints, so the 2^16 (65,536) prepared transcript is required (2^15
# is too small). This exact file is the one the snarkjs README lists under
# "Prepare phase 2" for power 16. Phase 1 is NOT run — this transcript already
# has the full Perpetual Powers of Tau contribution chain.
#
# Published at: https://github.com/iden3/snarkjs/blob/master/README.md
# ---------------------------------------------------------------------------
PHASE1_FILE="powersOfTau28_hez_final_16.ptau"
PHASE1_URL="https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_16.ptau"
# BLAKE2b-512 of the file, exactly as published in the snarkjs README table.
PHASE1_BLAKE2B="6a6277a2f74e1073601b4f9fed6e1e55226917efb0f0db8a07d98ab01df1ccf43eb0e8c3159432acd4960e2f29fe84a4198501fa54c8dad9e43297453efec125"
PHASE1_BYTES="75580568"
PHASE1_MAX_CONSTRAINTS="65536"
# SHA-256 of the same file. NOT published by the project — computed locally when
# this runbook was written and recorded so that a future divergence is visible.
# The BLAKE2b digest above is the attested one; treat this as a secondary check.
PHASE1_SHA256_UNATTESTED="1c401abb57c9ce531370f3015c3e75c0892e0f32b8b1e94ace0f6682d9695922"

# Independent mirror + attestations (per-contribution READMEs, IPFS CIDs, GPG
# keys) live here. A contributor who wants to check the transcript's provenance
# rather than just its digest should start here.
PHASE1_ATTESTATIONS="https://github.com/privacy-scaling-explorations/perpetualpowersoftau"

# ---------------------------------------------------------------------------
# TOOLING — pinned. Change deliberately, never silently.
# ---------------------------------------------------------------------------
SNARKJS_VERSION="0.7.6"

# ---------------------------------------------------------------------------
# BEACON — drand quicknet (unchained, 3s rounds, BLS on G1).
# Chain hash and public key are published by drand and by the League of Entropy.
# ---------------------------------------------------------------------------
DRAND_CHAIN="52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971"
DRAND_API="https://api.drand.sh"
DRAND_GENESIS="1692803367"
DRAND_PERIOD="3"
# snarkjs computes 2^N iterations of SHA-256 over the beacon hash. 10 is the
# minimum snarkjs accepts and is what the reference ceremonies used.
BEACON_ITERATIONS_EXP="10"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
CEREMONY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="${CEREMONY_DIR}/../"           # move/talise-privacy
WORK_DIR="${TALISE_CEREMONY_WORK:-${PWD}/talise-ceremony}"

c_red()   { printf '\033[31m%s\033[0m\n' "$*"; }
c_green() { printf '\033[32m%s\033[0m\n' "$*"; }
c_bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
die()     { c_red "ERROR: $*" >&2; exit 1; }

need() {
  command -v "$1" >/dev/null 2>&1 || die "'$1' is required but not installed. $2"
}

check_prereqs() {
  need node    "Install Node.js 18+ from https://nodejs.org"
  need npm     "Ships with Node.js"
  need curl    "Install curl"
  need openssl "Install OpenSSL (or coreutils for b2sum)"
}

# BLAKE2b-512 of a file, hex, lowercase, no filename. Prefers coreutils' b2sum,
# falls back to OpenSSL. Both are checked to agree with the published digest, so
# either is fine.
blake2b512() {
  local f="$1"
  if command -v b2sum >/dev/null 2>&1; then
    b2sum "$f" | awk '{print $1}'
  else
    openssl dgst -blake2b512 "$f" | awk '{print $NF}'
  fi
}

sha256_file() {
  local f="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$f" | awk '{print $1}'
  else
    shasum -a 256 "$f" | awk '{print $1}'
  fi
}

# Run the pinned snarkjs via npx. npx downloads it from the public registry into
# your own cache — nothing here is supplied by Talise.
sj() {
  npx --yes "snarkjs@${SNARKJS_VERSION}" "$@"
}

# Fetch + verify the Phase-1 transcript into $WORK_DIR. Idempotent: if the file
# is already there and its digest matches, nothing is downloaded.
fetch_and_verify_phase1() {
  mkdir -p "$WORK_DIR"
  local dest="${WORK_DIR}/${PHASE1_FILE}"

  if [[ -f "$dest" ]]; then
    c_bold "Phase-1 transcript already present: $dest"
  else
    c_bold "Downloading Phase-1 transcript (36 MB) from the published URL..."
    echo "  $PHASE1_URL"
    curl -fSL --retry 3 -o "${dest}.part" "$PHASE1_URL"
    mv "${dest}.part" "$dest"
  fi

  local size digest
  size="$(wc -c < "$dest" | tr -d ' ')"
  [[ "$size" == "$PHASE1_BYTES" ]] \
    || die "Phase-1 size mismatch: got ${size} bytes, expected ${PHASE1_BYTES}."

  c_bold "Computing BLAKE2b-512 (this reads 36 MB, a few seconds)..."
  digest="$(blake2b512 "$dest")"
  if [[ "$digest" != "$PHASE1_BLAKE2B" ]]; then
    c_red "Phase-1 digest MISMATCH."
    echo "  computed : $digest"
    echo "  expected : $PHASE1_BLAKE2B"
    echo "  (expected value is published in the snarkjs README — check it yourself:"
    echo "   https://github.com/iden3/snarkjs/blob/master/README.md )"
    die "Refusing to continue with an unverified Phase-1 transcript."
  fi

  c_green "Phase-1 transcript VERIFIED"
  echo "  file      : $PHASE1_FILE"
  echo "  size      : $size bytes"
  echo "  blake2b512: $digest"
  echo "  sha256    : $(sha256_file "$dest")   (expected ${PHASE1_SHA256_UNATTESTED}, unattested)"
  echo "  supports  : up to ${PHASE1_MAX_CONSTRAINTS} constraints (circom circuit needs 16561; snarkjs domain >= 2x)"
  echo
  echo "  Attestations for each of the 55 contributions:"
  echo "  $PHASE1_ATTESTATIONS"
  PHASE1_PATH="$dest"
}

# Compute the drand round that will be produced at (or just after) a given unix
# timestamp. Publishing the round number BEFORE that time is what makes the
# beacon unpredictable.
drand_round_at() {
  local when="$1"
  echo $(( (when - DRAND_GENESIS) / DRAND_PERIOD + 1 ))
}

drand_time_of_round() {
  local round="$1"
  echo $(( DRAND_GENESIS + (round - 1) * DRAND_PERIOD ))
}

# Fetch the randomness of a specific drand round. Fails loudly if the round has
# not happened yet — which is the point.
drand_randomness() {
  local round="$1"
  local body
  body="$(curl -fsSL "${DRAND_API}/${DRAND_CHAIN}/public/${round}")" \
    || die "drand round ${round} is not available yet (or the API is down)."
  node -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
      const j=JSON.parse(s);
      if (!/^[0-9a-f]{64}$/.test(j.randomness)) { console.error("bad randomness"); process.exit(1); }
      process.stdout.write(j.randomness);
    });' <<<"$body"
}
