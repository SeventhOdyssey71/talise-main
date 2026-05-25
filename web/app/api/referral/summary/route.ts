import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { getRewardsSummary, userById } from "@/lib/db";
import { getRewardsExtras, POINT_RATES } from "@/lib/rewards/earn";
import { getRoundupConfig } from "@/lib/rewards/roundup";

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
    const [summary, extras, roundup] = await Promise.all([
      getRewardsSummary(userId),
      getRewardsExtras(userId),
      getRoundupConfig(userId),
    ]);
    return NextResponse.json({
      code: summary.code,
      pointsTotal: summary.pointsTotal,
      referralCount: summary.referralCount,
      // Tier (Bronze/Silver/Gold/Platinum) computed from pointsTotal.
      // Includes `pointsToNext` so the iOS card can render a progress
      // ring + "850 to Gold" hint without recomputing the thresholds.
      tier: {
        id: extras.tier.id,
        label: extras.tier.label,
        pointsToNext: extras.tier.pointsToNext,
        nextLabel: extras.tier.nextLabel,
      },
      // Lifetime tallies — used by the Rewards card stats row.
      // Lifetime, not monthly, because lifetime is what we can compute
      // cheaply from a single users-row read; monthly would need a
      // GROUP-BY on rewards_events.
      lifetimeSentUsd: extras.lifetimeSentUsd,
      lifetimeSavedUsd: extras.lifetimeSavedUsd,
      // Round-up config — drives the toggle + % slider on iOS.
      roundup: {
        enabled: roundup.enabled,
        percentage: roundup.percentage,
      },
      // Lifetime amount auto-swept via round-up. Rendered next to the
      // toggle on the iOS RoundupCard so users see their drip savings
      // accumulate. Separate from `lifetimeSavedUsd` (which includes
      // explicit invests + goal deposits too).
      roundupSavedUsd: roundup.savedUsd,
      // Point-earning rates so iOS can render "1 pt / $1 sent, 3 pts / $1 saved"
      // without hardcoding the values in two places.
      pointRates: POINT_RATES,
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
