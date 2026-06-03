import { NextResponse } from "next/server";
import { createHash } from "node:crypto";

import { db, ensureSchema } from "@/lib/db";
import {
  verifyPagaWebhookSignature,
  parsePagaWebhook,
} from "@/lib/paga";

export const runtime = "nodejs";

/**
 * POST /api/offramp/paga/webhook  —  Paga `statusCallbackUrl` receiver.
 *
 * Removes the poll-only dependency: when Paga's NIBSS settlement resolves it
 * POSTs here, and we advance the `paga_offramps` row event-driven. Per
 * docs/offramp/paga-integration.md the handler MUST:
 *   1. Read the raw body (sign before parsing).
 *   2. Recompute HMAC-SHA512 over the raw body and constant-time compare it to
 *      the inbound hash header.
 *   3. Log EVERY delivery into `offramp_webhook_events` (idempotent on a body
 *      hash so redeliveries are no-ops).
 *   4. Only act on a verified signature, and only transition FORWARD from
 *      `remitting` → `settled` / `failed` (terminal states are never regressed).
 *   5. Return 200 only after the DB write.
 *
 * Unauthenticated by session on purpose (Paga is the caller); the HMAC IS the
 * auth. An unverified body is logged for audit and rejected with 401 — never
 * acted on.
 */
export async function POST(req: Request) {
  const rawBody = await req.text();
  // Paga does not publish the callback signature header name; accept the
  // documented `hash` plus the common variants.
  const provided =
    req.headers.get("hash") ??
    req.headers.get("x-paga-signature") ??
    req.headers.get("signature");

  let signatureOk = false;
  try {
    signatureOk = verifyPagaWebhookSignature(rawBody, provided);
  } catch {
    // pagaConfig() throws if env is unset — treat as unverifiable.
    signatureOk = false;
  }

  let json: Record<string, unknown> = {};
  try {
    json = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
  } catch {
    // leave {} — parse() below yields a null reference and we 400 after logging.
  }
  const { reference, status } = parsePagaWebhook(json);

  await ensureSchema();
  const c = db();

  // Idempotent audit log. id = sha256(provider:rawBody) → an identical
  // redelivery collides and DOES NOTHING, so we never double-process.
  const eventId = createHash("sha256").update(`paga:${rawBody}`).digest("hex");
  const ins = await c.execute({
    sql: `INSERT INTO offramp_webhook_events
            (id, provider, reference, offramp_id, status_in, signature_ok, payload, received_at)
          VALUES (?, 'paga', ?, NULL, ?, ?, ?, ?)
          ON CONFLICT (id) DO NOTHING`,
    args: [
      eventId,
      reference,
      status,
      signatureOk ? 1 : 0,
      rawBody.slice(0, 10_000),
      Date.now(),
    ],
  });

  // Never act on an unverified callback — but we DID log it above for audit.
  if (!signatureOk) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  // Exact-duplicate redelivery → already processed; ack idempotently.
  if (ins.rowsAffected === 0) {
    return NextResponse.json({ ok: true, duplicate: true });
  }
  if (!reference) {
    return NextResponse.json({ error: "missing reference" }, { status: 400 });
  }

  // Our `referenceNumber` to Paga is the row id; the depositToBank ack's
  // transactionId is stored as paga_reference. Match either.
  const r = await c.execute({
    sql: `SELECT id, status FROM paga_offramps WHERE id = ? OR paga_reference = ? LIMIT 1`,
    args: [reference, reference],
  });
  const row = r.rows[0] as unknown as { id: string; status: string } | undefined;
  if (!row) {
    return NextResponse.json({ error: "payout not found" }, { status: 404 });
  }
  await c.execute({
    sql: `UPDATE offramp_webhook_events SET offramp_id = ? WHERE id = ?`,
    args: [row.id, eventId],
  });

  const now = Date.now();
  if (status === "settled") {
    // Forward-only: only a remitting payout settles (terminal states untouched).
    await c.execute({
      sql: `UPDATE paga_offramps SET status='settled', settled_at=?
            WHERE id = ? AND status='remitting'`,
      args: [now, row.id],
    });
  } else if (status === "failed") {
    await c.execute({
      sql: `UPDATE paga_offramps SET status='failed', status_reason=?, failed_at=?
            WHERE id = ? AND status='remitting'`,
      args: ["paga webhook: payout failed", now, row.id],
    });
    // A post-debit failure leaves the user's USDsui in the treasury → the
    // refund path (task #76) reclaims it back to user.sui_address.
  }

  return NextResponse.json({ ok: true, status });
}
