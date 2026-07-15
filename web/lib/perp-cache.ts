import { db } from "@/lib/db";
import { pythSymbolFor } from "@/lib/waterx-assets";

/**
 * Shared last-good cache for the perps price feeds (candles / quotes).
 *
 * Pyth Benchmarks rate-limits Vercel's egress IPs, so a per-request `no-store`
 * fetch fails intermittently — the chart blanks and the 24h change reads 0.
 * This wraps every Pyth read so that:
 *   1. a FRESH cached value (age < freshMs) is served without touching Pyth —
 *      collapsing all users onto one upstream call per key per window, which
 *      keeps us under the rate limit; and
 *   2. when Pyth does fail, the LAST-GOOD cached value is served (any age), so
 *      the client never sees empty data.
 *
 * Cache lives in Postgres `global_kv` (shared across serverless instances,
 * survives cold starts). Reads/writes are best-effort — a DB hiccup degrades to
 * a direct Pyth fetch, never a 500.
 */

type Cached<T> = { ts: number; data: T };

async function readCache<T>(key: string): Promise<Cached<T> | null> {
  try {
    const r = await db().execute({
      sql: "SELECT v_text, refreshed_at FROM global_kv WHERE k = ?",
      args: [key],
    });
    const row = r.rows[0] as { v_text?: string; refreshed_at?: number | string } | undefined;
    if (!row?.v_text) return null;
    return { ts: Number(row.refreshed_at) || 0, data: JSON.parse(row.v_text) as T };
  } catch {
    return null;
  }
}

async function writeCache<T>(key: string, data: T): Promise<void> {
  try {
    await db().execute({
      sql: `INSERT INTO global_kv (k, v_text, refreshed_at) VALUES (?, ?, ?)
            ON CONFLICT (k) DO UPDATE SET v_text = EXCLUDED.v_text, refreshed_at = EXCLUDED.refreshed_at`,
      args: [key, JSON.stringify(data), Date.now()],
    });
  } catch {
    /* best-effort */
  }
}

/**
 * Serve `key` from cache when fresh, else fetch; on fetch failure fall back to
 * the last-good cached value. `fetchFn` returns null to signal "no usable data"
 * (treated like a failure — keeps the prior good value instead of caching empty).
 */
export async function cachedFetch<T>(
  key: string,
  freshMs: number,
  fetchFn: () => Promise<T | null>,
): Promise<{ data: T | null; stale: boolean }> {
  const cached = await readCache<T>(key);
  if (cached && Date.now() - cached.ts < freshMs) {
    return { data: cached.data, stale: false };
  }
  try {
    const fresh = await fetchFn();
    if (fresh != null) {
      await writeCache(key, fresh);
      return { data: fresh, stale: false };
    }
  } catch {
    /* fall through to stale */
  }
  if (cached) return { data: cached.data, stale: true };
  return { data: null, stale: false };
}

/** Fetch Pyth Benchmarks TradingView history with a timeout + one retry. */
export async function fetchPythHistory(
  symbol: string,
  resolution: string,
  from: number,
  to: number,
): Promise<{ s: string; t?: number[]; o?: number[]; h?: number[]; l?: number[]; c?: number[] } | null> {
  const url = `https://benchmarks.pyth.network/v1/shims/tradingview/history?symbol=${encodeURIComponent(
    pythSymbolFor(symbol),
  )}&resolution=${resolution}&from=${from}&to=${to}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(6000) });
      if (!r.ok) continue;
      const j = (await r.json()) as { s: string; t?: number[]; c?: number[] };
      if (j.s === "ok" && j.t?.length) return j as never;
      return null; // valid response, genuinely no data
    } catch {
      /* retry once */
    }
  }
  throw new Error("pyth history failed");
}
