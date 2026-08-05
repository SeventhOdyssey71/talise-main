import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { pendingGrantFor } from "@/lib/rewards/grants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/rewards/grant → the signed-in user's unopened gift, or null.
 *
 * Scoped to the bearer, which is what makes this a per-beneficiary surface
 * rather than something every account sees. Claiming is a separate POST to
 * /api/rewards/grant/claim, so a read can never move money.
 */
export async function GET(req: Request) {
  const userId = await readEntryIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const grant = await pendingGrantFor(Number(userId));
  return NextResponse.json(
    {
      grant: grant
        ? { id: grant.id, amountUsd: grant.amountUsd, reason: grant.reason }
        : null,
    },
    { headers: { "cache-control": "no-store" } }
  );
}
