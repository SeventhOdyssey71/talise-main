#!/usr/bin/env bash
# lint-no-jsonrpc.sh
# Fails if any NEW file (outside the allowlist) imports SuiJsonRpcClient
# or @mysten/sui/jsonRpc. Phase 5 will shrink the allowlist to zero.
#
# Usage (from repo root or web/):
#   bash web/scripts/lint-no-jsonrpc.sh
#   bash scripts/lint-no-jsonrpc.sh

set -uo pipefail

# Resolve repo root (script lives at <repo>/web/scripts/).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
WEB_DIR="${REPO_ROOT}/web"

PATTERN='SuiJsonRpcClient\|@mysten/sui/jsonRpc'

# Allowlist of EXISTING JSON-RPC sites (paths relative to repo root).
# DO NOT ADD new entries. Phase 5 will whittle this list to zero.
#
# Sub-plan 1.10 dropped: deepbook-margin.ts, navi-supply.ts,
# suins-lookup.ts, suins-operator.ts, zkclient.ts (and the vault/state
# event walks moved to GraphQL).
#
# Remaining call sites cluster into the still-pending sub-plans:
#   • web/lib/sui.ts                 → exports `suiJsonRpc()`. Phase 5 deletes it.
#   • web/lib/payment-kit.ts         → comment-only reference; deleted with Phase 5.
#   • web/lib/coins.ts               → coin-metadata read path (separate sub-plan).
#   • web/lib/t2000.ts               → T2000 SDK init helper.
#   • web/lib/yield.ts               → DeFi-yield read path.
#   • web/components/FixSubnameBanner.tsx → Phase 2 client refactor.
#   • web/scripts/*                  → operator scripts, migrated en masse in Phase 5.
ALLOWLIST=(
  "web/components/FixSubnameBanner.tsx"
  "web/lib/coins.ts"
  "web/lib/payment-kit.ts"
  "web/lib/sui.ts"
  "web/lib/t2000.ts"
  "web/lib/yield.ts"
  "web/scripts/bootstrap-payment-registry.mjs"
  "web/scripts/debug-navi-earned.mjs"
  "web/scripts/recover-stranded.mjs"
  "web/scripts/sweep-accumulator.mjs"
  "web/scripts/sweep-now.mjs"
  "web/scripts/test-resolve.mts"
  "web/scripts/test-suins.mts"
  "web/scripts/zk-speed-test.mjs"
)

is_allowlisted() {
  local f="$1"
  for a in "${ALLOWLIST[@]}"; do
    if [[ "$f" == "$a" ]]; then
      return 0
    fi
  done
  return 1
}

# Find all matching files under web/, excluding build/dep dirs.
# Use grep -rl with --exclude-dir for portability (macOS BSD grep + GNU grep).
HITS_RAW="$(cd "${REPO_ROOT}" && grep -rl \
    --exclude-dir=node_modules \
    --exclude-dir=.next \
    --exclude-dir=dist \
    --exclude-dir=.turbo \
    --exclude-dir=out \
    -E 'SuiJsonRpcClient|@mysten/sui/jsonRpc' \
    web 2>/dev/null | sed 's|//*|/|g' | sort -u)"

VIOLATIONS=""
VCOUNT=0
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  # Skip the lint script itself (it intentionally contains the pattern strings).
  if [[ "$f" == "web/scripts/lint-no-jsonrpc.sh" ]]; then
    continue
  fi
  if ! is_allowlisted "$f"; then
    VIOLATIONS="${VIOLATIONS}${f}"$'\n'
    VCOUNT=$((VCOUNT + 1))
  fi
done <<< "$HITS_RAW"

if (( VCOUNT > 0 )); then
  echo "lint-no-jsonrpc: FAIL"
  echo ""
  echo "The following files import a banned JSON-RPC symbol but are NOT"
  echo "on the allowlist. Refactor to GraphQL / the supported client, or"
  echo "if this is a deliberate temporary exception, add the file path to"
  echo "the ALLOWLIST in web/scripts/lint-no-jsonrpc.sh and justify in PR."
  echo ""
  printf '%s' "$VIOLATIONS" | while IFS= read -r v; do
    [[ -z "$v" ]] && continue
    echo "  - ${v}"
  done
  echo ""
  echo "Banned patterns: SuiJsonRpcClient, @mysten/sui/jsonRpc"
  exit 1
fi

echo "lint-no-jsonrpc: OK (no new JSON-RPC imports; allowlist size: ${#ALLOWLIST[@]})"
exit 0
