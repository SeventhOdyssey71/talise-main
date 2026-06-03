import { NextResponse } from "next/server";

import { db, ensureSchema, userById } from "@/lib/db";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { requireAppAttestStructural } from "@/lib/app-attest";
import { getNormalizedTransaction } from "@/lib/sui-shapes";
import { USDSUI_DECIMALS } from "@/lib/sui";
import { isUsdsui } from "@/lib/usdsui";
import { moneyTransfer } from "@/lib/paga";
import { refundOfframp } from "@/lib/offramp-refund";

export const runtime = "nodejs";

/**
 * POST /api/offramp/paga/confirm
 *
 * Trip 2 of the offramp flow. iOS has already broadcast a Sui PTB that
 * sends `usdsuiAmount` USDsui from the user's address to the Talise
 * treasury (`TALISE_OFFRAMP_TREASURY`). We:
 *
 *   1. Load the `paga_offramps` row by `quoteId`, verify ownership and
 *      that it is still in `status='quoted'` within its 60s TTL.
 *   2. Pull the on-chain transaction via gRPC `getTransaction(digest)` and
 *      confirm it actually moved at least the quoted USDsui (within a
 *      0.5% tolerance for rounding) from `user.sui_address` to the
 *      treasury.
 *   3. Flip the row to `debited` and call Paga `moneyTransfer` to
 *      initiate the NGN payout. On ack we flip to `remitting` + persist
 *      the Paga reference. On reject we flip to `failed`.
 *
 * Refunds (returning USDsui to the user when Paga rejects after debit)
 * are deferred — TODO below.
 */

const QUOTE_TTL_MS = 60_000;
const AMOUNT_TOLERANCE_BPS = 50; // 0.5%

interface OfframpRow {
  id: string;
  user_id: string;
  usdsui_amount: string | number;
  ngn_amount: string | number;
  fx_rate: string | number;
  bank_code: string;
  bank_account_number: string;
  bank_account_name: string | null;
  paga_reference: string | null;
  status: string;
  created_at: number;
}

function toNumber(v: string | number | null | undefined): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v);
  return 0;
}

export async function POST(req: Request) {
  const attestBlock = requireAppAttestStructural(req);
  if (attestBlock) return attestBlock;

  const userId = await readEntryIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const user = await userById(userId);
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  let body: { quoteId?: string; txDigest?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const quoteId = String(body.quoteId ?? "").trim();
  const txDigest = String(body.txDigest ?? "").trim();
  if (!quoteId || !txDigest) {
    return NextResponse.json(
      { error: "quoteId and txDigest required" },
      { status: 400 }
    );
  }

  const treasury = process.env.TALISE_OFFRAMP_TREASURY;
  if (!treasury) {
    return NextResponse.json(
      { error: "TALISE_OFFRAMP_TREASURY not configured" },
      { status: 503 }
    );
  }
  const treasuryNorm = treasury.toLowerCase();

  await ensureSchema();
  const c = db();

  const r = await c.execute({
    sql: "SELECT * FROM paga_offramps WHERE id = ? LIMIT 1",
    args: [quoteId],
  });
  const row = r.rows[0] as unknown as OfframpRow | undefined;
  if (!row) {
    return NextResponse.json({ error: "quote not found" }, { status: 404 });
  }
  if (row.user_id !== String(userId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (row.status !== "quoted") {
    return NextResponse.json(
      { error: `quote already ${row.status}` },
      { status: 409 }
    );
  }
  if (Date.now() - row.created_at > QUOTE_TTL_MS) {
    return NextResponse.json({ error: "quote expired" }, { status: 410 });
  }

  // F2: a given on-chain debit digest may back AT MOST ONE payout. Reject a
  // digest already consumed by ANY quote (cheap early-out; the atomic debit
  // below is the hard guard via the UNIQUE index). Without this, N quotes for
  // the same amount + ONE real transfer = N NGN payouts.
  const dup = await c.execute({
    sql: "SELECT id FROM paga_offramps WHERE onchain_digest = ? LIMIT 1",
    args: [txDigest],
  });
  if (dup.rows[0]) {
    return NextResponse.json(
      { error: "this transaction was already used for a payout" },
      { status: 409 }
    );
  }

  // ─── On-chain verification ────────────────────────────────────────
  const expectedUsdsui = toNumber(row.usdsui_amount);
  // Convert to raw minor units (BigInt) for chain-side comparison.
  const expectedRaw = BigInt(
    Math.floor(expectedUsdsui * 10 ** USDSUI_DECIMALS)
  );
  // Tolerance: allow the user to send up to 0.5% LESS than quoted — covers
  // off-by-rounding-dust between the iOS PTB and our server-side ceil(). We
  // never refund the surplus if they overpay; that's caught in P2.
  const toleranceRaw =
    (expectedRaw * BigInt(AMOUNT_TOLERANCE_BPS)) / 10_000n;
  const minRaw = expectedRaw - toleranceRaw;

  const userAddrNorm = user.sui_address.toLowerCase();

  let onchainOk = false;
  try {
    const norm = await getNormalizedTransaction(txDigest);
    if (norm.status !== "success") {
      throw new Error(`tx status=${norm.status}`);
    }
    if (norm.sender.toLowerCase() !== userAddrNorm) {
      throw new Error(`sender ${norm.sender} != user ${userAddrNorm}`);
    }
    // Find a USDsui balance change INTO the treasury of >= minRaw.
    for (const bc of norm.balanceChanges) {
      if (!isUsdsui(bc.coinType)) continue;
      if ((bc.ownerAddress ?? "").toLowerCase() !== treasuryNorm) continue;
      if (bc.amount >= minRaw) {
        onchainOk = true;
        break;
      }
    }
    if (!onchainOk) {
      throw new Error(
        `no matching USDsui balance change to treasury for >= ${minRaw} (expected ${expectedRaw})`
      );
    }
  } catch (e) {
    const reason = (e as Error).message ?? "on-chain verification failed";
    await c.execute({
      sql: `UPDATE paga_offramps SET status='failed', status_reason=?, failed_at=?
            WHERE id = ? AND status='quoted'`,
      args: [`onchain: ${reason}`.slice(0, 500), Date.now(), quoteId],
    });
    return NextResponse.json(
      { error: "on-chain verification failed", reason },
      { status: 422 }
    );
  }

  // Flip to debited before calling Paga. Idempotent guard: only transition
  // from 'quoted'. If another concurrent confirm raced us, the UPDATE
  // affects 0 rows and we bail out without double-paying.
  const debitNow = Date.now();
  let upd;
  try {
    // Bind the digest in the SAME atomic transition. The NOT EXISTS guard
    // makes a reused digest a clean 0-row no-op; the UNIQUE index is the hard
    // backstop for a true concurrent race (one wins, the other throws → 409).
    upd = await c.execute({
      sql: `UPDATE paga_offramps SET status='debited', debited_at=?, onchain_digest=?
            WHERE id = ? AND status='quoted'
              AND NOT EXISTS (SELECT 1 FROM paga_offramps WHERE onchain_digest = ?)`,
      args: [debitNow, txDigest, quoteId, txDigest],
    });
  } catch (e) {
    console.warn(
      `[offramp/confirm] digest-bind race for ${txDigest}: ${(e as Error).message}`
    );
    return NextResponse.json(
      { error: "this transaction was already used for a payout" },
      { status: 409 }
    );
  }
  if (upd.rowsAffected === 0) {
    return NextResponse.json({ error: "quote no longer debitable" }, { status: 409 });
  }

  // ─── Hand off to Paga ─────────────────────────────────────────────
  try {
    const result = await moneyTransfer({
      amount: toNumber(row.ngn_amount),
      destinationBankUUID: row.bank_code,
      destinationBankAccountNumber: row.bank_account_number,
      recipientName: row.bank_account_name ?? "Talise user",
      reference: row.id,
      remarks: "Talise withdraw",
    });
    await c.execute({
      sql: `UPDATE paga_offramps SET status='remitting', paga_reference=?
            WHERE id = ?`,
      args: [result.pagaReference, quoteId],
    });
    return NextResponse.json({
      status: "remitting",
      pagaReference: result.pagaReference,
    });
  } catch (e) {
    const reason = (e as Error).message ?? "Paga rejected";
    await c.execute({
      sql: `UPDATE paga_offramps SET status='failed', status_reason=?, failed_at=?
            WHERE id = ?`,
      args: [`paga: ${reason}`.slice(0, 500), Date.now(), quoteId],
    });
    // Paga rejected AFTER the on-chain debit → return the USDsui from the
    // treasury to the user. Idempotent + self-healing (retry cron); never lets
    // a refund error mask the user-facing failure.
    const refund = await refundOfframp(quoteId).catch((e) => ({
      refunded: false,
      reason: (e as Error).message,
    }));
    return NextResponse.json(
      { error: "Paga rejected the payout", reason, status: "failed", refunded: refund.refunded },
      { status: 502 }
    );
  }
}
