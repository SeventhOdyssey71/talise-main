#!/usr/bin/env node
/**
 * transfer-suins-to-admin.mjs
 *
 * ONE-SHOT operator script. Consolidates every `*.talise.sui` SuiNS
 * SubDomainRegistration NFT owned by `--from <addr>` onto the canonical
 * admin wallet `--admin <addr>` so the admin is the single owner of
 * every Talise-state object (matches the `drain-vault-to-admin.mjs`
 * goal of collapsing the split-wallet layout back to one primary key).
 *
 * Defaults to `--dry-run`. Pass `--execute` to broadcast. The user runs
 * it themselves — this file ships disarmed.
 *
 * Talks to mainnet via raw JSON-RPC + the @mysten/sui Transaction builder
 * (matching the drain script's harness). No new deps.
 *
 * Discovery:
 *   suix_getOwnedObjects(from) → page → filter on type
 *   `…::subdomain_registration::SubDomainRegistration` → grab
 *   `display.output.name`, keep names that end in `.talise.sui`.
 *
 * PTB (per subname, all batched into one tx for speed):
 *   tx.transferObjects([tx.object(nftId)], tx.pure.address(admin))
 *
 * No Onara / no sponsorship — this is a plain owned-object transfer
 * signed by the current owner's key.
 *
 * Usage:
 *   node scripts/transfer-suins-to-admin.mjs \
 *     [--admin 0xb9aad…866c] \
 *     [--from 0x…] \
 *     [--dry-run | --execute] \
 *     [--limit N]
 *
 * Env:
 *   TALISE_VAULT_OWNER_KEY        suiprivkey... of the CURRENT owner
 *                                 (the `--from` address). REQUIRED for
 *                                 `--execute`. Optional for dry-run
 *                                 (dry-run uses `--from` as sender).
 *   SUI_RPC_URL                   Optional. Defaults to mainnet fullnode.
 *   ADMIN_ADDRESS                 Optional fallback for --admin
 *                                 (defaults to
 *                                 0xb9aad5433f0d3b76e35d9985706b3fa9e571262f2fa1f12043589ca681d2866c).
 *   TALISE_SUINS_FROM             Optional fallback for --from.
 *
 * Notes on the subname object type:
 *   SuiNS subnames live in the dedicated
 *   `…::subdomain_registration::SubDomainRegistration` Move type. Multiple
 *   subdomain package versions exist on mainnet; we filter on the suffix
 *   `subdomain_registration::SubDomainRegistration` (any pkg id) so the
 *   script keeps working across upgrades. The display `name` field is
 *   stable across versions and is what we use to scope to `*.talise.sui`.
 *
 *   If a subname is wrapped INSIDE a SuiNS reverse-record container
 *   (e.g. the user set this as their primary), this script won't see it —
 *   that case needs an unwrap call first and is out of scope for the
 *   batch transfer.
 */

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { toBase64 } from "@mysten/sui/utils";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";

// ───────────────────────────────────────────────────────────────────
// CLI parsing

function parseArgs(argv) {
  const out = {
    dryRun: true,
    execute: false,
    admin: null,
    from: null,
    limit: Infinity,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--execute") {
      out.execute = true;
      out.dryRun = false;
    } else if (a === "--admin") out.admin = argv[++i];
    else if (a === "--from") out.from = argv[++i];
    else if (a === "--limit") out.limit = Number(argv[++i]);
    else if (a === "--help" || a === "-h") {
      console.log(
        [
          "transfer-suins-to-admin.mjs",
          "  --admin <0x..>     Target admin address (or env ADMIN_ADDRESS)",
          "  --from  <0x..>     Current owner address (or env TALISE_SUINS_FROM,",
          "                     or derived from TALISE_VAULT_OWNER_KEY).",
          "  --dry-run          Default. Build PTB, devInspect, print manifest.",
          "  --execute          Sign + broadcast.",
          "  --limit N          Cap to N subnames per invocation.",
        ].join("\n"),
      );
      process.exit(0);
    }
  }
  out.admin =
    out.admin ??
    process.env.ADMIN_ADDRESS ??
    // User-confirmed default admin (per task spec). Keeps `--dry-run`
    // working out-of-the-box without requiring an env var or flag.
    "0xb9aad5433f0d3b76e35d9985706b3fa9e571262f2fa1f12043589ca681d2866c";
  out.from = out.from ?? process.env.TALISE_SUINS_FROM ?? null;
  return out;
}

// ───────────────────────────────────────────────────────────────────
// Config

const args = parseArgs(process.argv);

const RPC_URL = process.env.SUI_RPC_URL || "https://fullnode.mainnet.sui.io:443";

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

// Resolve `--from` — explicit flag wins, then env, then the key's address.
const fromAddress = args.from ?? signerAddress ?? null;
if (!fromAddress || !/^0x[0-9a-fA-F]{1,64}$/.test(fromAddress)) {
  console.error(
    "FATAL: --from <0x..> (or TALISE_SUINS_FROM env, or TALISE_VAULT_OWNER_KEY) is required",
  );
  process.exit(2);
}
if (args.execute && !signer) {
  console.error(
    "FATAL: --execute requires TALISE_VAULT_OWNER_KEY env set to the --from address private key",
  );
  process.exit(2);
}
if (
  args.execute &&
  signerAddress &&
  signerAddress.toLowerCase() !== fromAddress.toLowerCase()
) {
  console.error(
    `FATAL: --execute requires the signer key to match --from. ` +
      `key=${signerAddress.slice(0, 10)}… from=${fromAddress.slice(0, 10)}…`,
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

// SDK transport for Transaction#build. The builder needs a client that
// implements the unified core surface (getReferenceGasPrice, getObject,
// getProtocolConfig…). `SuiJsonRpcClient` ships that out of the box.
const suiClient = new SuiJsonRpcClient({ url: RPC_URL, network: "mainnet" });

// ───────────────────────────────────────────────────────────────────
// Discovery
//
// Enumerate owned objects, filter to SubDomainRegistration NFTs whose
// display name ends in `.talise.sui`. We deliberately match on the type
// SUFFIX (`subdomain_registration::SubDomainRegistration`) so the script
// keeps working across SuiNS package versions — there have been multiple
// subdomain packages over time and the leading 0x prefix changes.

const SUBDOMAIN_TYPE_RE =
  /::subdomain_registration::SubDomainRegistration\b/;
const PARENT_SUFFIX = ".talise.sui";

function readDisplayName(display) {
  // gRPC display object: { output: { name, image_url, … } | null, errors }.
  // sui_getOwnedObjects with showDisplay returns the same `data` shape.
  const out = display?.data ?? display?.output ?? null;
  if (!out) return "";
  const v = out.name ?? out.fields?.name ?? null;
  return typeof v === "string" ? v : "";
}

async function discoverSubnames(owner) {
  console.log(`[discover] enumerating owned subnames at ${owner}`);
  const found = [];
  let cursor = null;
  // Cap to 20 pages × 50 = up to 1000 objects scanned. Way more than
  // any single wallet will hold in practice; if you hit it, raise it.
  for (let page = 0; page < 20; page++) {
    const r = await rpc("suix_getOwnedObjects", [
      owner,
      {
        // We can't filter server-side on a TYPE SUFFIX, so pull
        // unfiltered + reject locally. The subname NFT count per wallet
        // is small; pagination keeps the wire size bounded.
        filter: null,
        options: {
          showType: true,
          showDisplay: true,
          showContent: false,
          showOwner: false,
        },
      },
      cursor,
      50,
    ]);
    for (const row of r?.data ?? []) {
      const d = row?.data;
      const t = d?.type;
      if (!t || !SUBDOMAIN_TYPE_RE.test(t)) continue;
      const name = readDisplayName(d.display);
      if (!name.endsWith(PARENT_SUFFIX)) continue;
      const objectId = d.objectId;
      if (!objectId) continue;
      found.push({
        nftId: objectId,
        fullName: name,
        type: t,
      });
      if (found.length >= args.limit) break;
    }
    if (found.length >= args.limit) break;
    if (!r?.hasNextPage) break;
    cursor = r.nextCursor;
  }
  console.log(`[discover] found ${found.length} *.talise.sui NFT(s)`);
  return found;
}

// ───────────────────────────────────────────────────────────────────
// PTB builder
//
// One PTB per invocation; transferObjects([nft1, nft2, …], admin) batches
// every subname into a single call. transferObjects accepts a vector of
// objects so even N=20 is one MoveCall — atomic, single gas.

function buildTransferTx({ sender, subnames, admin }) {
  const tx = new Transaction();
  tx.setSender(sender);
  // One transferObjects call carrying every NFT — atomic, single gas.
  // Could split per-subname if any one fails; in practice owned-object
  // transfers don't selectively fail.
  tx.transferObjects(
    subnames.map((s) => tx.object(s.nftId)),
    tx.pure.address(admin),
  );
  return tx;
}

// ───────────────────────────────────────────────────────────────────
// Main

async function main() {
  console.log("─────────────────────────────────────────────");
  console.log("transfer-suins-to-admin.mjs");
  console.log(`  mode:    ${args.execute ? "EXECUTE (broadcast)" : "DRY-RUN"}`);
  console.log(`  admin:   ${args.admin}`);
  console.log(`  from:    ${fromAddress}`);
  console.log(`  signer:  ${signerAddress ?? "(none — discovery-only dry-run)"}`);
  console.log(`  rpc:     ${RPC_URL}`);
  console.log(`  limit:   ${args.limit === Infinity ? "∞" : args.limit}`);
  console.log("─────────────────────────────────────────────");

  const subnames = await discoverSubnames(fromAddress);
  if (subnames.length === 0) {
    console.log("[main] no *.talise.sui subnames found at this address. exiting.");
    console.log("─────────────────────────────────────────────");
    if (args.dryRun) {
      console.log("DRY-RUN. No funds moved. Pass --execute to broadcast.");
    }
    console.log("─────────────────────────────────────────────");
    return;
  }

  console.log("\nManifest:");
  for (const s of subnames) {
    console.log(`  ${s.nftId} -> ${s.fullName}`);
  }

  // Sanity: don't transfer to the address that already owns them.
  if (fromAddress.toLowerCase() === args.admin.toLowerCase()) {
    console.log(
      "\n[main] --from already equals --admin; nothing to do. exiting.",
    );
    console.log("─────────────────────────────────────────────");
    return;
  }

  const sender = signerAddress ?? fromAddress;
  const tx = buildTransferTx({
    sender,
    subnames,
    admin: args.admin,
  });

  console.log("\n  ptb:");
  console.log(
    `    [transfer] transferObjects([${subnames
      .map((s) => `${s.nftId.slice(0, 10)}…`)
      .join(", ")}], ${args.admin.slice(0, 10)}…)`,
  );

  // Dry-run via sui_devInspectTransactionBlock — matches the drain
  // script's pattern. devInspect doesn't need a gas coin so it works
  // even if `--from` has zero SUI.
  let bytes;
  let kindBytes;
  try {
    if (args.dryRun) {
      kindBytes = await tx.build({
        client: suiClient,
        onlyTransactionKind: true,
      });
    } else {
      bytes = await tx.build({ client: suiClient });
    }
  } catch (err) {
    console.log(`\n  build-error: ${err.message}`);
    process.exit(1);
  }

  if (args.dryRun) {
    const dr = await rpc("sui_devInspectTransactionBlock", [
      sender,
      toBase64(kindBytes),
      null,
      null,
    ]);
    const status = dr.effects?.status?.status ?? "unknown";
    const gas = dr.effects?.gasUsed;
    const gasNet = gas
      ? BigInt(gas.computationCost ?? 0) +
        BigInt(gas.storageCost ?? 0) -
        BigInt(gas.storageRebate ?? 0)
      : 0n;
    console.log(`\n  dry-run:  status=${status}  net-gas=${gasNet.toString()} MIST`);
    if (status !== "success") {
      console.log(
        `  error:    ${JSON.stringify(dr.effects?.status?.error ?? "")}`,
      );
    } else {
      console.log(
        `  effects:  ${subnames.length} SubDomainRegistration NFT(s) → ${args.admin.slice(0, 10)}…`,
      );
    }
  } else {
    // EXECUTE — sign locally and POST sui_executeTransactionBlock.
    const { signature } = await signer.signTransaction(bytes);
    const result = await rpc("sui_executeTransactionBlock", [
      toBase64(bytes),
      [signature],
      { showEffects: true },
      "WaitForLocalExecution",
    ]);
    const status = result.effects?.status?.status ?? "unknown";
    console.log(`\n  exec:     digest=${result.digest}  status=${status}`);
    if (status !== "success") {
      console.log(
        `  error:    ${JSON.stringify(result.effects?.status?.error ?? "")}`,
      );
    }
  }

  console.log("\n─────────────────────────────────────────────");
  console.log(
    `Summary: ${subnames.length} subname(s) ${args.execute ? "transferred" : "dry-run"} → ${args.admin}`,
  );
  if (args.dryRun) {
    console.log("DRY-RUN. No NFTs moved. Pass --execute to broadcast.");
  }
  console.log("─────────────────────────────────────────────");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
