import { useCallback, useEffect, useState } from "react";

import { walletApi, type ActivityEntry, type BalancesDTO, type WalletCoinBalance } from "@/api/wallet";

/**
 * Home data — balances + activity + coin balances, matching HomeView.loadAll.
 * Immutable-history rule: an empty/short activity response never blanks rows
 * already on screen; an all-zero non-fresh balance never clobbers a positive one.
 */
export function useWalletData() {
  const [balance, setBalance] = useState<BalancesDTO | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [coins, setCoins] = useState<WalletCoinBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (fresh: boolean) => {
    const [b, a, c] = await Promise.allSettled([
      walletApi.balances(fresh),
      walletApi.activity(20, fresh),
      walletApi.coinBalances(),
    ]);
    if (b.status === "fulfilled") {
      setBalance((prev) => {
        const next = b.value;
        if (!fresh && prev && prev.usdsui > 0 && next.usdsui === 0) return prev;
        return next;
      });
    }
    if (a.status === "fulfilled") {
      setActivity((prev) => (a.value.length >= prev.length ? a.value : prev));
    }
    if (c.status === "fulfilled") setCoins(c.value);
  }, []);

  useEffect(() => {
    load(false).finally(() => setLoading(false));
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  }, [load]);

  return { balance, activity, coins, loading, refreshing, refresh };
}
