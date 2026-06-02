import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { rateLimitAsync } from "@/lib/rate-limit";
import {
  streamById,
  setStreamState,
  refundRemainder,
  streamEscrowEnabled,
  streamOnchainEnabled,
  isOnchainStreamId,
} from "@/lib/streams";
import {
  workContractById,
  setContractStatus,
  projectContract,
} from "@/lib/work-contracts";

export const runtime = "nodejs";

/**
 * GET  /api/contracts/[id] — the caller's single contract + live stream state.
 *
 * POST /api/contracts/[id] { action: 'cancel' }
 *   Owner-only, terminal. Cancels the underlying stream (stops all future
 *   tranche releases) and flips the contract to `cancelled`. Already-paid
 *   periods stay with the payee.
 *
 *   • ESCROW stream (the default deployment): the server itself stops the
 *     scheduler and refunds the undistributed remainder back to the issuer via
 *     a gasless escrow→sender transfer — mirrors POST /api/streams/[id]/cancel.
 *   • ON-CHAIN stream: cancel_and_withdraw must be SENDER-signed, so the server
 *     stops the scheduler + flips status here, and returns
 *     `{ onchainCancelPath }` pointing the client at the stream cancel endpoint
 *     to sign the withdrawal. Funds are safe in the on-chain Stream object
 *     either way.
 */

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await readEntryIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const { id } = await params;
  const row = await workContractById(id);
  if (!row) {
    return NextResponse.json({ error: "contract not found" }, { status: 404 });
  }
  if (row.user_id !== userId) {
    return NextResponse.json({ error: "not your contract" }, { status: 403 });
  }
  const contract = await projectContract(row);
  return NextResponse.json({ contract });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await readEntryIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const rl = await rateLimitAsync({
    key: `contracts-mutate:user:${userId}`,
    limit: 60,
    windowSec: 3600,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec ?? 3600) } }
    );
  }

  const { id } = await params;
  const row = await workContractById(id);
  if (!row) {
    return NextResponse.json({ error: "contract not found" }, { status: 404 });
  }
  if (row.user_id !== userId) {
    return NextResponse.json({ error: "not your contract" }, { status: 403 });
  }

  let body: { action?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  if (body.action !== "cancel") {
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }

  if (row.status === "cancelled") {
    return NextResponse.json({ ok: true, status: "cancelled", refunded: false });
  }

  const stream = await streamById(row.stream_id);

  // No underlying stream row (rare) — just close the contract.
  if (!stream) {
    await setContractStatus(id, "cancelled");
    return NextResponse.json({ ok: true, status: "cancelled", refunded: false });
  }

  // Defensive: the contract's stream must still belong to the caller.
  if (stream.sender_user_id !== userId) {
    return NextResponse.json(
      { error: "only the issuer can cancel this contract" },
      { status: 403 }
    );
  }

  // Stop the scheduler from racing a release against the refund.
  if (stream.state !== "cancelled" && stream.state !== "completed") {
    await setStreamState(row.stream_id, "cancelled");
  }
  await setContractStatus(id, "cancelled");

  const remainderMicros =
    BigInt(stream.total_micros) - BigInt(stream.released_micros);
  const refundUsd = Math.max(0, Number(remainderMicros) / 1e6);

  // ── ON-CHAIN stream: the withdrawal needs the sender's signature. ───────
  if (streamOnchainEnabled() && isOnchainStreamId(row.stream_id)) {
    return NextResponse.json({
      ok: true,
      status: "cancelled",
      refundUsd,
      // The client signs the withdrawal via the stream cancel endpoint.
      onchainCancelPath: `/api/streams/${row.stream_id}/cancel`,
    });
  }

  // ── ESCROW stream: refund the remainder server-side. ────────────────────
  if (!streamEscrowEnabled() || remainderMicros <= 0n) {
    return NextResponse.json({
      ok: true,
      status: "cancelled",
      refunded: remainderMicros <= 0n,
      refundUsd,
    });
  }

  const res = await refundRemainder({
    senderAddress: stream.sender_address,
    remainderMicros,
  });
  if (!res.ok) {
    console.warn(
      `[contracts/cancel] refund failed contract=${id} stream=${row.stream_id} remainder=${remainderMicros}: ${res.error}`
    );
  }
  return NextResponse.json({
    ok: true,
    status: "cancelled",
    refunded: res.ok,
    refundUsd,
    refundDigest: res.digest ?? null,
  });
}
