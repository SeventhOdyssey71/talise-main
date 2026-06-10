import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { db, ensureSchema, userById, userBySuiAddress } from "@/lib/db";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { rateLimitAsync } from "@/lib/rate-limit";
import { createOrder, getRate, linqConfigured, OFFRAMP_MAX_USD } from "@/lib/linq";
import { resolveLinqBank } from "@/lib/linq-banks";
import { resolveRecipient } from "@/lib/suins";
import { getPrimaryBankAccount, last4 } from "@/lib/bank-accounts";

export const runtime = "nodejs";

/**
 * POST /api/offramp/linq/to-user
 *
 * "Pay a @handle straight to their bank." The SENDER picks a recipient and an
 * NGN amount; we resolve the recipient to a Talise user, load THEIR primary
 * payout bank, and create a Linq off-ramp order to that bank. We hand the
 * sender back a deposit `walletAddress` + the EXACT `amountUsdsui` to send
 * (recomputed from the order's LOCKED rate, mirroring /create). The sender's
 * client then sends that USDSUI via the normal sponsored send and polls
 * /api/offramp/linq/status/[orderId]. The sender NEVER receives the
 * recipient's full account number — only a masked "<BankName> ••••<last4>".
 *
 * The linq_offramps row is keyed to the SENDER's user id (it's the sender's
 * cash-out), with the bank fields set to the RECIPIENT's primary bank.
 *
 * Body: { recipient: string (@handle or 0x address), amountNgn: number }
 */
export async function POST(req: Request) {
  if (!linqConfigured()) {
    return NextResponse.json({ error: "off-ramp not configured" }, { status: 503 });
  }

  const userId = await readEntryIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  // Same tight cap as /create — each call creates a real Linq order.
  const rl = await rateLimitAsync({
    key: `offramp-linq-to-user:user:${userId}`,
    limit: 6,
    windowSec: 60,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec ?? 60) } }
    );
  }
  const sender = await userById(userId);
  if (!sender) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  let body: { recipient?: string; amountNgn?: number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const recipientInput = String(body.recipient ?? "").trim();
  const reqNgn = Number(body.amountNgn);
  if (!recipientInput) {
    return NextResponse.json({ error: "recipient is required" }, { status: 400 });
  }
  if (!Number.isFinite(reqNgn) || reqNgn <= 0) {
    return NextResponse.json({ error: "amountNgn must be positive" }, { status: 400 });
  }

  // Resolve the recipient → a Talise user → their PRIMARY payout bank.
  let recipientAddress: string;
  try {
    const resolved = await resolveRecipient(recipientInput);
    if (!resolved) {
      return NextResponse.json({ error: "recipient not found" }, { status: 404 });
    }
    recipientAddress = resolved.address;
  } catch (e) {
    console.warn("[offramp/linq/to-user] resolve failed:", (e as Error).message);
    return NextResponse.json({ error: "Could not resolve the recipient." }, { status: 502 });
  }

  const recipient = await userBySuiAddress(recipientAddress);
  if (!recipient) {
    return NextResponse.json(
      { error: "recipient has no bank on file" },
      { status: 404 }
    );
  }
  const bankRow = await getPrimaryBankAccount(recipient.id);
  if (!bankRow) {
    return NextResponse.json(
      { error: "recipient has no bank on file" },
      { status: 404 }
    );
  }

  const bank = resolveLinqBank(bankRow.bank_code);
  const bankName = bank?.name ?? bankRow.bank_code;
  const accountNumber = bankRow.account_number;
  const accountName = bankRow.account_name ?? "";
  if (!/^\d{10}$/.test(accountNumber) || !accountName) {
    // A malformed stored bank shouldn't expose internals to the sender.
    return NextResponse.json(
      { error: "recipient has no bank on file" },
      { status: 404 }
    );
  }

  const r6 = (n: number) => Math.round(n * 1e6) / 1e6; // USDsui = 6 dp
  const r2 = (n: number) => Math.round(n * 100) / 100; // NGN = 2 dp

  // Estimate the initial stablecoin amount from the display rate; the EXACT
  // amount to send is recomputed below from the order's LOCKED rate.
  let initialUsdsui: number;
  try {
    const rateNow = (await getRate()).rate;
    if (!Number.isFinite(rateNow) || rateNow <= 0) throw new Error("bad rate");
    initialUsdsui = r6(reqNgn / rateNow);
  } catch {
    return NextResponse.json({ error: "rate_unavailable" }, { status: 503 });
  }

  // Beta cap: $200 per withdrawal (server-enforced in quote + create + to-user).
  if (initialUsdsui > OFFRAMP_MAX_USD) {
    return NextResponse.json(
      {
        error: `Cash-outs are capped at $${OFFRAMP_MAX_USD} per withdrawal during beta.`,
        code: "OFFRAMP_CAP",
        maxUsd: OFFRAMP_MAX_USD,
      },
      { status: 400 }
    );
  }

  const id = randomUUID(); // our row id; doubles as the idempotency key
  const now = Date.now();

  let order;
  try {
    order = await createOrder({
      amountStableCoin: initialUsdsui,
      bankAccount: accountNumber,
      bankCode: bankRow.bank_code,
      bankName,
      accountName,
      customerRef: String(userId),
      idempotencyKey: id,
    });
  } catch (e) {
    const reason = (e as Error).message ?? "Linq rejected the order";
    console.warn("[offramp/linq/to-user] createOrder failed:", reason);
    return NextResponse.json({ error: "Could not start the payout.", reason }, { status: 502 });
  }

  // Linq pays (USDsui that ARRIVES) × the order's LOCKED rate. To credit the
  // recipient an exact NGN figure, the sender sends amountNgn / lockedRate.
  const lockedRate =
    order.rate > 0 ? order.rate : order.amountNGN / Math.max(initialUsdsui, 1e-6);
  const sendUsdsui = r6(reqNgn / lockedRate);
  const creditNgn = r2(sendUsdsui * lockedRate);

  await ensureSchema();
  try {
    await db().execute({
      sql: `INSERT INTO linq_offramps
        (id, linq_order_id, user_id, amount_usdsui, amount_ngn, rate,
         bank_code, bank_account_number, bank_account_name,
         wallet_address, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'initiated', ?, ?)`,
      args: [
        id,
        order.id,
        // Keyed to the SENDER — it's the sender's cash-out — even though the
        // bank fields belong to the recipient.
        String(userId),
        sendUsdsui,
        creditNgn,
        lockedRate,
        bankRow.bank_code,
        accountNumber,
        accountName,
        order.walletAddress,
        now,
        now,
      ],
    });
  } catch (e) {
    // Order exists at Linq even if our persist hiccuped — surface it anyway so
    // the client can still send + poll; reconcile via webhook/status by orderId.
    console.warn("[offramp/linq/to-user] persist failed:", (e as Error).message);
  }

  return NextResponse.json({
    orderId: id,
    walletAddress: order.walletAddress,
    coinType: order.coinType,
    // EXACT amount the SENDER must send so the recipient is credited amountNgn.
    amountUsdsui: sendUsdsui,
    amountNgn: creditNgn,
    rate: lockedRate,
    recipientName: accountName,
    // Masked — the sender sees the bank + last 4 only, never the full number.
    recipientBankLabel: `${bankName} ••••${last4(accountNumber)}`,
    // The client now sends exactly `amountUsdsui` USDSUI to `walletAddress`
    // (normal sponsored send), then polls /api/offramp/linq/status/[orderId].
    depositWindowMinutes: 10,
  });
}
