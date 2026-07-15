import { NextResponse } from "next/server";
import { WATERX_ENABLED } from "@/lib/waterx";
import { pythSymbolFor } from "@/lib/waterx-assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Talise ticker → Pyth benchmark symbol (crypto / equity / FX / commodity).
const pythSymbol = (t: string) => pythSymbolFor(t);
const RES: Record<string, string> = { "1m": "1", "5m": "5", "15m": "15", "1h": "60", "4h": "240", "1d": "D" };
const SECS: Record<string, number> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400 };

/**
 * GET /api/markets/candles?symbol=SUIUSD&interval=15m — OHLC candles for the
 * chart, proxied from Pyth Benchmarks (TradingView shim). Server-side so the
 * browser CSP stays clean; Pyth is the same price source WaterX settles on.
 */
export async function GET(req: Request) {
  if (!WATERX_ENABLED) return NextResponse.json({ error: "disabled" }, { status: 503 });
  const url = new URL(req.url);
  const symbol = url.searchParams.get("symbol") ?? "BTCUSD";
  const interval = url.searchParams.get("interval") ?? "15m";
  const res = RES[interval];
  if (!res) return NextResponse.json({ error: "bad interval" }, { status: 400 });

  const to = Math.floor(Date.now() / 1000);
  // Pyth caps a single request at 1 year of history, so cap the lookback to
  // ~360 days. This keeps 1d (was 400 days → "range exceeds 1 year") working
  // while leaving shorter intervals (≤4h) untouched.
  const YEAR = 360 * 86400;
  const from = to - Math.min((SECS[interval] ?? 900) * 400, YEAR);
  try {
    const r = await fetch(
      `https://benchmarks.pyth.network/v1/shims/tradingview/history?symbol=${encodeURIComponent(pythSymbol(symbol))}&resolution=${res}&from=${from}&to=${to}`,
      { cache: "no-store", signal: AbortSignal.timeout(8000) },
    );
    if (!r.ok) return NextResponse.json({ candles: [], unavailable: true });
    const j = (await r.json()) as { s: string; t?: number[]; o?: number[]; h?: number[]; l?: number[]; c?: number[] };
    if (j.s !== "ok" || !j.t?.length) return NextResponse.json({ candles: [], unavailable: true });
    const candles = j.t.map((time, i) => ({ time, open: j.o![i], high: j.h![i], low: j.l![i], close: j.c![i] }));
    return NextResponse.json(
      { candles },
      { headers: { "Cache-Control": "public, max-age=5, stale-while-revalidate=20" } },
    );
  } catch {
    return NextResponse.json({ candles: [], unavailable: true });
  }
}
