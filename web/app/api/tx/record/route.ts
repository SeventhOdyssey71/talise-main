import { NextResponse } from "next/server";
import { readSessionEntryId } from "@/lib/session";
import {
  markInvoicePaid,
  recordTx,
  setInvoiceReceiptObjectId,
  userById,
} from "@/lib/db";

export const runtime = "nodejs";

/**
 * POST /api/tx/record
 *
 * Records an outbound transaction in the user's history table after they've
 * signed and broadcast it. The caller controls the body fully, so every
 * field is validated + length-capped before it hits the DB. tx_history is a
 * hint/cache — for audit-grade truth we read chain directly via lib/activity.
 */

// Sui tx digest: base58 of a 32-byte hash. ~44 chars typical. We allow 40-60.
const DIGEST_RE = /^[1-9A-HJ-NP-Za-km-z]{40,60}$/;
const KIND_ALLOWED = new Set([
  "send",
  "pay-merchant",
  "pay-invoice",
  "payroll",
  "bills",
  "remit",
  "earn-supply",
  "spot-lp-deposit",
  "send-cross-asset",
  "send-and-invest",
]);
const ASSET_ALLOWED = new Set([
  "USDsui",
  "SUI",
  "USDC",
  "USDsui→SUI",
  "SUI→USDsui",
]);
const ADDR_RE = /^0x[a-fA-F0-9]{64}$/;
const SLUG_RE = /^[a-z0-9_-]{1,64}$/;
const MEMO_MAX = 200;
const AMOUNT_MAX = 64;

export async function POST(req: Request) {
  const userId = await readSessionEntryId();
  if (!userId) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const user = await userById(userId);
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  let body: {
    digest?: unknown;
    kind?: unknown;
    amount?: unknown;
    asset?: unknown;
    recipient?: unknown;
    memo?: unknown;
    invoiceSlug?: unknown;
    receiptObjectId?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  if (typeof body.digest !== "string" || !DIGEST_RE.test(body.digest)) {
    return NextResponse.json(
      { error: "digest required (40-60 base58 chars)" },
      { status: 400 }
    );
  }
  const digest = body.digest;

  const kindRaw = typeof body.kind === "string" ? body.kind : "send";
  const kind = KIND_ALLOWED.has(kindRaw) ? kindRaw : "send";

  let amount: string | null = null;
  if (typeof body.amount === "string" && body.amount.length > 0) {
    if (body.amount.length > AMOUNT_MAX) {
      return NextResponse.json({ error: "amount too long" }, { status: 400 });
    }
    if (!/^-?\d+(\.\d+)?$/.test(body.amount)) {
      return NextResponse.json(
        { error: "amount must be numeric" },
        { status: 400 }
      );
    }
    amount = body.amount;
  }

  const asset =
    typeof body.asset === "string" && ASSET_ALLOWED.has(body.asset)
      ? body.asset
      : null;

  let recipient: string | null = null;
  if (typeof body.recipient === "string" && body.recipient.length > 0) {
    if (!ADDR_RE.test(body.recipient)) {
      return NextResponse.json(
        { error: "recipient must be 0x + 64 hex chars" },
        { status: 400 }
      );
    }
    recipient = body.recipient.toLowerCase();
  }

  let memo: string | null = null;
  if (typeof body.memo === "string" && body.memo.length > 0) {
    memo = body.memo.slice(0, MEMO_MAX);
  }

  let invoiceSlug: string | null = null;
  if (typeof body.invoiceSlug === "string" && body.invoiceSlug.length > 0) {
    if (!SLUG_RE.test(body.invoiceSlug)) {
      return NextResponse.json(
        { error: "invoiceSlug must be 1-64 [a-z0-9_-] chars" },
        { status: 400 }
      );
    }
    invoiceSlug = body.invoiceSlug;
  }

  let receiptObjectId: string | null = null;
  if (
    typeof body.receiptObjectId === "string" &&
    body.receiptObjectId.length > 0
  ) {
    if (!ADDR_RE.test(body.receiptObjectId)) {
      return NextResponse.json(
        { error: "receiptObjectId must be 0x + 64 hex chars" },
        { status: 400 }
      );
    }
    receiptObjectId = body.receiptObjectId.toLowerCase();
  }

  await recordTx({
    userId: user.id,
    digest,
    kind,
    amount,
    asset,
    recipient,
    memo,
    receiptObjectId,
  });

  // TODO(rewards): wire volume-milestone + first-send bonuses here once we
  // settle on a USDsui amount normalization. The helpers live in
  // `lib/rewards.ts` — `awardVolumePoints(user.id, amountUsdsui, digest)` for
  // every send, and `awardFirstSendBonus(user.id, digest)` gated by a
  // `tx_history` row-count check so it only fires once per user.

  if (invoiceSlug) {
    try {
      await markInvoicePaid(invoiceSlug, digest, user.sui_address);
      if (receiptObjectId) {
        await setInvoiceReceiptObjectId(invoiceSlug, receiptObjectId);
      }
    } catch (e) {
      console.warn(`[tx/record] invoice close failed: ${(e as Error).message}`);
    }
  }

  return NextResponse.json({ ok: true });
}
