import { NextResponse } from "next/server";

import { userById } from "@/lib/db";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { denyUnlessAppApproved } from "@/lib/app-access";
import { rateLimitAsync } from "@/lib/rate-limit";
import { verifyBank, linqConfigured } from "@/lib/linq";
import { resolveLinqBank } from "@/lib/linq-banks";
import { getPayoutTargets, rememberPayoutTarget } from "@/lib/bank-accounts";

export const runtime = "nodejs";

/**
 * Saved cash-out beneficiaries.
 *
 *   GET  /api/me/beneficiaries        → { beneficiaries: LinkedBankAccount[] }
 *   POST /api/me/beneficiaries        → { beneficiary }
 *        body: { bankCode, accountNumber, label? }
 *
 * Everything the user can pay out to: their own linked accounts plus saved
 * third-party beneficiaries, most recently used first. Account numbers are
 * masked to last-4 in every response — the full number lives encrypted and
 * only leaves the server toward the payout provider.
 *
 * ── The name is never taken from the client ──
 *
 * POST resolves the account holder through the bank network (the same
 * name-enquiry the cash-out form runs) and stores THAT name. A saved
 * beneficiary is read back later as the thing a user confirms before money
 * leaves, so a client-supplied label on an account number would be a way to
 * make a payout look like it's going somewhere it isn't. An unverifiable
 * account is rejected rather than saved unnamed.
 *
 * `label` is free text and purely cosmetic; it sits ALONGSIDE the verified
 * name in the UI, never instead of it.
 */

export async function GET(req: Request) {
  const userId = await readEntryIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const denied = await denyUnlessAppApproved(userId);
  if (denied) return denied;
  try {
    return NextResponse.json({ beneficiaries: await getPayoutTargets(userId) });
  } catch (e) {
    console.warn(`[beneficiaries GET] user=${userId}: ${(e as Error).message}`);
    // An empty list degrades to "type the details in", which still works.
    return NextResponse.json({ beneficiaries: [] });
  }
}

export async function POST(req: Request) {
  if (!linqConfigured()) {
    return NextResponse.json(
      { error: "Bank payouts aren't available right now." },
      { status: 503 }
    );
  }
  const userId = await readEntryIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const denied = await denyUnlessAppApproved(userId);
  if (denied) return denied;

  // Name-enquiry hits the bank network. Same budget as /offramp/linq/resolve.
  const rl = await rateLimitAsync({
    key: `beneficiary-add:user:${userId}`,
    limit: 20,
    windowSec: 60,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Try again in a minute." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec ?? 60) } }
    );
  }

  const user = await userById(userId);
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  let body: { bankCode?: unknown; accountNumber?: unknown; label?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const bankCode = String(body.bankCode ?? "").trim();
  const accountNumber = String(body.accountNumber ?? "").trim();
  const label =
    typeof body.label === "string" && body.label.trim()
      ? body.label.trim().slice(0, 40)
      : null;

  if (!resolveLinqBank(bankCode) || !/^\d{10}$/.test(accountNumber)) {
    return NextResponse.json(
      { error: "Choose a bank and enter a 10-digit account number." },
      { status: 400 }
    );
  }

  let accountName: string | null = null;
  try {
    const v = await verifyBank({ bankCode, accountNumber });
    accountName = v.accountName ?? null;
  } catch (e) {
    console.warn(`[beneficiaries POST] verify failed: ${(e as Error).message}`);
    return NextResponse.json(
      { error: "Couldn't verify that account. Check the details and try again." },
      { status: 422 }
    );
  }
  if (!accountName) {
    return NextResponse.json(
      { error: "Couldn't verify that account. Check the details and try again." },
      { status: 422 }
    );
  }

  const saved = await rememberPayoutTarget({
    userId,
    bankCode,
    accountNumber,
    accountName,
    label,
  });
  if (!saved) {
    return NextResponse.json(
      { error: "Couldn't save that beneficiary. Try again." },
      { status: 500 }
    );
  }
  return NextResponse.json({ beneficiary: saved });
}
