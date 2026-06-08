import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { db, ensureSchema, userById } from "@/lib/db";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { rateLimitAsync } from "@/lib/rate-limit";
import { createOrder, linqConfigured } from "@/lib/linq";
import { resolveLinqBank } from "@/lib/linq-banks";

export const runtime = "nodejs";

/**
 * POST /api/offramp/linq/create
 *
 * Create a Linq off-ramp ORDER. Linq returns a deposit `walletAddress` it
 * watches; the client then sends exactly `amountUsdsui` USDSUI to that address
 * using the normal sponsored send rail, and Linq pays the bank itself.
 *
 * We persist a `linq_offramps` row keyed to the user and return the deposit
 * address + locked NGN. No treasury, no on-chain verification, no refund path
 * (Linq owns deposit detection + the 10-minute timeout).
 *
 * Body: { amountUsdsui, bankCode, accountNumber, accountName, bankName? }
 */
export async function POST(req: Request) {
  if (!linqConfigured()) {
    return NextResponse.json({ error: "off-ramp not configured" }, { status: 503 });
  }

  const userId = await readEntryIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  // Tighter cap on order creation than on quoting — each creates a real Linq
  // order. Defense-in-depth on top of Linq's own 10/min/key limit.
  const rl = await rateLimitAsync({ key: `offramp-linq-create:user:${userId}`, limit: 6, windowSec: 60 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec ?? 60) } }
    );
  }
  const user = await userById(userId);
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  let body: {
    amountUsdsui?: number;
    bankCode?: string;
    accountNumber?: string;
    accountName?: string;
    bankName?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const amountUsdsui = Number(body.amountUsdsui);
  const bankCode = String(body.bankCode ?? "").trim();
  const accountNumber = String(body.accountNumber ?? "").trim();
  const accountName = String(body.accountName ?? "").trim();
  const bank = resolveLinqBank(bankCode);
  const bankName = String(body.bankName ?? bank?.name ?? "").trim();

  if (!Number.isFinite(amountUsdsui) || amountUsdsui <= 0) {
    return NextResponse.json({ error: "amountUsdsui must be positive" }, { status: 400 });
  }
  if (!bank || !/^\d{10}$/.test(accountNumber) || !accountName) {
    return NextResponse.json(
      { error: "bankCode, 10-digit accountNumber and accountName are required" },
      { status: 400 }
    );
  }

  const id = randomUUID(); // our row id; doubles as the idempotency key
  const now = Date.now();

  let order;
  try {
    order = await createOrder({
      amountStableCoin: amountUsdsui,
      bankAccount: accountNumber,
      bankCode,
      bankName,
      accountName,
      customerRef: String(userId),
      idempotencyKey: id,
    });
  } catch (e) {
    const reason = (e as Error).message ?? "Linq rejected the order";
    console.warn("[offramp/linq/create] createOrder failed:", reason);
    return NextResponse.json({ error: "Could not start the cash-out.", reason }, { status: 502 });
  }

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
        String(userId),
        amountUsdsui,
        order.amountNGN,
        order.rate,
        bankCode,
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
    console.warn("[offramp/linq/create] persist failed:", (e as Error).message);
  }

  return NextResponse.json({
    orderId: id,
    linqOrderId: order.id,
    walletAddress: order.walletAddress,
    coinType: order.coinType,
    amountUsdsui: order.amountStableCoin,
    amountNgn: order.amountNGN,
    rate: order.rate,
    // The client now sends exactly `amountUsdsui` USDSUI to `walletAddress`
    // (normal sponsored send), then polls /api/offramp/linq/status/[orderId].
    depositWindowMinutes: 10,
  });
}
