import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { runReindex } from "@/lib/analytics/reindex";

export const dynamic = "force-dynamic";

/**
 * POST /api/analytics/reindex — re-index every talise user's on-chain
 * activity into the analytics_* cache tables. Admin-gated: this triggers
 * a full re-scan over all users' financial data.
 *
 * Note: this can take a while (it fans out per-user on-chain queries over a
 * small concurrency pool). That latency is acceptable for an admin action.
 */
export async function POST(req: Request) {
  const denied = await requireAdminApi(req);
  if (denied) return denied;

  try {
    const result = await runReindex();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: "reindex failed", detail: String(err) },
      { status: 500 }
    );
  }
}
