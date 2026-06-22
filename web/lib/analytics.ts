import { db } from "@/lib/db";

/**
 * Public, aggregate-only analytics for talise.io/analytics.
 *
 * Every number here is read live from production Postgres and is intentionally
 * NON-personal: counts, sums, and currency-pair tallies only. No address,
 * handle, email, digest, or counterparty ever leaves this function. The page
 * is meant to be honest — small, real, on-mainnet numbers beat inflated ones,
 * so we report what actually settled rather than rounding up.
 *
 * Resilient by construction: each sub-query is time-bounded and falls back to
 * 0 / [] so a single slow/failed aggregate can never 500 the page.
 */

const SUBQUERY_TIMEOUT_MS = 12_000;

async function withTimeout<T>(p: Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), SUBQUERY_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function scalar(sql: string, args: ReadonlyArray<unknown> = []): Promise<number> {
  return withTimeout(
    (async () => {
      const r = await db().execute({ sql, args });
      const v = r.rows[0] ? Object.values(r.rows[0])[0] : 0;
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    })(),
    0
  );
}

export type DirectionStat = { direction: string; count: number; volumeUsd: number };
export type Corridor = { from: string; to: string; count: number };

export type PublicAnalytics = {
  settled: { volumeUsd: number; txCount: number; activeAccounts: number };
  byDirection: DirectionStat[];
  corridors: Corridor[];
  privacy: { notes: number; spent: number };
  product: { cheques: number; streams: number; goals: number };
  community: { accounts: number; waitlist: number };
  updatedAt: string;
};

export async function getPublicAnalytics(): Promise<PublicAnalytics> {
  const [
    // "Value moved" counts user-initiated flows only (sent, swap, withdraw,
    // invest). We deliberately exclude `received` because it is the mirror
    // side of `sent` and would double-count the same dollars.
    volumeUsd,
    txCount,
    activeAccounts,
    byDirectionRows,
    corridorRows,
    notes,
    spent,
    cheques,
    streams,
    goals,
    accounts,
    waitlist,
  ] = await Promise.all([
    scalar(
      `SELECT COALESCE(SUM(amount_usd),0) FROM analytics_recent_tx
       WHERE direction IN ('sent','swap','withdraw','invest')`
    ),
    scalar(`SELECT COUNT(*) FROM analytics_recent_tx`),
    scalar(`SELECT COUNT(DISTINCT address) FROM analytics_recent_tx`),
    withTimeout(
      (async () => {
        const r = await db().execute({
          sql: `SELECT direction, COUNT(*) n, COALESCE(SUM(amount_usd),0) vol
                FROM analytics_recent_tx GROUP BY direction ORDER BY vol DESC`,
        });
        return r.rows.map((row) => {
          const v = Object.values(row);
          return {
            direction: String(v[0] ?? "—"),
            count: Number(v[1] ?? 0),
            volumeUsd: Number(v[2] ?? 0),
          };
        });
      })(),
      [] as DirectionStat[]
    ),
    withTimeout(
      (async () => {
        const r = await db().execute({
          sql: `SELECT source_currency, dest_currency, COUNT(*) n
                FROM transfers GROUP BY source_currency, dest_currency
                ORDER BY n DESC`,
        });
        return r.rows
          .map((row) => {
            const v = Object.values(row);
            return { from: String(v[0] ?? ""), to: String(v[1] ?? ""), count: Number(v[2] ?? 0) };
          })
          .filter((c) => c.from && c.to);
      })(),
      [] as Corridor[]
    ),
    scalar(`SELECT COUNT(*) FROM shield_commitments`),
    scalar(`SELECT COUNT(*) FROM shield_nullifiers`),
    scalar(`SELECT COUNT(*) FROM cheques`),
    scalar(`SELECT COUNT(*) FROM streams`),
    scalar(`SELECT COUNT(*) FROM savings_goals`),
    scalar(`SELECT COUNT(*) FROM users`),
    scalar(`SELECT COUNT(*) FROM waitlist_signups`),
  ]);

  return {
    settled: { volumeUsd, txCount, activeAccounts },
    byDirection: byDirectionRows,
    corridors: corridorRows,
    privacy: { notes, spent },
    product: { cheques, streams, goals },
    community: { accounts, waitlist },
    updatedAt: new Date().toISOString(),
  };
}
