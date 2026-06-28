import { NextResponse } from "next/server";
import { moneyRulesEnabled, evaluateDueRules } from "@/lib/money-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Programmable-money rules engine. Runs on a Vercel cron; evaluates every due
 * active rule and fires its action (for launch: a gasless escrow `send`).
 * Idempotent: each rule is claimed atomically (next_due_at advanced via a
 * guarded UPDATE) before payout, so a double-fire can't double-pay.
 *
 * Auth: Vercel injects `Authorization: Bearer $CRON_SECRET` on scheduled runs.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  if (!moneyRulesEnabled()) {
    return NextResponse.json({ ok: true, skipped: "money rules disabled" });
  }

  try {
    const summary = await evaluateDueRules();
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.warn(`[cron/process-money-rules] failed: ${(err as Error).message}`);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
