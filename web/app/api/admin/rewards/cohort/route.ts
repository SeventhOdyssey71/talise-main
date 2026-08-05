import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { getVolumeCohort, volumeCohortCsv } from "@/lib/rewards/volume-cohort";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/rewards/cohort
 *
 * Accounts whose lifetime settled volume clears a threshold, for a reward
 * distribution run.
 *
 *   ?min=10        threshold in USD (default 10)
 *   ?format=csv    download instead of JSON
 *
 * READ-ONLY on purpose. It reports who qualifies; it does not credit points or
 * move money. The mutating rewards operations live in /api/admin/rewards and
 * carry their own confirm-and-audit gating, which this must not bypass by
 * quietly becoming a payout button.
 */

/** Guard rail: a threshold of 0 would return every address that ever transacted. */
const MIN_ALLOWED = 0.01;
const MAX_ALLOWED = 1_000_000;

export async function GET(req: Request) {
  const denied = await requireAdminApi(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const raw = url.searchParams.get("min");
  const parsed = raw == null || raw === "" ? 10 : Number(raw);
  if (!Number.isFinite(parsed) || parsed < MIN_ALLOWED || parsed > MAX_ALLOWED) {
    return NextResponse.json(
      { error: `min must be a number between ${MIN_ALLOWED} and ${MAX_ALLOWED}` },
      { status: 400 }
    );
  }

  try {
    const cohort = await getVolumeCohort(parsed);

    if (url.searchParams.get("format") === "csv") {
      const stamp = new Date().toISOString().slice(0, 10);
      return new Response(volumeCohortCsv(cohort), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="talise-reward-cohort-min${parsed}-${stamp}.csv"`,
          // A payout list must never be served from a shared cache.
          "cache-control": "no-store",
        },
      });
    }

    return NextResponse.json(cohort, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    // Surface the reason: an operator staring at an empty payout list needs to
    // know whether nobody qualified or the query failed.
    return NextResponse.json(
      { error: `cohort query failed: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
