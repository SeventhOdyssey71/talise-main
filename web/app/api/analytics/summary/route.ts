import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { ensureAnalyticsSchema, getSummary } from "@/lib/analytics/store";

export const dynamic = "force-dynamic";

/**
 * GET /api/analytics/summary — assembled AnalyticsSummary from the cached
 * analytics_* tables. Admin-gated: this exposes ALL users' financial data.
 */
export async function GET(req: Request) {
  const denied = await requireAdminApi(req);
  if (denied) return denied;

  try {
    await ensureAnalyticsSchema();
    const summary = await getSummary();
    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json(
      { error: "failed to load analytics summary", detail: String(err) },
      { status: 500 }
    );
  }
}
