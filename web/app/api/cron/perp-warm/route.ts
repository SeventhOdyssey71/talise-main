import { NextResponse } from "next/server";
import { requireCron } from "@/lib/cron-auth";
import { WATERX_ENABLED } from "@/lib/waterx";
import { WATERX_TICKERS } from "@/lib/waterx-assets";
import { refreshCandleCache, refreshQuoteCache, WARM_INTERVALS } from "@/lib/perp-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * GET /api/cron/perp-warm — keeps the perps price-feed cache warm.
 *
 * Pyth Benchmarks rate-limits Vercel's egress, so on-demand fetches fail
 * intermittently. This cron is the ONLY thing that talks to Pyth: it walks
 * every market × interval sequentially (throttled to avoid bursts) and writes
 * each result to the shared cache. Users always read the cache, so the chart /
 * price / change never blank. Whatever a run can't refresh keeps its last-good
 * value, so coverage only ever grows.
 */
export async function GET(req: Request) {
  const denied = requireCron(req);
  if (denied) return denied;
  if (!WATERX_ENABLED) return NextResponse.json({ ok: false, reason: "disabled" });
  let candlesOk = 0, candlesFail = 0, quotesOk = 0;

  for (const ticker of WATERX_TICKERS) {
    if (await refreshQuoteCache(ticker)) quotesOk++;
    await sleep(80);
    for (const iv of WARM_INTERVALS) {
      if (await refreshCandleCache(ticker, iv)) candlesOk++;
      else candlesFail++;
      await sleep(80);
    }
  }

  return NextResponse.json({ ok: true, quotesOk, candlesOk, candlesFail });
}
