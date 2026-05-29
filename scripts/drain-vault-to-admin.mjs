#!/usr/bin/env node
/**
 * drain-vault-to-admin.mjs
 *
 * ONE-SHOT operator script. Enumerates every `talise::vault::TaliseVault`
 * the configured signer can sign for, and (in `--execute` mode) drains
 * every coin balance held inside the vault's `Bag` to a single admin
 * address via `vault::withdraw_and_send<T>(&mut vault, amount, recipient)`.
 *
 * Goal: collapse the multi-wallet / split-funds layout back to a single
 * primary wallet — the admin address. The Talise vault module enforces
 * `ctx.sender() == vault.owner` on `withdraw_and_send`, so the script
 * MUST sign with the key that matches each vault's `owner` field. There
 * is no operator override.
 *
 * Defaults to `--dry-run` (builds PTBs, runs `sui_dryRunTransactionBlock`,
 * prints the estimated coin transfers). Pass `--execute` to broadcast.
 *
 * Talks to mainnet via raw JSON-RPC rather than `@mysten/sui/client` —
 * the current SDK builds split `SuiClient` out of the `client` entry, and
 * a one-shot ESM script doesn't need the typed-client surface. Mirrors
 * the existing `suix_getAllBalances` raw-fetch pattern used in
 * `web/app/api/cron/auto-swap-sweep/route.ts`.
 *
 * Usage:
 *   node scripts/drain-vault-to-admin.mjs \
 *     --admin 0xb9aad5433f0d3b76e35d9985706b3fa9e571262f2fa1f12043589ca681d2866c \
 *     [--dry-run | --execute] \
 *     [--limit N] \
 *     [--vaults <id1,id2,...>]
 *
 * Env:
 *   TALISE_VAULT_OWNER_KEY        suiprivkey... of the vault owner. Must
 *                                 derive to `vault.owner`. REQUIRED for
 *                                 `--execute`. Optional for dry-run
 *                                 (dry-run can spoof the sender to the
 *                                 vault.owner address pulled off-chain).
 *   TALISE_AUTOSWAP_PACKAGE_ID    Required.
 *   TALISE_AUTOSWAP_PACKAGE_LATEST   Optional; falls back to PACKAGE_ID.
 *   SUI_RPC_URL                   Optional. Defaults to mainnet fullnode.
 *   ADMIN_ADDRESS                 Optional fallback for --admin.
 */

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { toBase64, fromBase64 } from "@mysten/sui/utils";

// ───────────────────────────────────────────────────────────────────
// CLI parsing

function parseArgs(argv) {
  const out = {
    dryRun: true,
    execute: false,
    admin: null,
    limit: Infinity,
    vaults: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--execute") {
      out.execute = true;
      out.dryRun = false;
    } else if (a === "--admin") out.admin = argv[++i];
    else if (a === "--limit") out.limit = Number(argv[++i]);
    else if (a === "--vaults")
      out.vaults = argv[++i].split(",").map((s) => s.trim());
    else if (a === "--help" || a === "-h") {
      console.log(
        [
          "drain-vault-to-admin.mjs",
          "  --admin <0x..>     Target admin address (or env ADMIN_ADDRESS)",
          "  --dry-run          Default. Build + dryRun every PTB, no broadcast.",
          "  --execute          Sign + broadcast every PTB.",
          "  --limit N          Cap to N vaults per invocation.",
          "  --vaults a,b,c     Override discovery and drain these vault ids.",
        ].join("\n"),
      );
      process.exit(0);
    }
  }
  out.admin = out.admin ?? process.env.ADMIN_ADDRESS ?? null;
  return out;
}

// ───────────────────────────────────────────────────────────────────
// Config

const args = parseArgs(process.argv);

const PACKAGE_ID = process.env.TALISE_AUTOSWAP_PACKAGE_ID;
const PACKAGE_LATEST = process.env.TALISE_AUTOSWAP_PACKAGE_LATEST || PACKAGE_ID;
const RPC_URL = process.env.SUI_RPC_URL || "https://fullnode.mainnet.sui.io:443";

if (!PACKAGE_ID) {
  console.error("FATAL: TALISE_AUTOSWAP_PACKAGE_ID env is required");
  process.exit(2);
}
if (!args.admin || !/^0x[0-9a-fA-F]{1,64}$/.test(args.admin)) {
  console.error(
    "FATAL: --admin <0x..> (or ADMIN_ADDRESS env) is required and must be a hex Sui address",
  );
  process.exit(2);
}

// Owner key handling. Required for --execute, optional for dry-run.
let signer = null;
let signerAddress = null;
const keyEnv = process.env.TALISE_VAULT_OWNER_KEY;
if (keyEnv) {
  try {
    signer = Ed25519Keypair.fromSecretKey(keyEnv);
    signerAddress = signer.getPublicKey().toSuiAddress();
  } catch (err) {
    console.error(`FATAL: TALISE_VAULT_OWNER_KEY invalid: ${err.message}`);
    process.exit(2);
  }
}
if (args.execute && !signer) {
  console.error(
    "FATAL: --execute requires TALISE_VAULT_OWNER_KEY env set to the vault.owner private key",
  );
  process.exit(2);
}

// ───────────────────────────────────────────────────────────────────
// JSON-RPC helper

async function rpc(method, params) {
  const r = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!r.ok) throw new Error(`${method} HTTP ${r.status}`);
  const body = await r.json();
  if (body.error) {
    throw new Error(`${method}: ${body.error.message ?? JSON.stringify(body.error)}`);
  }
  return body.result;
}

// Minimal client shim for `tx.build({ client })`. The SDK builder uses
// the client to fetch reference gas price, gas budget, and (for owned
// objects) version/digest. We feed it pinned shared-object info inline
// where we can and lean on JSON-RPC for everything else.
const clientShim = {
  // tx.build() calls this when an object has no version pinned.
  async getNormalizedMoveModulesByPackage() {
    return {};
  },
  async getReferenceGasPrice() {
    const v = await rpc("suix_getReferenceGasPrice", []);
    return BigInt(v);
  },
  async getObject({ id, options }) {
    return rpc("sui_getObject", [
      id,
      options ?? { showOwner: true, showType: true, showContent: true },
    ]);
  },
  async multiGetObjects({ ids, options }) {
    return rpc("sui_multiGetObjects", [
      ids,
      options ?? { showOwner: true, showType: true },
    ]);
  },
};

// ───────────────────────────────────────────────────────────────────
// Vault discovery

async function discoverVaults() {
  if (args.vaults && args.vaults.length > 0) {
    console.log(`[discover] using explicit --vaults list (${args.vaults.length})`);
    return args.vaults.slice(0, args.limit).map((v) => ({ vaultId: v, owner: null }));
  }

  console.log(
    `[discover] querying ${PACKAGE_ID}::vault::VaultCreated events`,
  );
  const ids = [];
  let cursor = null;
  do {
    const page = await rpc("suix_queryEvents", [
      { MoveEventType: `${PACKAGE_ID}::vault::VaultCreated` },
      cursor,
      50,
      true,
    ]);
    for (const e of page.data ?? []) {
      const pj = e.parsedJson ?? {};
      const vaultId = pj.vault_id;
      const owner = pj.owner;
      if (!vaultId) continue;
      if (signerAddress && owner?.toLowerCase() !== signerAddress.toLowerCase()) {
        continue;
      }
      ids.push({ vaultId, owner });
      if (ids.length >= args.limit) break;
    }
    if (ids.length >= args.limit) break;
    cursor = page.hasNextPage ? page.nextCursor : null;
  } while (cursor);

  console.log(`[discover] discovered ${ids.length} vault(s)`);
  return ids;
}

// ───────────────────────────────────────────────────────────────────
// Bag balance read

async function readVaultBagBalances(vaultId) {
  const obj = await rpc("sui_getObject", [
    vaultId,
    { showContent: true, showType: true, showOwner: true },
  ]);
  const content = obj.data?.content;
  if (!content || content.dataType !== "moveObject") {
    return { balances: [], owner: null };
  }
  const fields = content.fields ?? {};
  const owner = fields.owner ?? null;
  const bag = fields.balances;
  const bagId = bag?.fields?.id?.id ?? null;
  if (!bagId) return { balances: [], owner };

  const balances = [];
  let cursor = null;
  do {
    const page = await rpc("suix_getDynamicFields", [bagId, cursor, 50]);
    const fieldObjs = (page.data ?? []).map((d) => d.objectId);
    if (fieldObjs.length === 0) {
      cursor = page.hasNextPage ? page.nextCursor : null;
      continue;
    }
    const wrappers = await rpc("sui_multiGetObjects", [
      fieldObjs,
      { showContent: true, showType: true },
    ]);
    for (const w of wrappers) {
      const c = w.data?.content;
      if (!c || c.dataType !== "moveObject") continue;
      const typeStr = c.type ?? "";
      const m = /Balance<([^>]+)>/.exec(typeStr);
      const coinType = m?.[1] ?? null;
      const rawVal = c.fields?.value;
      let amount = 0n;
      try {
        amount =
          typeof rawVal === "string"
            ? BigInt(rawVal)
            : typeof rawVal?.fields?.value === "string"
              ? BigInt(rawVal.fields.value)
              : 0n;
      } catch {
        amount = 0n;
      }
      if (coinType && amount > 0n) balances.push({ coinType, amount });
    }
    cursor = page.hasNextPage ? page.nextCursor : null;
  } while (cursor);

  return { balances, owner };
}

// ───────────────────────────────────────────────────────────────────
// PTB builder

function buildDrainTx({ sender, vaultId, balances, admin }) {
  const tx = new Transaction();
  tx.setSender(sender);
  for (const b of balances) {
    tx.moveCall({
      target: `${PACKAGE_LATEST}::vault::withdraw_and_send`,
      typeArguments: [b.coinType],
      arguments: [
        tx.object(vaultId),
        tx.pure.u64(b.amount),
        tx.pure.address(admin),
      ],
    });
  }
  return tx;
}

// ───────────────────────────────────────────────────────────────────
// Main

async function main() {
  console.log("─────────────────────────────────────────────");
  console.log("drain-vault-to-admin.mjs");
  console.log(`  mode:    ${args.execute ? "EXECUTE (broadcast)" : "DRY-RUN"}`);
  console.log(`  admin:   ${args.admin}`);
  console.log(`  signer:  ${signerAddress ?? "(none — discovery-only dry-run)"}`);
  console.log(`  package: ${PACKAGE_ID}`);
  console.log(`  rpc:     ${RPC_URL}`);
  console.log(`  limit:   ${args.limit === Infinity ? "∞" : args.limit}`);
  console.log("─────────────────────────────────────────────");

  const targets = await discoverVaults();
  if (targets.length === 0) {
    console.log("[main] no vaults to drain. exiting.");
    return;
  }

  let totalTxs = 0;
  let totalDrained = 0n;
  for (const t of targets) {
    console.log(`\n[vault ${t.vaultId.slice(0, 12)}…]`);
    const { balances, owner } = await readVaultBagBalances(t.vaultId);
    const ownerStr = owner ?? t.owner ?? "(unknown)";
    console.log(`  owner:    ${ownerStr}`);
    if (balances.length === 0) {
      console.log(`  balances: (empty bag — nothing to drain)`);
      continue;
    }
    for (const b of balances) {
      console.log(`  balance:  ${b.amount.toString().padStart(20)} ${b.coinType}`);
    }

    const sender = signerAddress ?? owner ?? t.owner;
    if (!sender) {
      console.log(`  skip: no sender available`);
      continue;
    }
    if (
      signerAddress &&
      owner &&
      signerAddress.toLowerCase() !== owner.toLowerCase()
    ) {
      console.log(
        `  skip: signer ${signerAddress.slice(0, 10)}… does not own this vault (owner ${owner.slice(0, 10)}…)`,
      );
      continue;
    }

    const tx = buildDrainTx({
      sender,
      vaultId: t.vaultId,
      balances,
      admin: args.admin,
    });

    let bytes;
    try {
      bytes = await tx.build({ client: clientShim });
    } catch (err) {
      console.log(`  build-error: ${err.message}`);
      continue;
    }

    if (args.dryRun) {
      const dr = await rpc("sui_dryRunTransactionBlock", [toBase64(bytes)]);
      const status = dr.effects?.status?.status ?? "unknown";
      const gas = dr.effects?.gasUsed;
      const gasNet = gas
        ? BigInt(gas.computationCost ?? 0) +
          BigInt(gas.storageCost ?? 0) -
          BigInt(gas.storageRebate ?? 0)
        : 0n;
      console.log(`  dry-run:  status=${status}  net-gas=${gasNet.toString()} MIST`);
      if (status !== "success") {
        console.log(
          `  error:    ${JSON.stringify(dr.effects?.status?.error ?? "")}`,
        );
      } else {
        totalDrained += balances.reduce((s, b) => s + b.amount, 0n);
        totalTxs += 1;
        console.log(
          `  effects:  ${balances.length} withdraw_and_send call(s) → ${args.admin.slice(0, 10)}…`,
        );
      }
    } else {
      // EXECUTE — sign the bytes locally and POST sui_executeTransactionBlock.
      const { signature } = await signer.signTransaction(bytes);
      const result = await rpc("sui_executeTransactionBlock", [
        toBase64(bytes),
        [signature],
        { showEffects: true },
        "WaitForLocalExecution",
      ]);
      const status = result.effects?.status?.status ?? "unknown";
      console.log(`  exec:     digest=${result.digest}  status=${status}`);
      if (status !== "success") {
        console.log(
          `  error:    ${JSON.stringify(result.effects?.status?.error ?? "")}`,
        );
      } else {
        totalDrained += balances.reduce((s, b) => s + b.amount, 0n);
        totalTxs += 1;
      }
    }
  }

  console.log("\n─────────────────────────────────────────────");
  console.log(
    `Summary: ${totalTxs} tx(s) ${args.execute ? "broadcast" : "dry-run"}; ` +
      `total raw units moved = ${totalDrained.toString()}`,
  );
  if (args.dryRun) {
    console.log("DRY-RUN. No funds moved. Pass --execute to broadcast.");
  }
  console.log("─────────────────────────────────────────────");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
