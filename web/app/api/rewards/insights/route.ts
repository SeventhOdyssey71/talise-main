import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { userById } from "@/lib/db";
import { getMonthInsights } from "@/lib/rewards/insights";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/rewards/insights — month-to-date spending/saving summary for
 * the authenticated user, derived from getRecentActivity(). Used by the
 * iOS Rewards tab's Insights section.
 *
 * Response shape mirrors `MonthInsights` Codable in APIModels.swift.
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
    const insights = await getMonthInsights(user.sui_address, 50);
    return NextResponse.json({
      spentUsd: insights.spentUsd,
      receivedUsd: insights.receivedUsd,
      savedUsd: insights.savedUsd,
      monthStartMs: insights.monthStartMs,
      sampleSize: insights.sampleSize,
      topCounterparties: insights.topCounterparties.map((c) => ({
        address: c.address,
        name: c.name,
        count: c.count,
        totalUsd: c.totalUsd,
      })),
    });
  } catch (err) {
    console.warn(
      `[rewards/insights] user=${userId} failed: ${(err as Error).message}`
    );
    return NextResponse.json(
      { error: "could not load insights" },
      { status: 500 }
    );
  }
}
