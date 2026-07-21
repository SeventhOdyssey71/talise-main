import { api } from "@/api/client";

/** Rewards + goals API — DTOs from ios APIModels.swift. */

export type RewardsEvent = { id: string; kind: string; points: number; createdAt: string };
export type RewardsTier = { id: string; label: string; pointsToNext?: number | null; nextLabel?: string | null };
export type RoundupConfig = { enabled: boolean; percentage: number };

export type RewardsSummary = {
  code?: string | null;
  pointsTotal: number;
  referralCount: number;
  recentEvents: RewardsEvent[];
  tier?: RewardsTier | null;
  lifetimeSentUsd?: number | null;
  lifetimeSavedUsd?: number | null;
  roundup?: RoundupConfig | null;
  roundupSavedUsd?: number | null;
};

export type SavingsGoal = {
  id: string;
  name: string;
  targetUsd: number;
  currentUsd: number;
  deadlineMs?: number | null;
  color?: string | null;
  createdAtMs: number;
  archived: boolean;
  completed?: boolean | null;
  vaultObjectId?: string | null;
  yieldOn?: boolean | null;
};

export const rewardsApi = {
  summary: () => api<RewardsSummary>("/api/referral/summary"),

  roundup: (body: { enabled?: boolean; percentage?: number }) =>
    api<{ enabled: boolean; percentage: number; savedUsd: number }>("/api/rewards/roundup", { method: "POST", body }),

  goals: async (): Promise<SavingsGoal[]> => {
    const r = await api<{ goals?: SavingsGoal[] }>("/api/rewards/goals");
    return r.goals ?? [];
  },
  createGoal: (name: string, targetUsd: number) =>
    api<{ goal: SavingsGoal; pointsAwarded?: number }>("/api/rewards/goals", {
      method: "POST",
      body: { name, targetUsd, deadlineMs: null, color: null },
    }),
  depositGoal: (id: string, amountUsd: number) =>
    api<{ goal: SavingsGoal; pointsAwarded?: number }>(`/api/rewards/goals/${id}`, {
      method: "POST",
      body: { amountUsd },
    }),
  withdrawGoal: (id: string, amountUsd: number) =>
    api<{ goal: SavingsGoal }>(`/api/rewards/goals/${id}`, {
      method: "POST",
      body: { amountUsd, action: "withdraw" },
    }),
};

/** Earning-history row title from an event kind. */
export function historyTitle(kind: string): string {
  const k = kind.toLowerCase();
  if (k.startsWith("send")) return "Sent money";
  if (k.includes("invest") || k.includes("supply")) return "Saved to yield";
  if (k.includes("roundup")) return "Round-up auto-save";
  if (k.includes("goal")) return "Added to a goal";
  if (k.includes("refer")) return "Friend joined";
  return kind.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
