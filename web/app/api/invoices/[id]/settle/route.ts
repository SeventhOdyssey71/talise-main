import { NextResponse } from "next/server";
import { rateLimitAsync } from "@/lib/rate-limit";
import { userById } from "@/lib/db";
import { getNormalizedTransaction } from "@/lib/sui-shapes";
import { isUsdsui } from "@/lib/usdsui";
import {
  workInvoiceById,
  markWorkInvoicePaid,
  workInvoiceDigestUsed,
} from "@/lib/invoices";
import { suiscanTxUrl } from "@/lib/sui";

export const runtime = "nodejs";

/**
 * POST /api/invoices/[id]/settle — TRUSTLESS public settlement of a rich
 * (`work_invoices`) invoice.
 *
 * Anyone (the payer — NO auth required) can close an open invoice by submitting
 * the on-chain digest of their payment. The server never trusts the caller: it
 * loads the invoice + issuer authoritatively, fetches the transaction by digest
 * via the canonical verifier, and only marks the invoice paid when the tx
 * SUCCEEDED and credited the issuer's address with at least the invoice's
 * canonical USDsui amount.
 *
 * This mirrors the verified path in /api/tx/record (`verifyAndCloseInvoice`,
 * which guards the legacy `invoices` table) — the rich `work_invoices` used by
 * the public /i/<id> web checkout previously had only an owner-asserted,
 * UNVERIFIED mark-paid. This closes that gap so "paid" is provable, not claimed.
 *
 * Idempotent: re-settling an already-paid invoice returns ok with the recorded
 * digest. Replay-guarded: a digest that already settled a different invoice is
 * rejected (so one payment can't clear two same-amount invoices to a merchant).
 */

const DIGEST_RE = /^[1-9A-HJ-NP-Za-km-z]{40,60}$/;
const USDSUI_MICRO = 1_000_000;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: { digest?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const digest = typeof body.digest === "string" ? body.digest.trim() : "";
  if (!DIGEST_RE.test(digest)) {
    return NextResponse.json(
      { error: "a valid transaction digest is required" },
      { status: 400 }
    );
  }

  // Per-invoice rate limit — settlement does an RPC round-trip, so cap retries.
  const rl = await rateLimitAsync({
    key: `invoice-settle:${id}`,
    limit: 30,
    windowSec: 600,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec ?? 600) } }
    );
  }

  const invoice = await workInvoiceById(id);
  if (!invoice) {
    return NextResponse.json({ error: "invoice not found" }, { status: 404 });
  }
  // Idempotent: already closed.
  if (invoice.status === "paid") {
    const d = invoice.payDigest ?? digest;
    return NextResponse.json({
      ok: true,
      status: "paid",
      digest: d,
      explorerUrl: suiscanTxUrl(d),
    });
  }
  if (invoice.status !== "open") {
    return NextResponse.json(
      { error: `this invoice is ${invoice.status}` },
      { status: 409 }
    );
  }

  const issuer = await userById(invoice.userId);
  if (!issuer) {
    return NextResponse.json({ error: "invoice issuer not found" }, { status: 404 });
  }
  const issuerAddress = issuer.sui_address.toLowerCase();

  // Replay guard: a digest can settle at most one invoice.
  if (await workInvoiceDigestUsed(digest, id)) {
    return NextResponse.json(
      { error: "this transaction already settled another invoice" },
      { status: 409 }
    );
  }

  // Tolerance for u64<->float rounding (1 micro-unit = 1e-6 USDsui).
  const expectedMicro = BigInt(Math.round(invoice.amountUsd * USDSUI_MICRO));

  let tx;
  try {
    tx = await getNormalizedTransaction(digest);
  } catch (e) {
    // RPC indexing lag is common right after broadcast — the caller retries.
    return NextResponse.json(
      { error: `could not verify payment yet: ${(e as Error).message}` },
      { status: 400 }
    );
  }

  if (tx.status !== "success") {
    return NextResponse.json(
      { error: `payment transaction did not succeed (${tx.status})` },
      { status: 400 }
    );
  }

  // Sum USDsui credited to the issuer; capture the payer (matching negative
  // USDsui delta) for the audit trail.
  let receivedMicro = 0n;
  let payerAddress: string | null = null;
  for (const c of tx.balanceChanges) {
    if (!isUsdsui(c.coinType)) continue;
    if (c.ownerAddress === issuerAddress) {
      if (c.amount > 0n) receivedMicro += c.amount;
    } else if (c.amount < 0n && c.ownerAddress && !payerAddress) {
      payerAddress = c.ownerAddress;
    }
  }

  // Bind the payment to THIS invoice by amount: reject underpayment AND gross
  // overpayment. The upper bound (+0.5%) stops a larger payment (meant for a
  // different invoice of the same merchant) from closing a smaller one.
  const maxMicro = expectedMicro + (expectedMicro * 50n) / 10_000n;
  if (receivedMicro < expectedMicro || receivedMicro > maxMicro) {
    return NextResponse.json(
      {
        error: `payment of ${Number(receivedMicro) / USDSUI_MICRO} USDsui does not match the ${invoice.amountUsd} USDsui due`,
      },
      { status: 400 }
    );
  }

  // Authoritative close: the partial-unique index on pay_digest wins any race
  // (a digest that already settled another invoice raises a unique violation).
  let claimed = false;
  try {
    claimed = await markWorkInvoicePaid({ id, digest, payerAddress });
  } catch (e) {
    if (/duplicate key|unique/i.test((e as Error).message)) {
      return NextResponse.json(
        { error: "this transaction already settled another invoice" },
        { status: 409 }
      );
    }
    throw e;
  }
  if (!claimed) {
    return NextResponse.json(
      { error: "this invoice is no longer open" },
      { status: 409 }
    );
  }

  return NextResponse.json({
    ok: true,
    status: "paid",
    digest,
    explorerUrl: suiscanTxUrl(digest),
  });
}
