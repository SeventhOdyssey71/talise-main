import { NextResponse } from "next/server";

import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { rateLimitAsync } from "@/lib/rate-limit";
import { deleteBankAccount, getBankAccountById } from "@/lib/bank-accounts";

export const runtime = "nodejs";

/**
 * DELETE /api/me/beneficiaries/[id]
 *
 * Remove a saved cash-out beneficiary. Scoped to the caller: an id that isn't
 * theirs 404s without revealing whether it exists.
 *
 * Refuses to delete a `self` row. Those are the user's own linked accounts,
 * they carry a consent attestation, and one of them may be the primary target
 * for inbound "pay to their bank" payments — removing it from a beneficiary
 * picker would silently break how other people pay this user. Unlinking an own
 * account stays where it belongs, under /api/me/bank/[id].
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await readEntryIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const rl = await rateLimitAsync({
    key: `beneficiary-delete:user:${userId}`,
    limit: 30,
    windowSec: 60,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec ?? 60) } }
    );
  }

  const { id } = await params;
  try {
    const row = await getBankAccountById(userId, id);
    if (!row) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    if ((row.kind ?? "self") !== "beneficiary") {
      return NextResponse.json(
        {
          error:
            "That's one of your own linked accounts. Remove it from your bank settings.",
          code: "NOT_A_BENEFICIARY",
        },
        { status: 409 }
      );
    }
    const ok = await deleteBankAccount(userId, id);
    if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.warn(`[beneficiaries DELETE] user=${userId}: ${(e as Error).message}`);
    return NextResponse.json({ error: "delete failed" }, { status: 500 });
  }
}
