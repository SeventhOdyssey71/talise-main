import { NextResponse } from "next/server";

import { db, ensureSchema, userById } from "@/lib/db";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { requireAppAttestStructural } from "@/lib/app-attest";
import { transactionStatus } from "@/lib/paga";

export const runtime = "nodejs";

/**
 * GET /api/offramp/paga/status/[id]
 *
 * Fetch the current state of a Paga offramp row. If the row is in
 * `remitting`, we hit Paga's `transactionStatus` to see whether NIBSS has
 * settled the wire — promoting to `settled` on success or `failed` on
 * reject. Returns only the public-safe fields (no bank account number,
 * no FX internals beyond what the user already saw at quote time).
 */

interface OfframpRow {
  id: string;
  user_id: string;
  usdsui_amount: string | number;
  ngn_amount: string | number;
  fx_rate: string | number;
  bank_code: string;
  bank_account_number: string;
  bank_account_name: string | null;
  paga_reference: string | null;
  status: string;
  status_reason: string | null;
  created_at: number;
  debited_at: number | null;
  settled_at: number | null;
  failed_at: number | null;
}

function mask(acct: string): string {
  if (!acct || acct.length <= 4) return "****";
  return `****${acct.slice(-4)}`;
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
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

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  await ensureSchema();
  const c = db();
  const r = await c.execute({
    sql: "SELECT * FROM paga_offramps WHERE id = ? LIMIT 1",
    args: [id],
  });
  let row = r.rows[0] as unknown as OfframpRow | undefined;
  if (!row) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (row.user_id !== String(userId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Promote remitting → settled / failed via Paga if we have a reference.
  if (row.status === "remitting" && row.paga_reference) {
    try {
      const s = await transactionStatus(row.paga_reference);
      if (s.status === "settled") {
        const now = Date.now();
        await c.execute({
          sql: `UPDATE paga_offramps SET status='settled', settled_at=?
                WHERE id = ? AND status='remitting'`,
          args: [now, row.id],
        });
        row = { ...row, status: "settled", settled_at: now };
      } else if (s.status === "failed") {
        const now = Date.now();
        await c.execute({
          sql: `UPDATE paga_offramps SET status='failed', status_reason=?, failed_at=?
                WHERE id = ? AND status='remitting'`,
          args: [`paga: ${s.message}`.slice(0, 500), now, row.id],
        });
        row = { ...row, status: "failed", failed_at: now, status_reason: `paga: ${s.message}` };
      }
    } catch (e) {
      // Status poll failures are non-fatal — we'll just return the
      // current row and let the next poll retry.
      console.warn(
        "[offramp/paga/status] transactionStatus poll failed:",
        (e as Error).message
      );
    }
  }

  return NextResponse.json({
    id: row.id,
    status: row.status,
    statusReason: row.status_reason,
    usdsuiAmount: Number(row.usdsui_amount),
    ngnAmount: Number(row.ngn_amount),
    fxRate: Number(row.fx_rate),
    bankAccountMasked: mask(row.bank_account_number),
    bankAccountName: row.bank_account_name,
    pagaReference: row.paga_reference,
    createdAt: row.created_at,
    debitedAt: row.debited_at,
    settledAt: row.settled_at,
    failedAt: row.failed_at,
  });
}
