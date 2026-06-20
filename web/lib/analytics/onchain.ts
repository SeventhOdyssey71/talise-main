import "server-only";

import { getRecentActivityWithMeta } from "@/lib/activity";
import type { DailyPoint } from "@/lib/analytics/types";

/**
 * Per-user on-chain stats computed by the analytics indexer.
 *
 * `volumeUsd` sums USDsui amounts moved (in + out) in USD terms — USDsui is
 * pegged ~1:1 to the US dollar, so the human USDsui figure is the USD figure.
 * `swapCount` counts DEX-style swap rows (the activity feed surfaces these as a
 * single `direction: "swap"` entry when a tx moves two coins in opposite
 * directions). `lastActiveAt` is the epoch-ms timestamp of the most recent
 * indexed tx (null when the user has no activity in the window). `daily` is the
 * volume + tx-count bucketed by UTC calendar day (YYYY-MM-DD), ascending.
 */
export type OnchainStat = {
  txCount: number;
  volumeUsd: number;
  swapCount: number;
  lastActiveAt: number | null;
  daily: DailyPoint[];
};

/**
 * Bound on how much recent history we pull per address. The activity feed is
 * paged (each page caps at the GraphQL-enforced 50), and over-fetches ~4x to
 * survive client-side filtering. 500 keeps the per-user index to roughly a
 * dozen round-trips at most while still capturing a meaningful recent window
 * for active users. We always pass `includeNonTalise: true` so funding txs and
 * direct (non-payment-kit) transfers count toward the user's real activity.
 */
const INDEX_LIMIT = 500;

const ZERO: OnchainStat = {
  txCount: 0,
  volumeUsd: 0,
  swapCount: 0,
  lastActiveAt: null,
  daily: [],
};

/** UTC calendar day (YYYY-MM-DD) for an epoch-ms timestamp. */
function utcDay(timestampMs: number): string {
  return new Date(timestampMs).toISOString().slice(0, 10);
}

/**
 * Index one user's recent on-chain activity into an `OnchainStat`.
 *
 * Reuses the existing activity pipeline (`getRecentActivityWithMeta`) rather
 * than hand-rolling gRPC/GraphQL — that function already does the classifier,
 * coin-metadata, and dedupe work and returns normalized `ActivityEntry` rows.
 *
 * Resilience contract: this NEVER throws. On any error (bad address, RPC
 * failure, etc.) it returns all-zeros. We also treat an INCOMPLETE read
 * (`complete === false`, i.e. the tx-history leg timed out) as zeros: a failed
 * read is not a genuine zero, and folding a partial sum into the cached totals
 * would silently understate real volume (same integrity principle the activity
 * pipeline applies for aggregating callers).
 */
export async function indexUserOnchain(address: string): Promise<OnchainStat> {
  if (!address || typeof address !== "string") return ZERO;

  try {
    const { entries, complete } = await getRecentActivityWithMeta(
      address,
      INDEX_LIMIT,
      { includeNonTalise: true }
    );

    // A partial read is not a genuine zero — don't cache an understated sum.
    if (!complete) return ZERO;

    let txCount = 0;
    let volumeUsd = 0;
    let swapCount = 0;
    let lastActiveAt: number | null = null;

    // Bucket volume + tx count per UTC day; sorted ascending at the end.
    const byDay = new Map<string, { volumeUsd: number; txCount: number }>();

    for (const e of entries) {
      txCount += 1;

      const ts = Number(e.timestampMs);
      const hasTs = Number.isFinite(ts) && ts > 0;
      if (hasTs && (lastActiveAt === null || ts > lastActiveAt)) {
        lastActiveAt = ts;
      }

      // USDsui ≈ USD, 1:1. `amountUsdsui` is already non-negative (the feed
      // emits Math.abs of the net delta) or null. Count both inbound and
      // outbound — the magnitude is the volume moved either way.
      const amt = e.amountUsdsui;
      const vol = typeof amt === "number" && Number.isFinite(amt) ? amt : 0;
      volumeUsd += vol;

      if (e.direction === "swap") swapCount += 1;

      if (hasTs) {
        const day = utcDay(ts);
        const bucket = byDay.get(day) ?? { volumeUsd: 0, txCount: 0 };
        bucket.volumeUsd += vol;
        bucket.txCount += 1;
        byDay.set(day, bucket);
      }
    }

    const daily: DailyPoint[] = Array.from(byDay.entries())
      .map(([date, v]) => ({ date, volumeUsd: v.volumeUsd, txCount: v.txCount }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    return { txCount, volumeUsd, swapCount, lastActiveAt, daily };
  } catch {
    // Never throw — a failed address yields zeros so the run completes.
    return ZERO;
  }
}
