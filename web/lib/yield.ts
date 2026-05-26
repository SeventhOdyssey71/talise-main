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
  const [naviSnap, dbApy, dbSupply, naviApyLive] = await Promise.all([
    getEarnSnapshot(address).catch(() => null),
    fetchUsdsuiMarginApy().catch(() => null),
    fetchUserUsdsuiSupply(address).catch(() => null),
    // Live USDsui supply APY from Navi's open API. The SDK's
    // `getFinancialSummary` keys APY off USDC's pool (a SDK bug —
    // see fetchNaviUsdsuiSupplyApy comment), so we override with the
    // portal-accurate value whenever the API is reachable. Falls back
    // to the SDK number when null.
    fetchNaviUsdsuiSupplyApy().catch(() => null),
  ]);

  const venues: YieldVenue[] = [];
  if (naviSnap) {
    venues.push({
      id: "navi",
      name: "NAVI lending",
      apy: naviApyLive ?? naviSnap.apy,
      supplied: naviSnap.supplied,
      meta: { pendingUsd: naviSnap.totalPendingUsd },
    });
  }
  if (dbApy) {
    venues.push({
      id: "deepbook",
      name: "DeepBook margin",
      apy: dbApy.apy,
      supplied: dbSupply?.amount ?? 0,
      meta: {
        utilization: dbApy.utilization,
        supplierCapId: dbSupply?.supplierCapId,
      },
    });
  }
  venues.sort((a, b) => b.apy - a.apy);
  return { venues, best: venues[0] ?? null };
}
