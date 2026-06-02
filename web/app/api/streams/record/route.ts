import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { requireAppAttestStructural } from "@/lib/app-attest";
import { rateLimitAsync } from "@/lib/rate-limit";
import { userById } from "@/lib/db";
import {
  createStreamRecord,
  newStreamId,
  streamEscrowEnabled,
} from "@/lib/streams";

export const runtime = "nodejs";

/**
 * POST /api/streams/record
 *
 * Called by iOS after the funding tx (from /api/streams/create-prepare) has
 * confirmed. Inserts the `streams` row in state `active` so the scheduler
 * picks it up. The funding tx is a plain gasless USDsui send into the escrow
 * address, so we don't parse on-chain objectChanges (the escrow variant has
 * no on-chain Stream object) — we mint a server-side stream id and trust the
 * client-forwarded funding digest + plan (which the server itself produced in
 * create-prepare and the limits ledger already reserved).
 *
 * Body: `{ fundingDigest, recipientAddress, recipientHandle?, totalMicros,
 *          trancheMicros, numTranches, startMs, intervalMs }`.
 */

const ADDRESS_RE = /^0x[a-f0-9]{1,64}$/i;
const UINT_RE = /^\d+$/;

export async function POST(req: Request) {
  const userId = await readEntryIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const attest = requireAppAttestStructural(req);
  if (attest) return attest;

  const rl = await rateLimitAsync({
    key: `streams-record:user:${userId}`,
    limit: 20,
    windowSec: 3600,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec ?? 3600) } }
    );
  }

  if (!streamEscrowEnabled()) {
    return NextResponse.json(
      { error: "Streaming payments aren't available.", code: "STREAM_ESCROW_DISABLED" },
      { status: 503 }
    );
  }

  const user = await userById(userId);
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  let body: {
    fundingDigest?: string;
    recipientAddress?: string;
    recipientHandle?: string | null;
    totalMicros?: string;
    trancheMicros?: string;
    numTranches?: number | string;
    startMs?: number | string;
    intervalMs?: number | string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const fundingDigest = (body.fundingDigest ?? "").trim();
  if (!fundingDigest) {
    return NextResponse.json({ error: "fundingDigest required" }, { status: 400 });
  }
  const recipientAddress = (body.recipientAddress ?? "").trim().toLowerCase();
  if (!ADDRESS_RE.test(recipientAddress)) {
    return NextResponse.json({ error: "invalid recipientAddress" }, { status: 400 });
  }

  const totalMicrosStr = String(body.totalMicros ?? "");
  const trancheMicrosStr = String(body.trancheMicros ?? "");
  if (!UINT_RE.test(totalMicrosStr) || !UINT_RE.test(trancheMicrosStr)) {
    return NextResponse.json(
      { error: "totalMicros and trancheMicros must be u64 decimal strings" },
      { status: 400 }
    );
  }
  const totalMicros = BigInt(totalMicrosStr);
  const trancheMicros = BigInt(trancheMicrosStr);

  const numTranches = Math.floor(Number(body.numTranches));
  const startMs = Math.floor(Number(body.startMs));
  const intervalMs = Math.floor(Number(body.intervalMs));
  if (
    !Number.isInteger(numTranches) || numTranches <= 0 ||
    !Number.isInteger(startMs) || startMs <= 0 ||
    !Number.isInteger(intervalMs) || intervalMs <= 0
  ) {
    return NextResponse.json({ error: "invalid schedule" }, { status: 400 });
  }
  if (totalMicros <= 0n || trancheMicros <= 0n) {
    return NextResponse.json({ error: "invalid amounts" }, { status: 400 });
  }

  const id = newStreamId();
  try {
    await createStreamRecord({
      id,
      senderUserId: userId,
      senderAddress: user.sui_address,
      recipientAddress,
      recipientHandle: (body.recipientHandle ?? null) || null,
      totalMicros,
      trancheMicros,
      numTranches,
      startMs,
      intervalMs,
      fundingDigest,
    });
  } catch (err) {
    console.warn(`[streams/record] insert failed user=${userId}: ${(err as Error).message}`);
    return NextResponse.json({ error: "couldn't record stream" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id, state: "active" });
}
