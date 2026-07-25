#!/usr/bin/env bash
# Publish the `talise_payroll_streams` Move package (permissionless on-chain team
# payroll streams) and print the two env vars you need:
#   TEAM_STREAM_PACKAGE_ID   — the published package id
#   TEAM_STREAM_REGISTRY_ID  — the shared TeamStreamRegistry created by `init`
#
# Usage:
#   scripts/deploy.sh [testnet|mainnet]    # default: testnet
#
# Pre-flight:
#   • `sui` CLI installed and pointing at the right env (`sui client envs`).
#   • The active address holds enough SUI for the publish gas (≈0.2 SUI mainnet).
#
# What it does, in order:
#   1. Sanity-check we're on the requested env (offer to switch if not).
#   2. `sui move build` — fail fast on compile errors.
#   3. `sui move test` — refuse to publish a package with failing tests.
#   4. `sui client publish --gas-budget 200000000 --json` — capture output.
#   5. Parse the package id, the shared TeamStreamRegistry id, and the AdminCap id.
#   6. Print the env lines to paste into Vercel.
#
# NOTE: `init` runs on THIS publish and mints the AdminCap to the publishing
# address. Keep that address safe — the cap is the global circuit-breaker
# (`set_paused`). It can never move a funded pot.

set -euo pipefail

ENV_ARG="${1:-testnet}"
case "$ENV_ARG" in
  testnet|mainnet) : ;;
  *)
    echo "error: env must be 'testnet' or 'mainnet', got '$ENV_ARG'" >&2
    exit 1
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PACKAGE_DIR"

echo "» talise_payroll_streams Move publish → $ENV_ARG"
echo "» package dir: $PACKAGE_DIR"
echo

# ── 1. Verify the active sui-cli env ───────────────────────────────────
ACTIVE_ENV="$(sui client active-env 2>/dev/null || true)"
if [ "$ACTIVE_ENV" != "$ENV_ARG" ]; then
  echo "» active sui env is '$ACTIVE_ENV', expected '$ENV_ARG'."
  echo "  switching: sui client switch --env $ENV_ARG"
  sui client switch --env "$ENV_ARG"
fi
echo "» active address: $(sui client active-address)"
echo

# ── 2 + 3. Build + test (refuse to publish a broken package) ───────────
echo "» sui move build"
sui move build
echo "» sui move test"
sui move test
echo

# ── 4. Publish ─────────────────────────────────────────────────────────
RECEIPT="$(mktemp -t talise_payroll_streams_publish.XXXXXX.json)"
echo "» sui client publish --gas-budget 200000000"
sui client publish --gas-budget 200000000 --json >"$RECEIPT"

# ── 5. Parse the ids out of the receipt ────────────────────────────────
read -r PACKAGE_ID REGISTRY_ID ADMIN_CAP_ID <<EOF
$(
  python3 - "$RECEIPT" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
pkg = registry = cap = ""
for ch in data.get("objectChanges", []):
    if ch.get("type") == "published":
        pkg = ch.get("packageId", "")
        continue
    t = ch.get("objectType", "") or ""
    if t.endswith("::team_stream::TeamStreamRegistry"):
        registry = ch.get("objectId", "")
    elif t.endswith("::team_stream::TeamStreamAdminCap"):
        cap = ch.get("objectId", "")
print(pkg, registry or "-", cap or "-")
PY
)
EOF

if [ -z "$PACKAGE_ID" ] || [ "$REGISTRY_ID" = "-" ]; then
  echo "error: couldn't find the packageId / registry id in the receipt: $RECEIPT" >&2
  exit 1
fi

# ── 6. Print the env vars ──────────────────────────────────────────────
echo
echo "──────────────────────────────────────────────────────────────"
echo "✓ published talise_payroll_streams → $ENV_ARG"
echo
echo "Set BOTH in Vercel (all scopes) to light up on-chain team streams:"
echo
echo "TEAM_STREAM_PACKAGE_ID=$PACKAGE_ID"
echo "TEAM_STREAM_REGISTRY_ID=$REGISTRY_ID"
echo
echo "AdminCap (circuit-breaker, keep with the publisher): $ADMIN_CAP_ID"
echo "(receipt: $RECEIPT)"
echo "──────────────────────────────────────────────────────────────"
