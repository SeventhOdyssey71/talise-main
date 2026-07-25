import { NextResponse } from "next/server";
import { requireCron } from "@/lib/cron-auth";
import { drainRoundupSaves, LOG } from "@/lib/rewards/roundup-save";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/process-roundup-queue
 *
 * Spend + Save RECONCILIATION. Every round-up is a real transaction signed
 * by the user's in-session ephemeral key, so the server can never
 * re-broadcast one. What it can do is close the loop on saves whose outcome
 * we never got to see:
 *
 *   • signed + broadcast, response lost (Onara timeout, app killed, lambda
 *     frozen). The row already carries the digest the signed bytes have, so
 *     this pass finds the transaction on chain and credits the tally then.
 *     This is the case the old stub could never handle: `roundup_queue` rows
 *     held an amount and no digest, so there was nothing to look up.
 *   • never broadcast, or aborted. The row is written off as `abandoned` /
 *     `failed` and every tally stays exactly where it was.
 *
 * A pass is safe to run redundantly: crediting is gated on the
 * `prepared → settled` UPDATE, so a drain racing a client confirm can at
 * worst read the same digest twice, never credit twice.
 *
 * Auth: Vercel injects `Authorization: Bearer $CRON_SECRET`.
 * Register in `vercel.json` at `* * * * *` (every minute) so a lost
 * confirmation costs the user a minute of lag, not their savings.
 *
 * The legacy `roundup_queue` table is no longer written by anything (the
 * gasless legs stopped enqueueing when the save became its own transaction)
 * and is not read here. It remains only so /admin's raw browser can show
 * historical rows.
 */
export async function GET(req: Request) {
  const denied = requireCron(req);
  if (denied) return denied;

  try {
    const summary = await drainRoundupSaves(25);
    if (
      summary.settled > 0 ||
      summary.failed > 0 ||
      summary.abandonedIntents > 0
    ) {
      console.log(
        `${LOG} drain scanned=${summary.scanned} settled=${summary.settled} ` +
          `credited=${summary.creditedUsd.toFixed(6)} failed=${summary.failed} ` +
          `pending=${summary.stillPending} abandonedIntents=${summary.abandonedIntents}`
      );
    }
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    const msg = (err as Error).message ?? "drain failed";
    console.error(`${LOG} drain failed: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
