import "server-only";

import type { PendingReward } from "@t2000/sdk";
import {
  fetchUsdsuiMarginApy,
  fetchUserUsdsuiSupply,
} from "./deepbook-margin";
import {
  fetchNaviUsdsuiSupplyApy,
  readNaviUsdsuiSupply,
} from "./navi-supply";
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
 *  The direct NAVI read (config+pools cached → a single per-user
 *  `devInspect`) settles well under this; it stays comfortably below the
 *  iOS 15s request deadline. */
const YIELD_LEG_TIMEOUT_MS = 5_000;

/**
 * Server-side yield queries — all stateless (no zkLogin signer needed).
 *
 * The NAVI position is read DIRECTLY (no @t2000/sdk): `readNaviUsdsuiSupply`
 * does one `devInspect` of NAVI's on-chain `get_user_state` getter for the
 * supplied balance, and `fetchNaviUsdsuiSupplyApy` reads the portal-accurate
 * APY from NAVI's open API. This replaced @t2000/sdk's `getFinancialSummary`
 * (which cost ~4.2s and keyed the APY off USDC's pool — a SDK bug).
 *
 * Pending rewards are not surfaced from the direct read (NAVI's reward
 * getter would add a second `devInspect`; the only consumer is the USD
 * total in `/api/yield/comparison`, which tolerates 0). `pending` is kept
 * in the return shape (empty) so callers + the iOS Codable don't change.
 */

export type EarnSnapshot = {
  /** USDsui currently supplied to NAVI lending. Human units. */
  supplied: number;
  /** Current supply APY as a fraction (0.0823 = 8.23%). */
  apy: number;
  /** Projected daily yield at the current APY. */
  dailyYield: number;
  /** Pending claimable rewards (per token). Currently always empty —
   *  see the module note above. */
  pending: PendingReward[];
  /** Sum of USD valuations across all pending rewards. */
  totalPendingUsd: number;
};

export async function getEarnSnapshot(address: string): Promise<EarnSnapshot> {
  const [supplied, apyLive] = await Promise.all([
    readNaviUsdsuiSupply(address).catch(() => 0),
    fetchNaviUsdsuiSupplyApy().catch(() => null),
  ]);

  const apy = apyLive ?? 0;
  const dailyYield = supplied * (apy / 365);

  return { supplied, apy, dailyYield, pending: [], totalPendingUsd: 0 };
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
  // API (~1s) carries the APY; the direct NAVI position read (one cached
  // open-API hop + a per-user `devInspect`, ~1–2s) only adds the user's
  // supplied balance — so the Navi venue shows even if that leg is slow or
  // down. Each APY is cached in global_kv, so cold serverless instances and
  // transient RPC outages still return last-known venues.
  const [naviSnap, dbApy, dbSupply, naviApyLive] = await Promise.all([
    withTimeout(getEarnSnapshot(address).catch(() => null), YIELD_LEG_TIMEOUT_MS, null),
    withTimeout(fetchUsdsuiMarginApy().catch(() => null), YIELD_LEG_TIMEOUT_MS, null),
    withTimeout(fetchUserUsdsuiSupply(address).catch(() => null), YIELD_LEG_TIMEOUT_MS, null),
    // Live USDsui supply APY from Navi's open API — the same
    // portal-accurate value `getEarnSnapshot` already uses. Fetched
    // separately here so the venue's APY survives even if the snapshot
    // (position) leg times out.
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
