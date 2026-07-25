import { api } from "@/api/client";

/** Perps (WaterX) API — DTOs from ios TradeModels.swift. Gated by FEATURE_PERPS
 * server-side; when off the endpoints 503 with code "PERPS_DISABLED". */

export type PerpMarket = {
  symbol: string;
  name: string;
  sym: string;
  category: string;
  marketId: string;
  paused: boolean;
  refPriceUsd: number;
  maxLeverage: number;
  minCollUsd: number;
  fundingRatePct: number;
  tradingFeeBps: number;
};

export type Candle = { time: number; open: number; high: number; low: number; close: number };

export type PerpPosition = {
  ticker: string;
  positionId: string;
  isLong: boolean;
  sizeTokens: number;
  collateralUsd: number;
  entryPriceUsd: number;
  markPriceUsd: number;
  liqPriceUsd: number;
  leverage: number;
  pnlUsd: number;
  hasTpSl: boolean;
};

export type PerpAccount = { accountId?: string | null; address?: string | null; availableUsd?: number | null; positions?: PerpPosition[] | null };
export type TradeLogEntry = { ts: number; type: string; ticker?: string | null; side?: string | null; sizeTokens?: number | null; priceUsd?: number | null; collateralUsd?: number | null; pnlUsd?: number | null; feeUsd?: number | null; digest?: string | null };

export const INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;

export const marketsApi = {
  markets: async (): Promise<PerpMarket[]> => {
    const r = await api<{ markets?: PerpMarket[] }>("/api/markets");
    return r.markets ?? [];
  },
  quote: (symbol: string) => api<{ spot?: number; change24h?: number; unavailable?: boolean }>(`/api/markets/quote?symbol=${encodeURIComponent(symbol)}`),
  candles: async (symbol: string, interval: string): Promise<Candle[]> => {
    const r = await api<{ candles?: Candle[] }>(`/api/markets/candles?symbol=${encodeURIComponent(symbol)}&interval=${interval}`);
    return r.candles ?? [];
  },
  account: () => api<PerpAccount>("/api/markets/account"),
  history: async (): Promise<TradeLogEntry[]> => {
    const r = await api<{ trades?: TradeLogEntry[] }>("/api/markets/history");
    return r.trades ?? [];
  },

  // writes (sponsor rail)
  order: (body: Record<string, unknown>) => api<{ mode: string; bytes?: string; digest?: string; feeUsd?: number }>("/api/markets/order/prepare", { method: "POST", zk: true, body }),
  accountOp: (body: Record<string, unknown>) => api<{ mode: string; bytes?: string; digest?: string; accountId?: string }>("/api/markets/account", { method: "POST", zk: true, body }),
  close: (body: Record<string, unknown>) => api<{ mode: string; bytes?: string; digest?: string; feeUsd?: number }>("/api/markets/close", { method: "POST", zk: true, body }),
};

/** TradeFormat.price — commas 2dp ≥1000, 3dp ≥1, else 4dp. */
export function fmtPrice(v: number): string {
  const d = v >= 1000 ? 2 : v >= 1 ? 3 : 4;
  return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}
export function signedPct(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}
