#!/usr/bin/env bash
# prod-smoke.sh
#
# Phase 4.9 — production smoke walker for Talise.
#
# Walks the post-JSON-RPC-migration hot paths against PRODUCTION
# (default https://app.talise.io) and exits non-zero if anything
# regressed. Run by hand before any Phase 5 deploy; sub-plan 4.10 wires
# this into CI.
#
# Required env:
#   TALISE_SMOKE_BEARER   A valid MOBILE bearer token for a real test
#                         user. Bearer = the Authorization header value
#                         that the iOS app sends. Easiest source:
#                           1) sign in on a test device,
#                           2) tap a screen that triggers an authed call
#                              (Home or Earn appear),
#                           3) Charles/Proxyman -> copy the value of the
#                              `Authorization: Bearer <...>` header.
#                         Alternatively pull it from the mobile_sessions
#                         table for the test user (see web/lib/db.ts).
#
# Optional env:
#   TALISE_PROD_URL              Base URL (default https://app.talise.io)
#   TALISE_SMOKE_TO_GASLESS      Test recipient for the gasless probe
#                                (default 0x...all-zeros + suffix; MUST
#                                not equal the bearer user's address).
#   TALISE_SMOKE_TO_SPONSORED    Test recipient for the sponsored probe.
#   TALISE_SMOKE_AMOUNT          USDsui amount for both send probes
#                                (default 0.01). Sponsor-prepare does NOT
#                                broadcast — it only builds & returns
#                                bytes, so this is never spent.
#
# Flags:
#   --ci-friendly   Omit ANSI color codes (for CI log scraping).
#
# Exit codes:
#   0   all smokes passed
#   1   one or more smokes failed (see SUMMARY at end)
#   2   misconfiguration (missing bearer, missing jq, etc.)
#
# This script never writes to disk and never broadcasts a transaction.
# Every "prepare" endpoint we hit returns BCS bytes; we just verify the
# build path is healthy.

set -euo pipefail

# ───────────────────────────── config ─────────────────────────────

# Flag parsing first so `--help` and unknown-flag rejection don't depend
# on the bearer being set.
CI_FRIENDLY=0
for arg in "$@"; do
  case "$arg" in
    --ci-friendly) CI_FRIENDLY=1 ;;
    -h|--help)
      sed -n '2,40p' "$0"
      exit 0
      ;;
    *)
      echo "ERROR: unknown flag '$arg'" >&2
      exit 2
      ;;
  esac
done

BASE="${TALISE_PROD_URL:-https://app.talise.io}"

if [[ -z "${TALISE_SMOKE_BEARER:-}" ]]; then
  echo "ERROR: TALISE_SMOKE_BEARER is required (a valid mobile bearer token)." >&2
  echo "       See the header of this script for how to obtain one." >&2
  exit 2
fi
BEARER="$TALISE_SMOKE_BEARER"

# Two distinct burner addresses so the gasless and sponsored probes
# can't both fail on a single typo. Both end in unique nibbles so they
# clearly aren't the bearer's own address (sponsor-prepare hard-rejects
# a self-send).
DEFAULT_TO_GASLESS="0x0000000000000000000000000000000000000000000000000000000000000a11"
DEFAULT_TO_SPONSORED="0x0000000000000000000000000000000000000000000000000000000000000b22"

TO_GASLESS="${TALISE_SMOKE_TO_GASLESS:-$DEFAULT_TO_GASLESS}"
TO_SPONSORED="${TALISE_SMOKE_TO_SPONSORED:-$DEFAULT_TO_SPONSORED}"
AMOUNT="${TALISE_SMOKE_AMOUNT:-0.01}"

if [[ "$CI_FRIENDLY" -eq 1 || ! -t 1 ]]; then
  C_RED=""; C_GRN=""; C_YEL=""; C_DIM=""; C_RST=""
else
  C_RED=$'\033[31m'
  C_GRN=$'\033[32m'
  C_YEL=$'\033[33m'
  C_DIM=$'\033[2m'
  C_RST=$'\033[0m'
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is required (brew install jq)." >&2
  exit 2
fi

# ───────────────────────────── helpers ────────────────────────────

# Results table — parallel arrays so we can print a summary at the end.
declare -a R_NAME=()
declare -a R_MS=()
declare -a R_STATUS=()
declare -a R_OK=()
declare -a R_NOTE=()

FAIL_COUNT=0

# Millisecond timestamp helper. We can't use `date +%s%3N` because the
# `%3N` (sub-second) format is GNU-only — on macOS the BSD `date` leaves
# the literal `N` in place, breaking arithmetic. python3 is available on
# every dev and CI box this script targets.
now_ms() { python3 -c 'import time;print(int(time.time()*1000))'; }

TOTAL_START_MS=$(now_ms)

# req METHOD PATH [BODY_JSON]
#   Performs an authed request. Sets globals RESP_STATUS, RESP_BODY,
#   RESP_MS. Does NOT exit on non-2xx — caller decides.
req() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local url="${BASE}${path}"
  local t0 t1
  t0=$(now_ms)

  # `-w "\n%{http_code}"` appends the status on its own line after the body.
  # `--max-time 30` so a stuck endpoint can't wedge the whole smoke run.
  local raw
  if [[ "$method" == "GET" ]]; then
    raw=$(curl -sS --max-time 30 \
      -H "Authorization: Bearer ${BEARER}" \
      -H "User-Agent: talise-prod-smoke/1.0" \
      -w $'\n%{http_code}' \
      "$url" || echo $'\n000')
  else
    raw=$(curl -sS --max-time 30 -X "$method" \
      -H "Authorization: Bearer ${BEARER}" \
      -H "Content-Type: application/json" \
      -H "User-Agent: talise-prod-smoke/1.0" \
      -d "${body:-}" \
      -w $'\n%{http_code}' \
      "$url" || echo $'\n000')
  fi
  t1=$(now_ms)

  RESP_STATUS="${raw##*$'\n'}"
  RESP_BODY="${raw%$'\n'*}"
  RESP_MS=$((t1 - t0))
}

# Decide if the response looks like JSON (jq -e .) — used so an HTML
# error page doesn't crash the helper.
is_json() {
  echo "$1" | jq -e . >/dev/null 2>&1
}

# is_base64 STR — true if STR is a non-empty plausibly-base64 string.
# We don't actually decode (BCS bytes have no header) — just sanity
# check that the field exists, has length, and matches the alphabet.
is_base64() {
  local s="$1"
  [[ -n "$s" && "$s" =~ ^[A-Za-z0-9+/=_-]+$ && ${#s} -ge 8 ]]
}

# record_result NAME MS STATUS OK NOTE
record_result() {
  R_NAME+=("$1")
  R_MS+=("$2")
  R_STATUS+=("$3")
  R_OK+=("$4")
  R_NOTE+=("$5")
  if [[ "$4" != "1" ]]; then
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

# print_step IDX TOTAL NAME MS STATUS OK [NOTE]
print_step() {
  local idx="$1" total="$2" name="$3" ms="$4" status="$5" ok="$6" note="${7:-}"
  local marker
  if [[ "$ok" == "1" ]]; then
    marker="${C_GRN}PASS${C_RST}"
  elif [[ "$ok" == "skip" ]]; then
    marker="${C_YEL}SKIP${C_RST}"
  else
    marker="${C_RED}FAIL${C_RST}"
  fi
  # Pad name to a fixed width so the table aligns. printf %-30s.
  printf "[%d/%d] %-28s ms=%-5s status=%-3s %s" \
    "$idx" "$total" "$name" "$ms" "$status" "$marker"
  if [[ -n "$note" ]]; then
    printf " %s%s%s" "$C_DIM" "$note" "$C_RST"
  fi
  printf "\n"
}

TOTAL_STEPS=7
STEP_IDX=0

# ───────────────────────────── checks ─────────────────────────────

# 1. prepare-gasless — POST /api/send/sponsor-prepare
#    Expect `mode === "gasless"` AND `bytes` looks base64-y.
#    We tag the test bearer user as having round-up OFF for this probe
#    in prod (so the gasless branch is reachable). If round-up is on
#    for the bearer, this will silently come back as `mode === sponsored`
#    — we flag that as a soft warning instead of a hard fail, since the
#    endpoint itself is healthy.
STEP_IDX=$((STEP_IDX + 1))
GASLESS_BODY=$(jq -n \
  --arg to "$TO_GASLESS" \
  --argjson amount "$AMOUNT" \
  '{ to: $to, amount: $amount, asset: "USDsui" }')
req POST "/api/send/sponsor-prepare" "$GASLESS_BODY"
ok=0; note=""
if [[ "$RESP_STATUS" == "200" ]] && is_json "$RESP_BODY"; then
  mode=$(echo "$RESP_BODY" | jq -r '.mode // ""')
  bytes=$(echo "$RESP_BODY" | jq -r '.bytes // ""')
  if [[ "$mode" == "gasless" ]] && is_base64 "$bytes"; then
    ok=1
  elif [[ "$mode" == "sponsored" ]] && is_base64 "$bytes"; then
    # Round-up is on for this bearer — endpoint is healthy, just took
    # the other branch. Pass it but flag in the note.
    ok=1
    note="(round-up on; took sponsored branch)"
  else
    note="bad shape: mode=$mode bytes_len=${#bytes}"
  fi
else
  note=$(echo "$RESP_BODY" | head -c 120)
fi
print_step "$STEP_IDX" "$TOTAL_STEPS" "prepare-gasless" "$RESP_MS" "$RESP_STATUS" "$ok" "$note"
record_result "prepare-gasless" "$RESP_MS" "$RESP_STATUS" "$ok" "$note"

# 2. prepare-sponsored — same endpoint, different probe.
#    Goal here is to assert the sponsored branch builds at all. Round-up
#    state on the bearer user determines whether `roundupUsd > 0` — if
#    it's off, we expect mode=gasless again (and SKIP the round-up
#    assertion). Either way, response must be 200 with valid bytes.
STEP_IDX=$((STEP_IDX + 1))
SPONS_BODY=$(jq -n \
  --arg to "$TO_SPONSORED" \
  --argjson amount "$AMOUNT" \
  '{ to: $to, amount: $amount, asset: "USDsui" }')
req POST "/api/send/sponsor-prepare" "$SPONS_BODY"
ok=0; note=""
if [[ "$RESP_STATUS" == "200" ]] && is_json "$RESP_BODY"; then
  mode=$(echo "$RESP_BODY" | jq -r '.mode // ""')
  bytes=$(echo "$RESP_BODY" | jq -r '.bytes // ""')
  roundup=$(echo "$RESP_BODY" | jq -r '.roundupUsd // 0')
  if ! is_base64 "$bytes"; then
    note="bytes missing/invalid"
  elif [[ "$mode" == "sponsored" ]]; then
    # Round-up branch exercised in full.
    # Best-effort: assert roundupUsd > 0 when sponsored mode was hit,
    # since the only reason USDsui sends go sponsored is round-up.
    # If roundup=0 the endpoint is still healthy (could be a future
    # non-USDsui sponsored leg), just note it.
    awk_gt=$(awk -v r="$roundup" 'BEGIN{print (r+0>0)?"1":"0"}')
    if [[ "$awk_gt" == "1" ]]; then
      ok=1
      note="(roundupUsd=$roundup)"
    else
      ok=1
      note="(sponsored but roundup=0 — bearer round-up may be off)"
    fi
  elif [[ "$mode" == "gasless" ]]; then
    # Bearer has round-up off → endpoint correctly fell through to the
    # gasless path. Treat as SKIP rather than FAIL for this probe.
    ok="skip"
    note="(bearer round-up off; sponsored branch not exercised)"
  else
    note="bad mode: $mode"
  fi
else
  note=$(echo "$RESP_BODY" | head -c 120)
fi
print_step "$STEP_IDX" "$TOTAL_STEPS" "prepare-sponsored" "$RESP_MS" "$RESP_STATUS" "$ok" "$note"
record_result "prepare-sponsored" "$RESP_MS" "$RESP_STATUS" "$ok" "$note"

# 3. vault-state — GET /api/vault/state
#    Expect 200 + shape `{ vault: <obj|null>, caps: <array> }`.
STEP_IDX=$((STEP_IDX + 1))
req GET "/api/vault/state"
ok=0; note=""
if [[ "$RESP_STATUS" == "200" ]] && is_json "$RESP_BODY"; then
  caps_is_array=$(echo "$RESP_BODY" | jq -r '(.caps | type) == "array"')
  has_vault_key=$(echo "$RESP_BODY" | jq -r 'has("vault")')
  if [[ "$caps_is_array" == "true" && "$has_vault_key" == "true" ]]; then
    ok=1
    caps_len=$(echo "$RESP_BODY" | jq -r '.caps | length')
    vault_present=$(echo "$RESP_BODY" | jq -r '(.vault != null)')
    note="(vault=$vault_present caps=$caps_len)"
  else
    note="missing vault/caps keys"
  fi
else
  note=$(echo "$RESP_BODY" | head -c 120)
fi
print_step "$STEP_IDX" "$TOTAL_STEPS" "vault-state" "$RESP_MS" "$RESP_STATUS" "$ok" "$note"
record_result "vault-state" "$RESP_MS" "$RESP_STATUS" "$ok" "$note"

# 4. activity — GET /api/activity?limit=5
#    Expect 200 + `entries` array. Empty array is FINE — fresh users
#    have no on-chain history.
STEP_IDX=$((STEP_IDX + 1))
req GET "/api/activity?limit=5"
ok=0; note=""
if [[ "$RESP_STATUS" == "200" ]] && is_json "$RESP_BODY"; then
  entries_is_array=$(echo "$RESP_BODY" | jq -r '(.entries | type) == "array"')
  if [[ "$entries_is_array" == "true" ]]; then
    ok=1
    n=$(echo "$RESP_BODY" | jq -r '.entries | length')
    note="(entries=$n)"
  else
    note="entries not an array"
  fi
else
  note=$(echo "$RESP_BODY" | head -c 120)
fi
print_step "$STEP_IDX" "$TOTAL_STEPS" "activity" "$RESP_MS" "$RESP_STATUS" "$ok" "$note"
record_result "activity" "$RESP_MS" "$RESP_STATUS" "$ok" "$note"

# 5. supply-prepare — POST /api/earn/supply/prepare
#    Expect 200 + non-empty `transactionKindB64`.
STEP_IDX=$((STEP_IDX + 1))
SUPPLY_BODY=$(jq -n --argjson amount "$AMOUNT" '{ venue: "navi", amount: $amount }')
req POST "/api/earn/supply/prepare" "$SUPPLY_BODY"
ok=0; note=""
if [[ "$RESP_STATUS" == "200" ]] && is_json "$RESP_BODY"; then
  kind=$(echo "$RESP_BODY" | jq -r '.transactionKindB64 // ""')
  if is_base64 "$kind"; then
    ok=1
    note="(venue=navi bytes=${#kind})"
  else
    note="transactionKindB64 missing/invalid"
  fi
else
  note=$(echo "$RESP_BODY" | head -c 120)
fi
print_step "$STEP_IDX" "$TOTAL_STEPS" "supply-prepare" "$RESP_MS" "$RESP_STATUS" "$ok" "$note"
record_result "supply-prepare" "$RESP_MS" "$RESP_STATUS" "$ok" "$note"

# 6. withdraw-prepare — POST /api/earn/withdraw/prepare
#    Body omits `amount` to exercise "withdraw all". Expect 200 +
#    non-empty `transactionKindB64`. 404 "no DeepBook position" is a
#    valid skip for users without a position — we ask for NAVI which
#    is the default and tolerates an empty position by zeroing out.
STEP_IDX=$((STEP_IDX + 1))
WITHDRAW_BODY='{ "venue": "navi" }'
req POST "/api/earn/withdraw/prepare" "$WITHDRAW_BODY"
ok=0; note=""
if [[ "$RESP_STATUS" == "200" ]] && is_json "$RESP_BODY"; then
  kind=$(echo "$RESP_BODY" | jq -r '.transactionKindB64 // ""')
  if is_base64 "$kind"; then
    ok=1
    withdrawAll=$(echo "$RESP_BODY" | jq -r '.withdrawAll // false')
    note="(venue=navi withdrawAll=$withdrawAll)"
  else
    note="transactionKindB64 missing/invalid"
  fi
elif [[ "$RESP_STATUS" == "404" ]] && is_json "$RESP_BODY"; then
  # No position to withdraw — endpoint healthy, smoke user just doesn't
  # have funds supplied. Don't fail the whole run.
  ok="skip"
  err=$(echo "$RESP_BODY" | jq -r '.error // "no position"')
  note="($err)"
else
  note=$(echo "$RESP_BODY" | head -c 120)
fi
print_step "$STEP_IDX" "$TOTAL_STEPS" "withdraw-prepare" "$RESP_MS" "$RESP_STATUS" "$ok" "$note"
record_result "withdraw-prepare" "$RESP_MS" "$RESP_STATUS" "$ok" "$note"

# 7. sui-epoch — GET /api/sui/epoch
#    Expect 200 + `{ epoch: "<digits>" }`. iOS hits this every cold
#    launch to pick a maxEpoch for the ephemeral key pair — if it's
#    broken, no one can sign in. Highest-blast-radius endpoint of the
#    bunch, kept last so the SUMMARY line still shows the count.
STEP_IDX=$((STEP_IDX + 1))
req GET "/api/sui/epoch"
ok=0; note=""
if [[ "$RESP_STATUS" == "200" ]] && is_json "$RESP_BODY"; then
  epoch=$(echo "$RESP_BODY" | jq -r '.epoch // ""')
  if [[ "$epoch" =~ ^[0-9]+$ ]]; then
    ok=1
    note="(epoch=$epoch)"
  else
    note="epoch not digits: '$epoch'"
  fi
else
  note=$(echo "$RESP_BODY" | head -c 120)
fi
print_step "$STEP_IDX" "$TOTAL_STEPS" "sui-epoch" "$RESP_MS" "$RESP_STATUS" "$ok" "$note"
record_result "sui-epoch" "$RESP_MS" "$RESP_STATUS" "$ok" "$note"

# ───────────────────────────── summary ────────────────────────────

TOTAL_END_MS=$(now_ms)
TOTAL_S=$(awk -v ms="$((TOTAL_END_MS - TOTAL_START_MS))" 'BEGIN{printf "%.1f", ms/1000}')

echo
echo "─── SUMMARY ───"
# Header
printf "%-2s %-22s %-7s %-7s %-6s %s\n" "#" "test" "ms" "status" "result" "note"
PASS_COUNT=0
SKIP_COUNT=0
for i in "${!R_NAME[@]}"; do
  idx=$((i + 1))
  ok="${R_OK[$i]}"
  if [[ "$ok" == "1" ]]; then
    res="${C_GRN}pass${C_RST}"
    PASS_COUNT=$((PASS_COUNT + 1))
  elif [[ "$ok" == "skip" ]]; then
    res="${C_YEL}skip${C_RST}"
    SKIP_COUNT=$((SKIP_COUNT + 1))
  else
    res="${C_RED}fail${C_RST}"
  fi
  printf "%-2s %-22s %-7s %-7s %-6b %s\n" \
    "$idx" \
    "${R_NAME[$i]}" \
    "${R_MS[$i]}" \
    "${R_STATUS[$i]}" \
    "$res" \
    "${R_NOTE[$i]}"
done

echo
if [[ "$FAIL_COUNT" -eq 0 ]]; then
  echo "${C_GRN}SUMMARY: ${PASS_COUNT}/${TOTAL_STEPS} passed${C_RST} (${SKIP_COUNT} skipped) in ${TOTAL_S}s"
  exit 0
else
  echo "${C_RED}SUMMARY: ${FAIL_COUNT}/${TOTAL_STEPS} FAILED${C_RST} (${PASS_COUNT} passed, ${SKIP_COUNT} skipped) in ${TOTAL_S}s"
  exit 1
fi
