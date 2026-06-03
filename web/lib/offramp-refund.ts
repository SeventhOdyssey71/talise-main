import "server-only";

import { randomBytes } from "node:crypto";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { fromBase64 } from "@mysten/sui/utils";
import { db, ensureSchema, userById } from "@/lib/db";
import { sui, USDSUI_DECIMALS } from "@/lib/sui";
import { USDSUI_TYPE } from "@/lib/usdsui";
import { getChainIdentifier, getCurrentEpoch } from "@/lib/sui-epoch";

/**
 * Off-ramp refund path (F2 / P0).
 *
 * When Paga rejects (or fails) AFTER the user's USDsui debit has landed in the
 * treasury, the USDsui must be returned to the user — never stranded. This
 * sends `usdsui_amount` back from the treasury to `user.sui_address` using the
 * SAME proven gasless `0x2::balance::send_funds<USDSUI>` recipe the cheque
 * escrow release uses (the treasury's USDsui sits in its Address Balance
 * accumulator because users fund via the gasless rail), then records the refund
 * idempotently on the `paga_offramps` row.
 *
 * Custody: the treasury is controlled by `OFFRAMP_TREASURY_SK` (an Ed25519
 * secret key whose address MUST equal `TALISE_OFFRAMP_TREASURY`). When the key
 * is absent the refund is left pending (`refund_state='refund_failed'`) so the
 * retry cron completes it once provisioned — it NEVER throws into the caller.
 *
 * Idempotency: a single atomic UPDATE claims the row (status='failed' AND
 * refund_digest IS NULL) before sending, so concurrent callers / retries can
 * never double-refund.
 */

let _treasury: Ed25519Keypair | null = null;

export function offrampRefundEnabled(): boolean {
  return !!process.env.OFFRAMP_TREASURY_SK;
}

function treasuryKeypair(): Ed25519Keypair {
  if (_treasury) return _treasury;
  const k = process.env.OFFRAMP_TREASURY_SK;
  if (!k) throw new Error("OFFRAMP_TREASURY_SK missing — the off-ramp treasury key");
  _treasury = Ed25519Keypair.fromSecretKey(k);
  return _treasury;
}

function usdToMicros(usd: number): bigint {
  return BigInt(Math.round(usd * 10 ** USDSUI_DECIMALS));
}

/**
 * Pay USDsui out of the treasury to `toAddress`, signed by the treasury key.
 * Mirrors lib/cheques.ts `escrowTransfer` (gasless send_funds accumulator
 * recipe — gasPrice/budget 0, ValidDuring, empty gas payment). Returns the
 * on-chain digest.
 */
async function treasuryTransfer(toAddress: string, micros: bigint): Promise<string> {
  const kp = treasuryKeypair();
  const sender = kp.getPublicKey().toSuiAddress();
  const expected = (process.env.TALISE_OFFRAMP_TREASURY ?? "").toLowerCase();
  if (expected && sender.toLowerCase() !== expected) {
    throw new Error(
      `OFFRAMP_TREASURY_SK address ${sender} != TALISE_OFFRAMP_TREASURY ${expected}`
    );
  }
  const tx = new Transaction();
  tx.setSender(sender);
  tx.moveCall({
    target: "0x2::balance::send_funds",
    typeArguments: [USDSUI_TYPE],
    arguments: [tx.balance({ type: USDSUI_TYPE, balance: micros }), tx.pure.address(toAddress)],
  });
  tx.setGasPrice(0n);
  tx.setGasBudget(0n);
  const [chainId, currentEpoch] = await Promise.all([getChainIdentifier(), getCurrentEpoch()]);
  const epoch = BigInt(currentEpoch);
  tx.setExpiration({
    ValidDuring: {
      minEpoch: String(epoch),
      maxEpoch: String(epoch + 1n),
      minTimestamp: null,
      maxTimestamp: null,
      chain: chainId,
      nonce: randomBytes(4).readUInt32BE(0),
    },
  });
  tx.setGasPayment([]);
  const client = sui();
  const bytes = await tx.build({ client: client as never });
  const { signature } = await kp.signTransaction(bytes);
  const result = (await client.executeTransaction({
    transaction: fromBase64(Buffer.from(bytes).toString("base64")),
    signatures: [signature],
  })) as Record<string, unknown>;
  const inner =
    (result.Transaction as { digest?: string } | undefined) ??
    (result.FailedTransaction as { digest?: string } | undefined);
  const digest = (result.digest as string | undefined) ?? inner?.digest;
  if (!digest) throw new Error("treasury refund produced no digest");
  if ((result.$kind as string | undefined) === "FailedTransaction") {
    throw new Error("treasury refund failed on chain");
  }
  return digest;
}

export type RefundResult = { refunded: boolean; digest?: string; reason?: string };

/**
 * Refund a failed off-ramp's USDsui from the treasury back to the user.
 * Idempotent + safe to call from confirm/webhook/status/cron. `transfer` is
 * injectable for tests; production uses the gasless treasury send.
 */
export async function refundOfframp(
  quoteId: string,
  transfer: (to: string, micros: bigint) => Promise<string> = treasuryTransfer
): Promise<RefundResult> {
  await ensureSchema();
  const c = db();

  const r = await c.execute({
    sql: `SELECT id, user_id, usdsui_amount, status, refund_digest
            FROM paga_offramps WHERE id = ? LIMIT 1`,
    args: [quoteId],
  });
  const row = r.rows[0] as unknown as
    | { id: string; user_id: string; usdsui_amount: string | number; status: string; refund_digest: string | null }
    | undefined;
  if (!row) return { refunded: false, reason: "not found" };
  if (row.status !== "failed") return { refunded: false, reason: `status ${row.status}` };
  if (row.refund_digest) return { refunded: false, reason: "already refunded" };

  // Atomic claim — only one caller can flip a failed, un-refunded row into
  // 'refunding'. Losers (rowsAffected 0) bail without sending.
  const claim = await c.execute({
    sql: `UPDATE paga_offramps SET refund_state='refunding'
          WHERE id = ? AND status='failed' AND refund_digest IS NULL
            AND (refund_state IS NULL OR refund_state='refund_failed')`,
    args: [quoteId],
  });
  if (claim.rowsAffected === 0) {
    return { refunded: false, reason: "not eligible or already in progress" };
  }

  if (!offrampRefundEnabled()) {
    await c.execute({
      sql: `UPDATE paga_offramps SET refund_state='refund_failed' WHERE id = ?`,
      args: [quoteId],
    });
    return { refunded: false, reason: "treasury key not configured (left pending for retry)" };
  }

  const user = await userById(Number(row.user_id)).catch(() => null);
  if (!user?.sui_address) {
    await c.execute({
      sql: `UPDATE paga_offramps SET refund_state='refund_failed' WHERE id = ?`,
      args: [quoteId],
    });
    return { refunded: false, reason: "user address unavailable" };
  }

  try {
    const micros = usdToMicros(Number(row.usdsui_amount));
    const digest = await transfer(user.sui_address, micros);
    await c.execute({
      sql: `UPDATE paga_offramps SET refund_state='refunded', refund_digest=?, refunded_at=? WHERE id = ?`,
      args: [digest, Date.now(), quoteId],
    });
    return { refunded: true, digest };
  } catch (e) {
    await c.execute({
      sql: `UPDATE paga_offramps SET refund_state='refund_failed' WHERE id = ?`,
      args: [quoteId],
    });
    return { refunded: false, reason: (e as Error).message };
  }
}

/**
 * Retry pending refunds (failed payouts not yet returned). Driven by a cron so
 * a transient chain/key gap self-heals. Best-effort + bounded.
 */
export async function retryPendingOfframpRefunds(limit = 25): Promise<{ attempted: number; refunded: number }> {
  await ensureSchema();
  const r = await db().execute({
    sql: `SELECT id FROM paga_offramps
           WHERE status='failed' AND refund_digest IS NULL
             AND (refund_state IS NULL OR refund_state='refund_failed')
           ORDER BY created_at ASC LIMIT ?`,
    args: [limit],
  });
  let refunded = 0;
  const ids = r.rows.map((row) => String((row as { id: string }).id));
  for (const id of ids) {
    const res = await refundOfframp(id);
    if (res.refunded) refunded += 1;
  }
  return { attempted: ids.length, refunded };
}
