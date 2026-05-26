import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/fx — USD-base FX rates for the currencies Talise displays.
 *
 * Powered by open.er-api.com (free, no key, ECB + central-bank data,
 * single endpoint). Cached server-side for 1 hour so a single user
 * scrolling between Home / Earn / Send doesn't fan out RPC.
 *
 * Response: { base: "USD", asOf: <iso>, rates: { USD: 1, NGN: …, … } }
 *
 * Talise displays USDsui as $1 (1:1 USD peg). When a user picks NGN
 * in Profile preferences, iOS multiplies their USDsui balance by
 * rates.NGN to render "₦310" instead of "$0.20".
 */
const SUPPORTED = ["USD", "NGN", "GHS", "KES", "EUR", "GBP", "CAD", "ZAR"] as const;

let cache:
  | { ts: number; payload: { base: string; asOf: string; rates: Record<string, number> } }
  | null = null;
const TTL_MS = 60 * 60 * 1000;

export async function GET() {
  if (cache && Date.now() - cache.ts < TTL_MS) {
    return NextResponse.json(cache.payload);
  }
  try {
    const r = await fetch("https://open.er-api.com/v6/latest/USD", {
      // Cache header so Next.js's data cache also remembers this.
      next: { revalidate: 3600 },
      // Hard deadline so a hung upstream can't stall the route. ECB feed is
      // typically <500ms; 4s is comfortable headroom without holding a
      // serverless function open.
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) throw new Error(`upstream ${r.status}`);
    const data = await r.json();
    if (data.result !== "success") throw new Error("upstream rejected");
    const rates: Record<string, number> = {};
    for (const code of SUPPORTED) {
      const v = data.rates?.[code];
      if (typeof v === "number" && v > 0) rates[code] = v;
    }
    rates.USD = 1;
    const payload = {
      base: "USD",
      asOf: new Date((data.time_last_update_unix ?? Date.now() / 1000) * 1000).toISOString(),
      rates,
    };
    cache = { ts: Date.now(), payload };
    return NextResponse.json(payload);
  } catch (err) {
    // Soft-fail with USD-only so the UI never wedges on a missing
    // exchange rate. iOS picker falls back to "$" display.
    console.warn(`[api/fx] upstream fetch failed: ${(err as Error).message}`);
    return NextResponse.json({
      base: "USD",
      asOf: new Date().toISOString(),
      rates: { USD: 1 },
      error: "fx upstream unavailable",
    });
  }
}
