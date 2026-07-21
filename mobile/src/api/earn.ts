import { api } from "@/api/client";

/** Earn (yield) API — DTOs from ios APIModels.swift. Values on the wire are USD. */

export type YieldVenue = {
  venue: string;
  apy: number;
  supplied?: number | null;
  pendingRewards?: number | null;
  earned?: number | null;
  earningPerDay?: number | null;
  principalSupplied?: number | null;
};
export type YieldComparison = { venues: YieldVenue[]; best?: YieldVenue | null };

/** navi → "Earn", deepbook → "Trading". */
export function venueDisplayName(venue: string): string {
  if (venue === "navi") return "Earn";
  if (venue === "deepbook") return "Trading";
  return venue.replace(/\b\w/g, (c) => c.toUpperCase());
}

export const earnApi = {
  comparison: () => api<YieldComparison>("/api/yield/comparison"),

  supplyPrepare: (venue: string, amount: number) =>
    api<{ transactionKindB64: string; roundupUsd?: number }>("/api/earn/supply/prepare", {
      method: "POST",
      zk: true,
      body: { venue, amount },
    }),

  /** amount null → withdraw all. */
  withdrawPrepare: (venue: string, amount: number | null) =>
    api<{ transactionKindB64: string }>("/api/earn/withdraw/prepare", {
      method: "POST",
      zk: true,
      body: { venue, amount },
    }),

  withdrawEarnedPrepare: (venue: string) =>
    api<{ transactionKindB64: string }>("/api/earn/withdraw-earned/prepare", {
      method: "POST",
      zk: true,
      body: { venue },
    }),
};
