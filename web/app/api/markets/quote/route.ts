import { NextResponse } from "next/server";
import { WATERX_ENABLED } from "@/lib/waterx";
import { pythSymbolFor } from "@/lib/waterx-assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pythSymbol = (t: string) => pythSymbolFor(t);

/**
 * GET /api/markets/quote?symbol=SUIUSD — live spot + 24h change for the top of
 * the terminal, derived from Pyth Benchmarks hourly closes. (Pyth carries no
 * spot volume, so 24H volume is reported by the on-chain OI elsewhere.)
 */
export async function GET(req: Request) {
  if (!WATERX_ENABLED) return NextResponse.json({ error: "disabled" }, { status: 503 });
  const symbol = new URL(req.url).searchParams.get("symbol") ?? "BTCUSD";
  const to = Math.floor(Date.now() / 1000);
  const from = to - 3600 * 30; // 30h of hourly bars
  try {
    const r = await fetch(
      `https://benchmarks.pyth.network/v1/shims/tradingview/history?symbol=${encodeURIComponent(pythSymbol(symbol))}&resolution=60&from=${from}&to=${to}`,
      { cache: "no-store" },
    );
    if (!r.ok) return NextResponse.json({ unavailable: true });
    const j = (await r.json()) as { s: string; c?: number[] };
    const cl = j.c ?? [];
    if (j.s !== "ok" || cl.length === 0) return NextResponse.json({ unavailable: true });
    const spot = cl[cl.length - 1];
    const prev = cl[Math.max(0, cl.length - 25)] || spot; // ~24h ago
    const change24h = prev ? ((spot - prev) / prev) * 100 : 0;
    return NextResponse.json(
      { spot, change24h },
      { headers: { "Cache-Control": "public, max-age=3, stale-while-revalidate=10" } },
    );
  } catch {
    return NextResponse.json({ unavailable: true });
  }
}
