/**
 * Shared types for the Talise internal analytics dashboard (/dashboard-analytics).
 *
 * The dashboard reads LIVE from the app's own ledger: the `users` table (every
 * Talise account) and `tx_history` (every on-chain-confirmed transaction the
 * app recorded). No separate index/cache step — these are direct, indexed DB
 * aggregates, so the numbers are always current.
 */

/** One recent transaction row, joined to the user who made it. */
export type RecentTx = {
  id: number;
  createdAt: number; // epoch ms
  kind: string; // 'send' | 'send-cross-asset' | … (tx_history.kind)
  amount: number | null; // human amount (e.g. 12.5), null if unrecorded
  asset: string | null; // 'USDsui' | 'USDC' | 'USDsui→SUI' | …
  recipient: string | null; // recipient address / handle, if any
  digest: string; // on-chain tx digest
  handle: string | null; // sender's talise_username (no @)
  address: string | null; // sender's sui_address
};

export type AnalyticsSummary = {
  totals: {
    users: number; // total Talise accounts (excludes deleted)
    stablecoinVolumeUsd: number; // sum of USDsui+USDC amounts moved, USD
    transactions: number; // total recorded transactions
  };
  recent: RecentTx[]; // most recent transactions, newest first
};
