import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { userById } from "@/lib/db";
import { getYieldComparison } from "@/lib/yield";

export const runtime = "nodejs";

/**
 * NAVI + DeepBook margin APY comparison for the authed user. The web
 * /earn page reads the same helper server-side; this endpoint just
 * exposes it for the mobile client.
 *
 * Response shape matches the iOS YieldComparison Codable
 * (venues[].venue, apy, supplied, pendingRewards, best).
 */
export async function GET(req: Request) {
  const userId = await readEntryIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const user = await userById(userId);
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }
  try {
    const cmp = await getYieldComparison(user.sui_address);
    const venues = cmp.venues.map((v) => ({
      venue: v.id,
      apy: v.apy,
      supplied: v.supplied ?? 0,
      pendingRewards:
        (v.meta as { pendingUsd?: number } | undefined)?.pendingUsd ?? 0,
    }));
    const best = cmp.best
      ? {
          venue: cmp.best.id,
          apy: cmp.best.apy,
          supplied: cmp.best.supplied ?? 0,
          pendingRewards: 0,
        }
      : null;
    return NextResponse.json({ venues, best });
  } catch (err) {
    // Earn shouldn't 500 the UI just because a venue's RPC is flaky —
    // surface an empty comparison and let the client render "Unavailable".
    console.warn(`[yield/comparison] failed: ${(err as Error).message}`);
    return NextResponse.json({ venues: [], best: null });
  }
}
