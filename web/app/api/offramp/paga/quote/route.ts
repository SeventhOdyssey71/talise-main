import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { db, ensureSchema, userById } from "@/lib/db";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { requireAppAttestStructural } from "@/lib/app-attest";
import { FX } from "@/lib/fx";
import { nameEnquiry } from "@/lib/paga";
import { resolveBank } from "@/lib/paga-banks";

export const runtime = "nodejs";

/**
 * POST /api/offramp/paga/quote
 *
 * Build a fresh USDsui → NGN quote for a Paga bank payout. The user enters
 * a NGN amount + bank account; we resolve the account holder name (Paga
 * name-enquiry), price USDsui-in against current FX + the Talise spread,
 * persist a `paga_offramps` row with `status='quoted'`, and return the
 * locked quote. The quote expires in 60s — confirm has to land before then
 * or the user has to re-quote.
 */

const QUOTE_TTL_MS = 60_000;
const DEFAULT_SPREAD_BPS = 25; // 0.25% — tight launch spread, env-overridable

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

  let body: { ngnAmount?: number; bankCode?: string; accountNumber?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const ngnAmount = Number(body.ngnAmount);
  const bankCode = String(body.bankCode ?? "").trim();
  const accountNumber = String(body.accountNumber ?? "").trim();
  if (!Number.isFinite(ngnAmount) || ngnAmount <= 0) {
    return NextResponse.json({ error: "ngnAmount must be positive" }, { status: 400 });
  }
  if (!bankCode || !accountNumber) {
    return NextResponse.json(
      { error: "bankCode and accountNumber required" },
      { status: 400 }
    );
  }
  // Accept either a 3-digit NIBSS code or a full Paga UUID. The Paga API
  // wants the UUID — fail closed if we can't resolve it locally.
  const bank = resolveBank(bankCode);
  if (!bank) {
    return NextResponse.json(
      { error: `unsupported bankCode "${bankCode}"` },
      { status: 400 }
    );
  }

  // Paga name-enquiry. A 422 here is the standard "wrong account number"
  // path — surface a user-friendly message because this is what the iOS
  // form will show inline next to the account field.
  let accountName: string;
  try {
    const r = await nameEnquiry({
      bankCode: bank.uuid,
      accountNumber,
    });
    accountName = r.accountName;
  } catch (e) {
    console.warn("[offramp/paga/quote] nameEnquiry failed:", (e as Error).message);
    return NextResponse.json(
      { error: "Could not verify the bank account." },
      { status: 422 }
    );
  }

  // Spread + FX. Spread default 1.5% (150bps) — pulled from env to make it
  // operationally tweakable without a deploy. The user is debited
  // `ngnAmount / fxEffective` USDsui where `fxEffective` is the current
  // NGN-per-USD minus the spread (so the user pays slightly more USDsui
  // per NGN than the mid-market rate).
  const spreadBps = Number(process.env.OFFRAMP_SPREAD_BPS ?? DEFAULT_SPREAD_BPS);
  const safeSpreadBps = Number.isFinite(spreadBps) && spreadBps >= 0 ? spreadBps : DEFAULT_SPREAD_BPS;
  const midRate = FX.NGN;
  const fxEffective = midRate * (1 - safeSpreadBps / 10_000);
  if (fxEffective <= 0) {
    return NextResponse.json({ error: "fx_unavailable" }, { status: 503 });
  }
  // 6-decimal USDsui rounding (matches USDSUI_DECIMALS).
  const usdsuiAmount = Math.ceil((ngnAmount / fxEffective) * 1_000_000) / 1_000_000;

  const id = randomUUID();
  const now = Date.now();
  const expiresAt = now + QUOTE_TTL_MS;

  await ensureSchema();
  await db().execute({
    sql: `INSERT INTO paga_offramps
      (id, user_id, usdsui_amount, ngn_amount, fx_rate,
       bank_code, bank_account_number, bank_account_name,
       status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'quoted', ?)`,
    args: [
      id,
      String(userId),
      usdsuiAmount,
      ngnAmount,
      fxEffective,
      bank.uuid,
      accountNumber,
      accountName,
      now,
    ],
  });

  return NextResponse.json({
    quoteId: id,
    usdsuiAmount,
    ngnAmount,
    fxRate: fxEffective,
    accountName,
    expiresAt,
  });
}
