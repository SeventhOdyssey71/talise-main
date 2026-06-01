import "server-only";

import {
  SuiJsonRpcClient,
  getJsonRpcFullnodeUrl,
} from "@mysten/sui/jsonRpc";
import {
  getFinancialSummary,
  getPendingRewardsByAddress,
  type FinancialSummary,
  type PendingReward,
} from "@t2000/sdk";
import {
  fetchUsdsuiMarginApy,
  fetchUserUsdsuiSupply,
} from "./deepbook-margin";
import { fetchNaviUsdsuiSupplyApy } from "./navi-supply";
import { getGlobalNum, setGlobalNum, refreshInBackground } from "./snapshots";

/** Resolve a promise to `fallback` if it doesn't settle within `ms`. The
 *  underlying work keeps running; we just stop waiting on the hot path. */
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/**
 * A venue APY backed by a durable global cache. If the live read produced a
 * usable value, return it and warm the cache in the background; otherwise
 * fall back to the last-known cached value so a slow/failed RPC leg never
 * drops the venue (the "No live venues" regression). Returns null only when
 * we have neither a live nor a cached APY for this venue.
 */
async function resolveApy(key: string, live: number | null | undefined): Promise<number | null> {
  if (typeof live === "number" && Number.isFinite(live) && live > 0) {
    refreshInBackground(async () => setGlobalNum(key, live));
    return live;
  }
  const cached = await getGlobalNum(key).catch(() => null);
  return cached && cached.value > 0 ? cached.value : null;
}

/** Per-leg cap so one slow venue read can't hang the whole comparison.
 *  5s clears the ~4.2s SDK summary read (so existing earners' supplied
 *  still loads) while staying well under the iOS 15s request deadline. */
const YIELD_LEG_TIMEOUT_MS = 5_000;

/**
 * Server-side yield queries — all stateless (no zkLogin signer needed).
 *
 * `getFinancialSummary` returns the user's NAVI position summary directly
 * from chain: how much USDsui they have supplied, what APY they're earning,
 * and a projected daily yield. `getPendingRewardsByAddress` returns every
 * claimable reward token (in their own coin types) with USD valuations.
 */

export type EarnSnapshot = {
  /** USDsui currently supplied to NAVI lending. Human units. */
  supplied: number;
  /** Current supply APY as a fraction (0.0823 = 8.23%). */
  apy: number;
  /** Projected daily yield at the current APY. */
  dailyYield: number;
  /** Pending claimable rewards (per token). */
  pending: PendingReward[];
  /** Sum of USD valuations across all pending rewards. */
  totalPendingUsd: number;
};

let _client: SuiJsonRpcClient | null = null;
function client(): SuiJsonRpcClient {
  if (_client) return _client;
  _client = new SuiJsonRpcClient({
    url: getJsonRpcFullnodeUrl("mainnet"),
    network: "mainnet",
  });
  return _client;
}

export async function getEarnSnapshot(address: string): Promise<EarnSnapshot> {
  const [summary, pending] = await Promise.all([
    getFinancialSummary(client() as never, address).catch(
      () => null as FinancialSummary | null
    ),
    getPendingRewardsByAddress(address).catch(() => [] as PendingReward[]),
  ]);

  const supplied = summary?.savingsBalance ?? 0;
  const apy = summary?.saveApy ?? 0;
  const dailyYield = summary?.dailyYield ?? supplied * (apy / 365);
  const totalPendingUsd = pending.reduce(
    (s, r) => s + (r.estimatedValueUsd ?? 0),
    0
  );

  return { supplied, apy, dailyYield, pending, totalPendingUsd };
}

/**
 * Cross-venue yield comparison: returns NAVI + DeepBook margin USDsui
 * APYs side-by-side plus a `best` pointer at whichever is higher right
 * now. The `/earn` page surfaces both as picker tiles; the chat agent
 * uses `best` to answer "what's the best place to put my dollars?".
 *
 * Each venue's APY is fetched independently and failures are
 * non-fatal — if one venue is offline we still return the other.
 */
export type YieldVenue = {
  id: "navi" | "deepbook";
  name: string;
  apy: number;
  /** User's currently supplied USDsui, if any. */
  supplied?: number;
  /** Extra venue-specific context for the UI. */
  meta?: Record<string, unknown>;
};

export type YieldComparison = {
  venues: YieldVenue[];
  best: YieldVenue | null;
};

export async function getYieldComparison(
  address: string
): Promise<YieldComparison> {
  // Every leg is timeout-capped AND failure-tolerant so one slow/flaky
  // venue read can't stall (or empty) the comparison. The fast Navi open
  // API (~1s) carries the APY; the slower SDK summary (~4s) only adds the
  // user's supplied balance — so the Navi venue shows even if the SDK leg
  // is slow or down. Each APY is cached in global_kv, so cold serverless
  // instances and transient RPC outages still return last-known venues.
  const [naviSnap, dbApy, dbSupply, naviApyLive] = await Promise.all([
    withTimeout(getEarnSnapshot(address).catch(() => null), YIELD_LEG_TIMEOUT_MS, null),
    withTimeout(fetchUsdsuiMarginApy().catch(() => null), YIELD_LEG_TIMEOUT_MS, null),
    withTimeout(fetchUserUsdsuiSupply(address).catch(() => null), YIELD_LEG_TIMEOUT_MS, null),
    // Live USDsui supply APY from Navi's open API. The SDK's
    // `getFinancialSummary` keys APY off USDC's pool (a SDK bug — see
    // fetchNaviUsdsuiSupplyApy), so this portal-accurate value wins.
    withTimeout(fetchNaviUsdsuiSupplyApy().catch(() => null), YIELD_LEG_TIMEOUT_MS, null),
  ]);

  // Resolve each APY against the durable cache (live → cache it; else fall
  // back to last-known) so a timed-out/failed leg doesn't drop the venue.
  const [naviApy, deepbookApy] = await Promise.all([
    resolveApy("navi_usdsui_apy", naviApyLive ?? naviSnap?.apy),
    resolveApy("deepbook_usdsui_apy", dbApy?.apy),
  ]);

  const venues: YieldVenue[] = [];
  if (naviApy != null) {
    venues.push({
      id: "navi",
      name: "NAVI lending",
      apy: naviApy,
      supplied: naviSnap?.supplied ?? 0,
      meta: { pendingUsd: naviSnap?.totalPendingUsd ?? 0 },
    });
  }
  if (deepbookApy != null) {
    venues.push({
      id: "deepbook",
      name: "DeepBook margin",
      apy: deepbookApy,
      supplied: dbSupply?.amount ?? 0,
      meta: {
        utilization: dbApy?.utilization ?? 0,
        supplierCapId: dbSupply?.supplierCapId,
      },
    });
  }
  venues.sort((a, b) => b.apy - a.apy);
  return { venues, best: venues[0] ?? null };
}
