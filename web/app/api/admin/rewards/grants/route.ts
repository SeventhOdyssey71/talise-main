import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { issueGrant } from "@/lib/rewards/grants";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/rewards/grants
 *
 * Issue unclaimed gifts to a set of users. Each beneficiary sees a gift box on
 * their next app open and the money moves only when they tap claim.
 *
 * Body: { reason: string, batchKey: string, grants: [{ userId, amountUsd }] }
 *
 * NO MONEY MOVES HERE. `batchKey` is the idempotency key: re-running the same
 * distribution cannot gift anyone twice, because (user_id, batch_key) is
 * unique. Rows are processed independently so one bad entry cannot void a whole
 * batch of correct ones.
 */

const MAX_BATCH = 500;

type GrantInput = { userId?: unknown; amountUsd?: unknown };

export async function POST(req: Request) {
  const denied = await requireAdminApi(req);
  if (denied) return denied;

  let body: { reason?: unknown; grants?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  // The reason is shown to the user in the sheet, so it has to be a real
  // sentence rather than a ticket number.
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 8) {
    return NextResponse.json(
      { error: "reason must be at least 8 characters, it is shown to the user" },
      { status: 400 }
    );
  }

  // Names the distribution, e.g. "aug-2026-volume". Makes the run replayable.
  const batchKey = typeof (body as { batchKey?: unknown }).batchKey === "string"
    ? (body as { batchKey: string }).batchKey.trim()
    : "";
  if (!batchKey) {
    return NextResponse.json(
      { error: "batchKey required, it is what makes a re-run safe" },
      { status: 400 }
    );
  }

  const list = Array.isArray(body.grants) ? (body.grants as GrantInput[]) : null;
  if (!list || list.length === 0) {
    return NextResponse.json({ error: "grants must be a non-empty array" }, { status: 400 });
  }
  if (list.length > MAX_BATCH) {
    return NextResponse.json({ error: `at most ${MAX_BATCH} grants per call` }, { status: 400 });
  }

  const results: Array<{ userId: number; ok: boolean; error?: string }> = [];
  for (const g of list) {
    const userId = Number(g.userId);
    const amountUsd = Number(g.amountUsd);
    try {
      if (!Number.isInteger(userId) || userId <= 0) throw new Error("invalid userId");
      if (!Number.isFinite(amountUsd) || amountUsd <= 0) throw new Error("invalid amountUsd");
      await issueGrant({ id: randomUUID(), userId, amountUsd, reason, batchKey });
      results.push({ userId, ok: true });
    } catch (e) {
      results.push({ userId, ok: false, error: (e as Error).message });
    }
  }

  const issued = results.filter((r) => r.ok).length;
  return NextResponse.json({ issued, failed: results.length - issued, batchKey, results });
}
