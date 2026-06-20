/**
 * Shared types for the Talise internal analytics dashboard (/dashboard-analytics).
 *
 * This module is the single source of truth for the analytics data shapes used
 * across the store, indexer, API routes, and UI. All other analytics modules
 * import these types from "@/lib/analytics/types" — do not redefine them locally.
 */

export type DailyPoint = { date: string; volumeUsd: number; txCount: number }; // date = "YYYY-MM-DD"

export type UserStat = {
  userId: number;
  handle: string;            // talise_username, no "@" and no ".talise.sui"
  address: string;           // sui_address (0x…)
  txCount: number;           // total transactions indexed (frequency)
  volumeUsd: number;         // total USDsui volume moved (in + out), USD
  swapCount: number;         // number of swap transactions
  lastActiveAt: number | null; // epoch ms of most recent tx, null if none
  joinedAt: number;          // user created_at (epoch ms)
  indexedAt: number;         // epoch ms when these stats were computed
};

export type AnalyticsSummary = {
  totals: {
    users: number;
    activeUsers: number;       // users with txCount > 0
    transactions: number;      // sum of txCount
    stablecoinVolumeUsd: number; // sum of volumeUsd
    swaps: number;             // sum of swapCount
  };
  volumeByDay: DailyPoint[];   // ascending by date, last 30 days
  users: UserStat[];           // sorted by volumeUsd desc
  indexedAt: number | null;    // most recent index run (epoch ms), null if never
};
