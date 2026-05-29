#!/usr/bin/env node
// Fix SuiNS subname target addresses — point every *.talise.sui owned by
// --from at the canonical admin wallet. The NFT owner can update the
// target via SuinsTransaction.setTargetAddress({nft, address, isSubname:true}).
//
// Background: after the .talise.sui NFTs were consolidated to the admin
// wallet, the SuiNS NAME RECORD's target field still pointed at the
// original zkLogin-derived address for some names — so sending to
// `name@talise.sui` would route to the OLD address instead of the new
// admin. This script reads each subname's current target, and updates
// any that don't already point at --admin.
//
// Defaults to --dry-run. Will not broadcast until --execute is passed.
//
// Usage:
//   node scripts/fix-suins-targets.mjs --dry-run --admin 0xb9aad…866c
//   TALISE_VAULT_OWNER_KEY=suiprivkey... \
//     node scripts/fix-suins-targets.mjs --execute --admin 0xb9aad…866c
import { Transaction } from "@mysten/sui/transactions";
import { SuinsClient, SuinsTransaction } from "@mysten/suins";
import { SuiClient } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";

const ADMIN_DEFAULT = "0xb9aad5433f0d3b76e35d9985706b3fa9e571262f2fa1f12043589ca681d2866c";
const args = parse(process.argv.slice(2));

function parse(a) {
  const out = { dryRun: true, admin: ADMIN_DEFAULT, from: null, limit: Infinity };
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    if (k === "--dry-run") out.dryRun = true;
    else if (k === "--execute") out.dryRun = false;
    else if (k === "--admin") out.admin = a[++i];
    else if (k === "--from") out.from = a[++i];
    else if (k === "--limit") out.limit = Number(a[++i]);
  }
  return out;
}

const RPC = "https://fullnode.mainnet.sui.io:443";
const client = new SuiClient({ url: RPC });
const suins = new SuinsClient({ client, network: "mainnet" });

let signer = null;
let signerAddress = null;
if (!args.dryRun) {
  const key = process.env.TALISE_VAULT_OWNER_KEY;
  if (!key) {
    console.error("FATAL: TALISE_VAULT_OWNER_KEY env required for --execute");
    process.exit(1);
  }
  const { secretKey } = decodeSuiPrivateKey(key);
  signer = Ed25519Keypair.fromSecretKey(secretKey);
  signerAddress = signer.toSuiAddress();
}

const from = args.from ?? signerAddress ?? args.admin;
console.log(`─────────────────────────────────────────────`);
console.log(`fix-suins-targets.mjs`);
console.log(`  mode:   ${args.dryRun ? "DRY-RUN" : "EXECUTE (broadcast)"}`);
console.log(`  admin:  ${args.admin}`);
console.log(`  from:   ${from}`);
console.log(`  rpc:    ${RPC}`);
console.log(`─────────────────────────────────────────────`);

// Enumerate every SubDomainRegistration NFT at `from`.
const owned = [];
let cursor = null;
for (let page = 0; page < 20; page++) {
  const r = await client.getOwnedObjects({
    owner: from,
    options: { showType: true, showContent: true, showDisplay: true },
    cursor,
    limit: 50,
  });
  for (const o of r.data ?? []) {
    const t = o.data?.type ?? "";
    if (!t.endsWith("::subdomain_registration::SubDomainRegistration")) continue;
    const name = o.data?.display?.data?.name ?? null;
    if (!name || !name.endsWith(".talise.sui")) continue;
    owned.push({ nftId: o.data.objectId, name });
  }
  if (!r.hasNextPage) break;
  cursor = r.nextCursor;
}
console.log(`[discover] found ${owned.length} *.talise.sui subname NFT(s)`);

// Read each name's CURRENT target via getNameRecord. Only update if
// the target != admin.
const todo = [];
for (const s of owned.slice(0, args.limit)) {
  try {
    const rec = await suins.getNameRecord(s.name);
    const cur = rec?.targetAddress ?? null;
    const match = cur && cur.toLowerCase() === args.admin.toLowerCase();
    console.log(`  ${s.name}  current=${cur ?? "(null)"}  ${match ? "✓ already on admin" : "→ NEEDS UPDATE"}`);
    if (!match) todo.push(s);
  } catch (e) {
    console.log(`  ${s.name}  ERR reading target: ${e.message.slice(0, 100)}`);
  }
}
console.log(`[plan] ${todo.length} name(s) need their target updated to admin`);
if (todo.length === 0) {
  console.log(`Nothing to do. Exiting.`);
  process.exit(0);
}

// Build a single PTB with one setTargetAddress call per name.
const tx = new Transaction();
const stx = new SuinsTransaction(suins, tx);
for (const s of todo) {
  stx.setTargetAddress({
    nft: tx.object(s.nftId),
    address: args.admin,
    isSubname: true,
  });
  console.log(`  [ptb] setTargetAddress(${s.name}, ${args.admin.slice(0, 10)}…) — nft ${s.nftId.slice(0, 10)}…`);
}

if (args.dryRun) {
  tx.setSender(from);
  const bytes = await tx.build({ client, onlyTransactionKind: true });
  const r = await client.devInspectTransactionBlock({
    sender: from,
    transactionBlock: bytes,
  });
  console.log(`[dry-run] devInspect status=${JSON.stringify(r.effects?.status)} gasUsed=${JSON.stringify(r.effects?.gasUsed)}`);
  console.log(`DRY-RUN. No changes made. Pass --execute to broadcast.`);
} else {
  tx.setSender(signerAddress);
  const bytes = await tx.build({ client });
  const sig = await signer.signTransaction(bytes);
  const r = await client.executeTransactionBlock({
    transactionBlock: bytes,
    signature: sig.signature,
    options: { showEffects: true },
  });
  console.log(`[execute] digest=${r.digest} status=${JSON.stringify(r.effects?.status)}`);
}
