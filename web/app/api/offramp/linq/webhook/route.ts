import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

import { ensureSchema } from "@/lib/db";
import { verifyLinqWebhook, parseLinqWebhook } from "@/lib/linq";
import { applyLinqStatus, phaseOf } from "@/lib/offramp/status";
import { recordProviderEvent } from "@/lib/offramp/store";

export const runtime = "nodejs";

/**
 * POST /api/offramp/linq/webhook
 *
 * Linq order-state callback. The raw body is HMAC-SHA256 signed in the
 * `X-Linq-Signature: sha256=<hex>` header (keyed by LINQ_WEBHOOK_SECRET). We
 * verify it BEFORE parsing, then mirror the order state into `linq_offramps`.
 *
 * TWO FIXES HERE
 * --------------
 * 1. MONOTONIC WRITES. The previous handler ran an unconditional
 *    `UPDATE linq_offramps SET status = ?`, so a replayed or out-of-order
 *    `order.processing` event could overwrite a `disbursed` order and walk a
 *    SETTLED payout back to "in progress". The app would then show a completed
 *    cash-out as pending and reconciliation could re-act on it. Terminal states
 *    are now sticky (see lib/offramp/status.ts).
 *
 * 2. REPLAY PROTECTION. Linq sends no event id, so we derive one from the
 *    signed body's digest and record it. A byte-identical redelivery is now a
 *    recognised no-op rather than a second state application.
 *
 * Always 2xx within 10s so Linq marks delivery successful; polling /status and
 * `POST /api/offramp/reconcile` are the reconciliation fallbacks for any missed
 * event.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const sig = req.headers.get("x-linq-signature");

  // Signature check FIRST, over the raw bytes, and fail closed: with no
  // LINQ_WEBHOOK_SECRET configured `verifyLinqWebhook` returns false, so an
  // unconfigured deploy cannot be driven by unsigned callbacks.
  if (!verifyLinqWebhook(raw, sig)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let json: Record<string, unknown>;
  try {
    json = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const evt = parseLinqWebhook(json);
  if (!evt.orderId) {
    // Nothing actionable, but acknowledge so Linq doesn't retry forever.
    return NextResponse.json({ ok: true, ignored: "no orderId" });
  }

  // Status text, prefer the event-implied phase when no explicit status.
  const statusText =
    evt.status ??
    (evt.event === "order.completed"
      ? "disbursed"
      : evt.event === "order.failed"
        ? "failed"
        : "processing");

  // Derive a stable event id: Linq doesn't supply one, and the body is already
  // authenticated by the HMAC, so its digest is a sound dedupe key.
  const eventId = createHash("sha256").update(raw).digest("hex").slice(0, 40);

  try {
    await ensureSchema();
    const fresh = await recordProviderEvent({
      provider: "linq",
      eventId,
      eventType: evt.event,
      objectId: evt.orderId,
      objectStatus: statusText,
      payload: raw,
    });
    if (!fresh) {
      console.log(`[offramp/linq/webhook] duplicate event order=${evt.orderId}, ignored`);
      return NextResponse.json({ ok: true, duplicate: true });
    }

    const write = await applyLinqStatus({
      linqOrderId: evt.orderId,
      status: statusText,
      source: "webhook",
      reason: evt.event,
    });
    console.log(
      `[offramp/linq/webhook] order=${evt.orderId} event=${evt.event} ` +
        `phase=${phaseOf(statusText)} applied=${write.applied}${write.reason ? ` (${write.reason})` : ""}`
    );
  } catch (e) {
    // Don't fail the webhook on a DB hiccup: Linq would retry, and the
    // reconciler picks up anything we miss.
    console.warn("[offramp/linq/webhook] update failed:", (e as Error).message);
  }

  return NextResponse.json({ ok: true });
}
