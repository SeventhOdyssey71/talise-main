import { NextResponse } from "next/server";
import { rateLimitAsync } from "@/lib/rate-limit";
import { settleRequestByDigest } from "@/lib/requests";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { suiscanTxUrl } from "@/lib/sui";

export const runtime = "nodejs";

/**
 * POST /api/requests/[id]/pay — settle a payment request by on-chain digest.
 *
 * Body: { digest, payerAddress? }. Can be called WITHOUT auth (a public payer
 * who paid the requester directly) OR authed right after an in-app pay. The
 * server never trusts the caller: `settleRequestByDigest` loads the request +
 * requester authoritatively, verifies the tx on-chain (must have SUCCEEDED and
 * credited the requester's address with the requested USDsui amount), and
 * replay-guards the digest so one payment can't close two requests.
 *
 * Mirrors /api/invoices/[id]/settle. Idempotent: re-paying an already-paid
 * request returns ok with the recorded digest. An authed caller (the in-app
 * payer who knows they settled) gets the relaxed lower amount bound via
 * `trustPayer`, while the digest is still fully verified on-chain.
 */

const DIGEST_RE = /^[1-9A-HJ-NP-Za-km-z]{40,60}$/;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: { digest?: unknown; payerAddress?: unknown };
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
  const payerAddressHint =
    typeof body.payerAddress === "string" && body.payerAddress.trim()
      ? body.payerAddress.trim()
      : null;

  // Per-request rate limit — settlement does an RPC round-trip, so cap retries.
  const rl = await rateLimitAsync({
    key: `request-pay:${id}`,
    limit: 30,
    windowSec: 600,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec ?? 600) } }
    );
  }

  // An authed in-app payer that just signed the send gets the relaxed lower
  // amount bound (the digest is still verified on-chain either way).
  const viewerId = await readEntryIdFromRequest(req);
  const trustPayer = viewerId != null;

  const result = await settleRequestByDigest(id, digest, {
    trustPayer,
    payerAddressHint,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    status: "paid",
    digest: result.digest,
    explorerUrl: suiscanTxUrl(result.digest),
  });
}
