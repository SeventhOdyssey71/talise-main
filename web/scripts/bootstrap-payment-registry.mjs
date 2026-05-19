#!/usr/bin/env node
/**
 * One-shot Payment Kit registry bootstrap.
 *
 * Mints the global `talise` PaymentRegistry on Sui mainnet so every
 * subsequent transaction can attach a PaymentReceipt under a defined
 * registry id. Without this, `processRegistryPayment` aborts with
 * "Object 0xdad87e82… does not exist" — which is what `suivision.xyz`
 * sees as transaction kind = "none".
 *
 * The registry id is deterministic from (namespaceId, registryName), so
 * we already know what it WILL be. This script just makes sure the
 * shared object exists on chain and the AdminCap lands in the operator
 * wallet (so we can later configure expiration / withdraw funds).
 *
 * IDEMPOTENT: re-running after success is a no-op — we check
 * `getPaymentRecord` against the deterministic id, and if the registry
 * object exists we exit 0.
 *
 * Run from web/ with:
 *
 *   node --env-file=.env.local scripts/bootstrap-payment-registry.mjs
 *
 * Required env:
 *   TALISE_SUINS_OPERATOR_KEY  (or TALISE_PK_OPERATOR_KEY)
 *   NEXT_PUBLIC_SUI_NETWORK    (defaults to mainnet)
 */

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";
import { PaymentKitClient } from "@mysten/payment-kit";

const REGISTRY_NAME = "talise";
const NET = (process.env.NEXT_PUBLIC_SUI_NETWORK ?? "mainnet").toLowerCase();

const key = process.env.TALISE_PK_OPERATOR_KEY ?? process.env.TALISE_SUINS_OPERATOR_KEY;
if (!key) {
  console.error("Missing operator key (TALISE_PK_OPERATOR_KEY or TALISE_SUINS_OPERATOR_KEY)");
  process.exit(1);
}

const operator = Ed25519Keypair.fromSecretKey(key);
const operatorAddr = operator.getPublicKey().toSuiAddress();
const client = new SuiJsonRpcClient({
  url: getJsonRpcFullnodeUrl(NET === "testnet" ? "testnet" : "mainnet"),
  network: NET === "testnet" ? "testnet" : "mainnet",
});
const pk = new PaymentKitClient({ client });

const registryId = pk.getRegistryIdFromName(REGISTRY_NAME);
console.log(`network        : ${NET}`);
console.log(`operator       : ${operatorAddr}`);
console.log(`registry name  : ${REGISTRY_NAME}`);
console.log(`registry id    : ${registryId} (deterministic)`);

// Idempotency check — if the registry object already exists, nothing to do.
try {
  const existing = await client.getObject({ id: registryId, options: { showType: true } });
  if (existing?.data?.objectId) {
    console.log("registry already exists on chain. nothing to do.");
    console.log("type:", existing.data.type);
    process.exit(0);
  }
} catch {
  /* expected — registry doesn't exist yet, fall through to mint */
}

console.log("minting registry…");

const tx = new Transaction();
// create_registry returns RegistryAdminCap which MUST be transferred or
// kept alive (UnusedValueWithoutDrop otherwise). We send it to the
// operator wallet so we can later call setConfig / withdrawFromRegistry.
const adminCap = tx.add(pk.calls.createRegistry({ registryName: REGISTRY_NAME }));
tx.transferObjects([adminCap], operatorAddr);
tx.setSender(operatorAddr);

const bytes = await tx.build({ client });
const { signature } = await operator.signTransaction(bytes);

const result = await client.executeTransactionBlock({
  transactionBlock: bytes,
  signature,
  options: { showEffects: true, showObjectChanges: true },
});

const status = result.effects?.status?.status;
if (status !== "success") {
  console.error("mint failed:", result.effects?.status?.error ?? "unknown");
  process.exit(2);
}

let mintedRegistryId = null;
let adminCapId = null;
for (const ch of result.objectChanges ?? []) {
  const t = ch?.objectType ?? "";
  if (ch?.type === "created" && /::payment_kit::PaymentRegistry/.test(t)) {
    mintedRegistryId = ch.objectId;
  }
  if (ch?.type === "created" && /::payment_kit::RegistryAdminCap/.test(t)) {
    adminCapId = ch.objectId;
  }
}

console.log("\nMINTED");
console.log("digest          :", result.digest);
console.log("registry object :", mintedRegistryId);
console.log("admin cap       :", adminCapId);
console.log("\nAdd to your .env.local:");
console.log(`TALISE_PAYMENT_REGISTRY_ID=${mintedRegistryId ?? registryId}`);
if (adminCapId) console.log(`TALISE_PAYMENT_ADMIN_CAP_ID=${adminCapId}`);
