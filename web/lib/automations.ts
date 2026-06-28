import "server-only";

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import { toBase64, fromBase64 } from "@mysten/sui/utils";
import { sui } from "@/lib/sui";
import { onara } from "@/lib/onara";
import { USDSUI_TYPE } from "@/lib/usdsui";
import { getNormalizedTransaction } from "@/lib/sui-shapes";

/**
 * On-chain automations — PTB builders for the `talise_automations::standing_order`
 * package (the audited, NON-CUSTODIAL "rule"). A rule's pot lives in a user-owned
 * `StandingOrder<USDSUI>` shared object; the registered worker can ONLY release the
 * pre-set `amount_per` to the pre-set `recipient` on schedule. The owner funds it
 * (sponsored, user-signed), tops up/cancels (user-signed), and the cron worker
 * triggers due releases (worker-signed, Onara-sponsored).
 *
 * Gated by AUTOMATIONS_PACKAGE_ID + AUTOMATIONS_REGISTRY_ID + AUTOMATIONS_WORKER_SK
 * (all three required). Unset → automations are off; the routes 503 and the cron no-ops.
 */

const SUI_CLOCK_ID = "0x6";
const GAS_BUDGET = 60_000_000n; // 0.06 SUI — same fixed budget streams/goal use.

export function automationsPackageId(): string | null {
  return process.env.AUTOMATIONS_PACKAGE_ID?.trim() || null;
}
export function automationsRegistryId(): string | null {
  return process.env.AUTOMATIONS_REGISTRY_ID?.trim() || null;
}
export function automationsEnabled(): boolean {
  return !!(automationsPackageId() && automationsRegistryId() && process.env.AUTOMATIONS_WORKER_SK);
}

let _worker: Ed25519Keypair | null = null;
function workerKeypair(): Ed25519Keypair {
  if (_worker) return _worker;
  const k = process.env.AUTOMATIONS_WORKER_SK;
  if (!k) throw new Error("AUTOMATIONS_WORKER_SK missing — the automations scheduler worker key");
  _worker = Ed25519Keypair.fromSecretKey(k);
  return _worker;
}
export function automationsWorkerAddress(): string {
  return workerKeypair().getPublicKey().toSuiAddress();
}

function requirePkgReg(): { pkg: string; reg: string } {
  const pkg = automationsPackageId();
  const reg = automationsRegistryId();
  if (!pkg || !reg) throw new Error("automations not configured");
  return { pkg, reg };
}

/** Source a `Balance<USDSUI>` of `micros` from coins OR the accumulator (the
 *  create call wants a Balance). Mirrors buildStreamCreateSponsored. */
async function fundsBalance(tx: Transaction, sender: string, micros: bigint) {
  let coinTotal = 0n;
  try {
    const res = await (sui() as unknown as {
      listCoins: (a: { owner: string; coinType: string }) => Promise<{ objects?: Array<{ balance?: string }> }>;
    }).listCoins({ owner: sender, coinType: USDSUI_TYPE });
    for (const o of res.objects ?? []) coinTotal += BigInt(o.balance ?? "0");
  } catch { /* fall through to accumulator */ }
  if (coinTotal >= micros) {
    return tx.moveCall({
      target: "0x2::coin::into_balance",
      typeArguments: [USDSUI_TYPE],
      arguments: [tx.add(coinWithBalance({ type: USDSUI_TYPE, balance: micros, useGasCoin: false }))],
    });
  }
  return tx.balance({ type: USDSUI_TYPE, balance: micros });
}

async function sponsorTail(tx: Transaction): Promise<{ bytes: string; sponsor: string }> {
  const [{ address: sponsor }, gasPrice] = await Promise.all([
    onara().status(),
    sui().getReferenceGasPrice().then((r) => r.referenceGasPrice),
  ]);
  tx.setGasOwner(sponsor);
  tx.setGasPrice(BigInt(gasPrice));
  tx.setGasBudget(GAS_BUDGET);
  const bytes = await tx.build({ client: sui() as never });
  return { bytes: toBase64(bytes), sponsor };
}

/**
 * Onara-SPONSORED `standing_order::create` — the user signs (becomes `owner`),
 * funding the pot with `prefundMicros` (>= amountPerMicros). Returns sponsor-ready
 * bytes the client signs → /api/zk/sponsor-execute.
 */
export async function buildCreateOrderSponsored(input: {
  sender: string;
  recipient: string;
  amountPerMicros: bigint;
  intervalMs: number;
  firstDueMs: number;
  prefundMicros: bigint;
}): Promise<{ bytes: string; sponsor: string }> {
  const { pkg, reg } = requirePkgReg();
  const tx = new Transaction();
  tx.setSender(input.sender);
  const funds = await fundsBalance(tx, input.sender, input.prefundMicros);
  tx.moveCall({
    target: `${pkg}::standing_order::create`,
    typeArguments: [USDSUI_TYPE],
    arguments: [
      tx.object(reg),
      funds,
      tx.pure.address(input.recipient),
      tx.pure.u64(input.amountPerMicros),
      tx.pure.u64(BigInt(input.intervalMs)),
      tx.pure.u64(BigInt(input.firstDueMs)),
    ],
  });
  return sponsorTail(tx);
}

/** Onara-SPONSORED `standing_order::top_up` (owner-signed). */
export async function buildTopUpSponsored(input: {
  sender: string;
  orderId: string;
  micros: bigint;
}): Promise<{ bytes: string; sponsor: string }> {
  const { pkg } = requirePkgReg();
  const tx = new Transaction();
  tx.setSender(input.sender);
  const funds = await fundsBalance(tx, input.sender, input.micros);
  tx.moveCall({
    target: `${pkg}::standing_order::top_up`,
    typeArguments: [USDSUI_TYPE],
    arguments: [tx.object(input.orderId), funds],
  });
  return sponsorTail(tx);
}

/**
 * Onara-SPONSORED `standing_order::cancel` (owner-signed) — stops the rule and
 * refunds the entire remaining pot to the owner (the Move call returns a Coin we
 * transfer back to the sender in the same PTB).
 */
export async function buildCancelOrderSponsored(input: {
  sender: string;
  orderId: string;
}): Promise<{ bytes: string; sponsor: string }> {
  const { pkg } = requirePkgReg();
  const tx = new Transaction();
  tx.setSender(input.sender);
  const [refund] = tx.moveCall({
    target: `${pkg}::standing_order::cancel`,
    typeArguments: [USDSUI_TYPE],
    arguments: [tx.object(input.orderId)],
  });
  tx.transferObjects([refund], input.sender);
  return sponsorTail(tx);
}

/**
 * Worker-signed, Onara-SPONSORED `standing_order::execute_due` — the cron's
 * release. The worker key signs the sender slot (it's the registered worker the
 * contract checks); Onara owns the gas. Returns the digest, or throws on a failed
 * tx (e.g. ENotDue / EInsufficientPot) so the cron can record the reason.
 */
export async function workerExecuteDue(orderId: string): Promise<string> {
  const { pkg, reg } = requirePkgReg();
  const client = sui();

  const tx = new Transaction();
  tx.moveCall({
    target: `${pkg}::standing_order::execute_due`,
    typeArguments: [USDSUI_TYPE],
    arguments: [tx.object(reg), tx.object(orderId), tx.object(SUI_CLOCK_ID)],
  });
  // Onara sets the gas owner + co-signs gas; the worker key signs the sender slot
  // (the contract checks ctx.sender() ∈ registry.workers). One round-trip.
  const res = (await onara().sponsorTransaction({
    transaction: tx,
    signer: workerKeypair(),
    client: client as never,
  })) as Record<string, unknown>;
  const txInner = res.Transaction as { digest?: string } | undefined;
  const fxInner = res.effects as { transactionDigest?: string } | undefined;
  const digest =
    (res.digest as string | undefined) ??
    txInner?.digest ??
    fxInner?.transactionDigest;
  if (!digest) throw new Error(`execute_due produced no digest for ${orderId}`);
  return digest;
}

/** Parse the created StandingOrder object id from a confirmed create tx digest. */
export async function parseCreatedOrderId(digest: string): Promise<string | null> {
  const pkg = automationsPackageId();
  if (!pkg) return null;
  const prefix = `${pkg}::standing_order::StandingOrder`.toLowerCase();
  const DELAYS = [0, 800, 1200, 2000, 3000];
  for (let i = 0; i < DELAYS.length; i++) {
    if (DELAYS[i] > 0) await new Promise((r) => setTimeout(r, DELAYS[i]));
    let tx;
    try { tx = await getNormalizedTransaction(digest); } catch { continue; }
    if (tx.status !== "success") return null;
    for (const oc of tx.objectChanges) {
      if (oc.kind !== "created") continue;
      if ((oc.objectType ?? "").toLowerCase().startsWith(prefix)) return oc.objectId;
    }
    return null;
  }
  return null;
}

// Re-export for callers that build raw worker txs elsewhere.
export { fromBase64 };
