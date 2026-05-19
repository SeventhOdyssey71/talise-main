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
