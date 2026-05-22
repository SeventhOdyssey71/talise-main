import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { getRewardsSummary, userById } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Mobile-friendly rewards snapshot. Same source of truth as the web /rewards
 * page (lib/db.ts → getRewardsSummary) — only difference is the response
 * envelope shape, mapped to the iOS RewardsSummary Codable.
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
    const summary = await getRewardsSummary(userId);
    return NextResponse.json({
      code: summary.code,
      pointsTotal: summary.pointsTotal,
      referralCount: summary.referralCount,
      recentEvents: summary.recentEvents.map((e) => ({
        id: String(e.id),
        kind: e.kind,
        points: e.points,
        createdAt: new Date(e.created_at).toISOString(),
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
