import { api } from "@/api/client";

/**
 * Wallet data — DTOs + endpoints verbatim from ios Network/APIModels.swift.
 * Read paths (balances, activity) need no attestation; the sweep/send paths do.
 */

export type BalancesDTO = {
  address: string;
  usdsui: number;
  sui: number;
  suiPriceUsd: number;
  totalUsd: number;
};

export type ActivityOtherCoin = {
  coinType: string;
  symbol: string;
  amount: string; // raw u64 string
  decimals: number;
};

export type OfframpInfo = {
  provider: string;
  amountNgn: number;
  bankName?: string | null;
  accountLast4?: string | null;
  status: string;
  rate: number;
  orderId: string;
};

export type TeamPayoutInfo = { name: string; recipientCount: number };

export type ActivityEntry = {
  digest: string;
  timestampMs: number;
  direction: string; // sent|received|invest|withdraw|swap|autoswap
  amountUsdsui?: number | null;
  amountSui?: number | null;
  counterparty?: string | null;
  counterpartyName?: string | null;
  venue?: string | null;
  otherCoin?: ActivityOtherCoin | null;
  roundupUsdsui?: number | null;
  offramp?: OfframpInfo | null;
  team?: TeamPayoutInfo | null;
};

export type WalletCoinBalance = {
  coinType: string;
  amount: string;
  isUsdsui: boolean;
  symbol?: string | null;
  decimals?: number | null;
  logoUrl?: string | null;
  usdValue?: number | null;
};

/** Human amount of a raw coin balance: amount / 10^decimals. */
export function humanAmount(c: WalletCoinBalance): number {
  return Number(c.amount || "0") / Math.pow(10, c.decimals ?? 9);
}

/** displayAmount of an ActivityOtherCoin: raw/10^dec, trimmed, max 4dp. */
export function otherCoinDisplay(c: ActivityOtherCoin): string {
  const v = Number(c.amount || "0") / Math.pow(10, c.decimals);
  return v.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

export const walletApi = {
  balances: (fresh = false) =>
    api<BalancesDTO>(`/api/balances${fresh ? "?fresh=1" : ""}`),

  activity: async (limit = 20, fresh = false): Promise<ActivityEntry[]> => {
    const r = await api<{ entries?: ActivityEntry[] }>(
      `/api/activity?limit=${limit}${fresh ? "&fresh=1" : ""}`,
    );
    return r.entries ?? [];
  },

  coinBalances: async (): Promise<WalletCoinBalance[]> => {
    const r = await api<{ balances?: WalletCoinBalance[] }>("/api/wallet/balances");
    return r.balances ?? [];
  },
};
