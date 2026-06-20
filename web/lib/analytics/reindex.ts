/**
 * Analytics reindex orchestrator (Agent: REINDEX).
 *
 * Drives a full reindex pass for the internal analytics dashboard
 * (/dashboard-analytics):
 *   1. ensure the cache schema exists,
 *   2. list every Talise subname user,
 *   3. index each user's recent on-chain activity (concurrency-limited pool),
 *   4. upsert per-user stats,
 *   5. accumulate a merged daily volume/tx series across ALL users and replace
 *      the analytics_daily table with it.
 *
 * A single Date.now() stamp is used for `indexedAt` across the whole run so all
 * rows share a consistent "last indexed" timestamp. The run is resilient: a
 * user that fails to index increments `failed` and is skipped — the run still
 * completes and the rest of the cache is refreshed.
 */

import { listIndexedUsers } from "@/lib/analytics/users";
import { indexUserOnchain } from "@/lib/analytics/onchain";
import {
  ensureAnalyticsSchema,
  upsertUserStat,
  replaceDaily,
} from "@/lib/analytics/store";
import type { DailyPoint } from "@/lib/analytics/types";

export type ReindexResult = {
  users: number; // total users considered
  indexed: number; // users successfully indexed + persisted
  failed: number; // users that errored and were skipped
  indexedAt: number; // epoch ms stamp shared across the run
};

/** Default size of the per-user indexing pool. */
const DEFAULT_CONCURRENCY = 5;

/**
 * Run a full analytics reindex.
 *
 * @param opts.concurrency  Max users indexed in parallel (default 5, min 1).
 */
export async function runReindex(opts?: {
  concurrency?: number;
}): Promise<ReindexResult> {
  const indexedAt = Date.now();

  await ensureAnalyticsSchema();

  const users = await listIndexedUsers();

  // Merged daily series: day -> { volumeUsd, txCount } summed across all users.
  const dailyByDay = new Map<string, { volumeUsd: number; txCount: number }>();

  let indexed = 0;
  let failed = 0;

  const requested = opts?.concurrency;
  const concurrency =
    typeof requested === "number" && Number.isFinite(requested) && requested >= 1
      ? Math.floor(requested)
      : DEFAULT_CONCURRENCY;

  // Concurrency-limited pool: a shared cursor hands the next user to each worker
  // as it finishes, so we never run more than `concurrency` users at once.
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = cursor++;
      if (i >= users.length) return;
      const u = users[i];

      try {
        const stat = await indexUserOnchain(u.address);

        await upsertUserStat({
          userId: u.userId,
          handle: u.handle,
          address: u.address,
          txCount: stat.txCount,
          volumeUsd: stat.volumeUsd,
          swapCount: stat.swapCount,
          lastActiveAt: stat.lastActiveAt,
          joinedAt: u.joinedAt,
          indexedAt,
        });

        // Fold this user's daily buckets into the merged series.
        for (const point of stat.daily) {
          const bucket = dailyByDay.get(point.date) ?? {
            volumeUsd: 0,
            txCount: 0,
          };
          bucket.volumeUsd += point.volumeUsd;
          bucket.txCount += point.txCount;
          dailyByDay.set(point.date, bucket);
        }

        indexed++;
      } catch {
        // A failed user is counted and skipped — the run continues.
        failed++;
      }
    }
  }

  const poolSize = Math.min(concurrency, Math.max(users.length, 1));
  await Promise.all(Array.from({ length: poolSize }, () => worker()));

  // Replace analytics_daily with the merged series, ascending by date.
  const merged: DailyPoint[] = Array.from(dailyByDay.entries())
    .map(([date, v]) => ({ date, volumeUsd: v.volumeUsd, txCount: v.txCount }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  await replaceDaily(merged);

  return {
    users: users.length,
    indexed,
    failed,
    indexedAt,
  };
}
