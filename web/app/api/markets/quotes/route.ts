import { NextResponse } from "next/server";
import { WATERX_ENABLED } from "@/lib/waterx";
import { pythSymbolFor, WATERX_TICKERS } from "@/lib/waterx-assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/markets/quotes — live spot for EVERY market in one call, from Pyth
 * Benchmarks. Feeds the market picker so its prices match the header (the
 * on-chain refPrice lags and reads 0 for a few markets). Fetched concurrently,
 * short-cached; missing symbols are simply omitted (client falls back).
 */
async function spotFor(symbol: string): Promise<number | null> {
  const to = Math.floor(Date.now() / 1000);
  const from = to - 3600 * 4; // a few hourly bars is plenty for last close
  try {
    const r = await fetch(
      `https://benchmarks.pyth.network/v1/shims/tradingview/history?symbol=${encodeURIComponent(pythSymbolFor(symbol))}&resolution=60&from=${from}&to=${to}`,
      { cache: "no-store", signal: AbortSignal.timeout(5000) },
    );
    if (!r.ok) return null;
    const j = (await r.json()) as { s: string; c?: number[] };
    const cl = j.c ?? [];
    if (j.s !== "ok" || cl.length === 0) return null;
    return cl[cl.length - 1];
  } catch {
    return null;
  }
}

export async function GET() {
  if (!WATERX_ENABLED) return NextResponse.json({ quotes: {} }, { status: 503 });
  const results = await Promise.all(
    WATERX_TICKERS.map(async (t) => [t, await spotFor(t)] as const),
  );
  const quotes: Record<string, number> = {};
  for (const [t, s] of results) if (s != null && s > 0) quotes[t] = s;
  return NextResponse.json(
    { quotes },
    { headers: { "Cache-Control": "public, max-age=8, stale-while-revalidate=30" } },
  );
}
