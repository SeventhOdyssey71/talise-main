import { NextResponse } from "next/server";
import { retryPendingOfframpRefunds } from "@/lib/offramp-refund";

export const runtime = "nodejs";

/**
 * GET /api/cron/offramp-refunds
 *
 * Self-healing retry for off-ramp refunds: returns USDsui to users whose Paga
 * payout failed after the on-chain debit but whose refund didn't complete
 * (transient chain error, or treasury key provisioned after the failure).
 * Bearer CRON_SECRET gated. No-ops cleanly when there's nothing pending.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  try {
    const { attempted, refunded } = await retryPendingOfframpRefunds();
    return NextResponse.json({ ok: true, attempted, refunded });
  } catch (e) {
    console.warn("[cron/offramp-refunds] retry failed:", (e as Error).message);
    return NextResponse.json({ ok: false, reason: (e as Error).message });
  }
}
