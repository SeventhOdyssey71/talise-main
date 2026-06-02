import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { requireAppAttestStructural } from "@/lib/app-attest";
import { rateLimitAsync } from "@/lib/rate-limit";
import {
  streamById,
  setStreamState,
  refundRemainder,
  streamEscrowEnabled,
} from "@/lib/streams";

export const runtime = "nodejs";

/**
 * POST /api/streams/[id]/cancel
 *
 * Sender-only, terminal. Marks the stream `cancelled` (stops all releases)
 * and refunds the UNDISTRIBUTED remainder from the escrow back to the sender
 * via a gasless escrow→sender USDsui transfer. Already-released tranches stay
 * with the recipient (can't be clawed back). Idempotent: cancelling an
 * already-cancelled stream no-ops.
 *
 * Order: flip state FIRST (so the scheduler can't release a tranche while the
 * refund is in flight), then refund. A failed refund leaves the row cancelled
 * with the remainder still in escrow — surfaced as `{ refunded:false }` so ops
 * can reconcile; funds are never lost (the escrow keypair can re-send).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await readEntryIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const attest = requireAppAttestStructural(req);
  if (attest) return attest;

  const rl = await rateLimitAsync({
    key: `streams-cancel:user:${userId}`,
    limit: 30,
    windowSec: 3600,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec ?? 3600) } }
    );
  }

  const { id } = await params;
  const row = await streamById(id);
  if (!row) {
    return NextResponse.json({ error: "stream not found" }, { status: 404 });
  }
  if (row.sender_user_id !== userId) {
    return NextResponse.json({ error: "only the sender can cancel" }, { status: 403 });
  }
  if (row.state === "cancelled") {
    return NextResponse.json({ ok: true, state: "cancelled", refunded: false });
  }

  // Stop the scheduler from racing a release against the refund.
  await setStreamState(id, "cancelled");

  const remainderMicros = BigInt(row.total_micros) - BigInt(row.released_micros);
  const refundUsd = Number(remainderMicros) / 1e6;

  if (!streamEscrowEnabled() || remainderMicros <= 0n) {
    return NextResponse.json({
      ok: true,
      state: "cancelled",
      refunded: remainderMicros <= 0n,
      refundUsd: Math.max(0, refundUsd),
    });
  }

  const res = await refundRemainder({
    senderAddress: row.sender_address,
    remainderMicros,
  });
  if (!res.ok) {
    console.warn(
      `[streams/cancel] refund failed stream=${id} remainder=${remainderMicros}: ${res.error}`
    );
  }
  return NextResponse.json({
    ok: true,
    state: "cancelled",
    refunded: res.ok,
    refundUsd: Math.max(0, refundUsd),
    refundDigest: res.digest ?? null,
  });
}
