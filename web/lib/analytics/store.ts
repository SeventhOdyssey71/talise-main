/**
 * Analytics cache store (Agent: STORE).
 *
 * Owns the two Postgres cache tables that back the internal analytics dashboard
 * (/dashboard-analytics) and assembles the AnalyticsSummary entirely from them.
 *
 * DB access follows the codebase convention: `db().execute({ sql, args })` with
 * `?` placeholders (the libSQL-shaped adapter rewrites them to $1/$2). Results
 * come back as `r.rows` (array of plain objects). DDL is Postgres + idempotent.
 *
 * Tables:
 *   analytics_user_stats(user_id INTEGER PRIMARY KEY, handle TEXT, address TEXT NOT NULL,
 *     tx_count INTEGER NOT NULL DEFAULT 0, volume_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
 *     swap_count INTEGER NOT NULL DEFAULT 0, last_active_at BIGINT, joined_at BIGINT NOT NULL,
 *     indexed_at BIGINT NOT NULL)
 *   analytics_daily(day TEXT PRIMARY KEY, volume_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
 *     tx_count INTEGER NOT NULL DEFAULT 0)
 */

import { db } from "@/lib/db";
import type { AnalyticsSummary, DailyPoint, UserStat } from "@/lib/analytics/types";

/** Coerce an unknown DB value to a finite number, defaulting to 0. */
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Coerce an unknown DB value to a finite number, or null when absent. */
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Create the analytics cache tables if they don't exist. Idempotent; safe to
 * call before every read/write.
 */
export async function ensureAnalyticsSchema(): Promise<void> {
  await db().execute({
    sql: `CREATE TABLE IF NOT EXISTS analytics_user_stats (
      user_id INTEGER PRIMARY KEY,
      handle TEXT,
      address TEXT NOT NULL,
      tx_count INTEGER NOT NULL DEFAULT 0,
      volume_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
      swap_count INTEGER NOT NULL DEFAULT 0,
      last_active_at BIGINT,
      joined_at BIGINT NOT NULL,
      indexed_at BIGINT NOT NULL
    )`,
    args: [],
  });
  await db().execute({
    sql: `CREATE TABLE IF NOT EXISTS analytics_daily (
      day TEXT PRIMARY KEY,
      volume_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
      tx_count INTEGER NOT NULL DEFAULT 0
    )`,
    args: [],
  });
}

/**
 * Insert or update a single user's cached stats. Keyed on user_id.
 */
export async function upsertUserStat(s: UserStat): Promise<void> {
  await db().execute({
    sql: `INSERT INTO analytics_user_stats
        (user_id, handle, address, tx_count, volume_usd, swap_count,
         last_active_at, joined_at, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id) DO UPDATE SET
        handle = EXCLUDED.handle,
        address = EXCLUDED.address,
        tx_count = EXCLUDED.tx_count,
        volume_usd = EXCLUDED.volume_usd,
        swap_count = EXCLUDED.swap_count,
        last_active_at = EXCLUDED.last_active_at,
        joined_at = EXCLUDED.joined_at,
        indexed_at = EXCLUDED.indexed_at`,
    args: [
      s.userId,
      s.handle,
      s.address,
      s.txCount,
      s.volumeUsd,
      s.swapCount,
      s.lastActiveAt,
      s.joinedAt,
      s.indexedAt,
    ],
  });
}

/**
 * Full replace of the analytics_daily table with the provided points. We clear
 * the table and re-insert so stale days never linger. Empty input simply leaves
 * the table empty.
 */
export async function replaceDaily(points: DailyPoint[]): Promise<void> {
  await db().execute({ sql: `DELETE FROM analytics_daily`, args: [] });
  for (const p of points) {
    await db().execute({
      sql: `INSERT INTO analytics_daily (day, volume_usd, tx_count)
        VALUES (?, ?, ?)
        ON CONFLICT (day) DO UPDATE SET
          volume_usd = EXCLUDED.volume_usd,
          tx_count = EXCLUDED.tx_count`,
      args: [p.date, p.volumeUsd, p.txCount],
    });
  }
}

/**
 * Assemble the full AnalyticsSummary from the cache tables. Resilient: a failed
 * sub-query yields its zero/empty fallback rather than throwing, so the
 * dashboard always renders.
 */
export async function getSummary(): Promise<AnalyticsSummary> {
  // Totals: SUM/COUNT over analytics_user_stats.
  const totals = await db()
    .execute({
      sql: `SELECT
          COUNT(*) AS users,
          COUNT(*) FILTER (WHERE tx_count > 0) AS active_users,
          COALESCE(SUM(tx_count), 0) AS transactions,
          COALESCE(SUM(volume_usd), 0) AS volume,
          COALESCE(SUM(swap_count), 0) AS swaps,
          MAX(indexed_at) AS indexed_at
        FROM analytics_user_stats`,
      args: [],
    })
    .then((r) => r.rows[0] ?? {})
    .catch(() => ({} as Record<string, unknown>));

  // Volume by day: last 30 days from analytics_daily, ascending.
  const volumeByDay = await db()
    .execute({
      sql: `SELECT day, volume_usd, tx_count
        FROM analytics_daily
        ORDER BY day DESC
        LIMIT 30`,
      args: [],
    })
    .then((r) =>
      r.rows
        .map(
          (row): DailyPoint => ({
            date: String(row.day ?? ""),
            volumeUsd: num(row.volume_usd),
            txCount: num(row.tx_count),
          })
        )
        // query returns newest-first; flip to ascending by date.
        .reverse()
    )
    .catch((): DailyPoint[] => []);

  // Per-user rows mapped to UserStat, sorted by volume desc.
  const users = await db()
    .execute({
      sql: `SELECT user_id, handle, address, tx_count, volume_usd, swap_count,
          last_active_at, joined_at, indexed_at
        FROM analytics_user_stats
        ORDER BY volume_usd DESC`,
      args: [],
    })
    .then((r) =>
      r.rows.map(
        (row): UserStat => ({
          userId: num(row.user_id),
          handle: String(row.handle ?? ""),
          address: String(row.address ?? ""),
          txCount: num(row.tx_count),
          volumeUsd: num(row.volume_usd),
          swapCount: num(row.swap_count),
          lastActiveAt: numOrNull(row.last_active_at),
          joinedAt: num(row.joined_at),
          indexedAt: num(row.indexed_at),
        })
      )
    )
    .catch((): UserStat[] => []);

  return {
    totals: {
      users: num(totals.users),
      activeUsers: num(totals.active_users),
      transactions: num(totals.transactions),
      stablecoinVolumeUsd: num(totals.volume),
      swaps: num(totals.swaps),
    },
    volumeByDay,
    users,
    indexedAt: numOrNull(totals.indexed_at),
  };
}

/**
 * Most recent index run across all cached users (epoch ms), or null if the
 * cache is empty / unavailable.
 */
export async function lastIndexedAt(): Promise<number | null> {
  return db()
    .execute({
      sql: `SELECT MAX(indexed_at) AS indexed_at FROM analytics_user_stats`,
      args: [],
    })
    .then((r) => numOrNull(r.rows[0]?.indexed_at))
    .catch(() => null);
}
