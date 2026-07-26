#!/usr/bin/env bash
# THE LANDMINE HARNESS. Run this to reproduce the central pre-flight result:
# a Groth16 verifying key crosses the arkworks <-> snarkjs boundary losslessly,
# so the output of a snarkjs-based ceremony is usable by Sui's on-chain verifier.
#
#   ./verify_roundtrip.sh
#
# Four independent checks, each of which would catch a serialization mismatch
# (field-element endianness, G1 point compression, the Fq2 (c0,c1) limb order in
# G2, or the IC/gamma_abc vector):
#
#   1. cargo test — the shipped 520-byte VK survives
#      arkworks -> snarkjs JSON -> arkworks byte-exactly, and a corrupted JSON is
#      rejected rather than silently coerced.
#   2. the harness binary — exports verification_key.json + a real arkworks proof
#      in snarkjs format, and confirms the shipped proving key is a matched pair
#      with the on-chain VK.
#   3. REAL snarkjs verifies that arkworks proof against that exported JSON,
#      and rejects three deliberate corruptions.
#   4. sui move test — Sui's native BN254 verifier accepts the bytes that came
#      back out of the snarkjs representation, and also accepts a verifying key
#      produced by an actual end-to-end ceremony.

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

need cargo "Install Rust from https://rustup.rs"
need node  "Install Node.js 18+"
need npm   "Ships with Node.js"

CIRCUIT="${CEREMONY_DIR}/../circuit"
PKG="${CEREMONY_DIR}/.."
OUT="${TALISE_ROUNDTRIP_OUT:-$(mktemp -d)}"

c_bold "=== [1/4] Rust: byte-exact VK round trip ==="
( cd "$CIRCUIT" && cargo test --release --test snarkjs_vk_roundtrip )

echo
c_bold "=== [2/4] Export snarkjs artefacts from a real arkworks proof ==="
( cd "$CIRCUIT" && cargo run --release --quiet --bin ceremony_roundtrip -- --out "$OUT" )

echo
c_bold "=== [3/4] REAL snarkjs verifies the arkworks proof ==="
echo "positive control:"
sj groth16 verify "${OUT}/verification_key.json" "${OUT}/public.json" "${OUT}/proof.json" \
  || die "snarkjs REJECTED a valid arkworks proof against the exported VK — the
  format mapping is wrong. This is the failure mode the whole harness exists to
  detect."
c_green "  snarkjs accepted it."

echo
echo "negative controls (all three MUST be rejected):"
node -e '
const fs = require("fs");
const dir = process.argv[1];
const rd = (f) => JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8"));
const vk = rd("verification_key.json");
const swapped = JSON.parse(JSON.stringify(vk));
swapped.vk_beta_2[0] = [vk.vk_beta_2[0][1], vk.vk_beta_2[0][0]];
swapped.vk_beta_2[1] = [vk.vk_beta_2[1][1], vk.vk_beta_2[1][0]];
fs.writeFileSync(`${dir}/vk_swapped_fq2.json`, JSON.stringify(swapped, null, 1));
const pub = rd("public.json"); pub[2] = "9999";
fs.writeFileSync(`${dir}/public_tampered.json`, JSON.stringify(pub, null, 1));
const pr = rd("proof.json"); pr.pi_a = [vk.vk_alpha_1[0], vk.vk_alpha_1[1], "1"];
fs.writeFileSync(`${dir}/proof_tampered.json`, JSON.stringify(pr, null, 1));
' "$OUT"

expect_reject() {
  local label="$1"; shift
  if sj groth16 verify "$@" >/dev/null 2>&1; then
    die "$label was ACCEPTED — the verifier or the mapping is broken."
  fi
  c_green "  rejected: $label"
}
expect_reject "swapped Fq2 limbs in vk_beta_2" \
  "${OUT}/vk_swapped_fq2.json" "${OUT}/public.json" "${OUT}/proof.json"
expect_reject "tampered public signal (public_value 1000 -> 9999)" \
  "${OUT}/verification_key.json" "${OUT}/public_tampered.json" "${OUT}/proof.json"
expect_reject "tampered proof point pi_a" \
  "${OUT}/verification_key.json" "${OUT}/public.json" "${OUT}/proof_tampered.json"

echo
c_bold "=== [4/4] Sui: the round-tripped bytes verify on-chain ==="
if command -v sui >/dev/null 2>&1; then
  ( cd "$PKG" && sui move test ceremony_roundtrip )
else
  c_red "  'sui' CLI not found — skipping. Install it and run:"
  echo "    cd $PKG && sui move test ceremony_roundtrip"
fi

echo
c_green "=== ROUND TRIP VERIFIED IN ALL AVAILABLE DIRECTIONS ==="
echo "artefacts: $OUT"
