"use client";

/**
 * Earn read-data hooks + shared types.
 *
 * Wraps the Earn-area GET endpoints (yield comparison, round-up config,
 * goals, insights) with fetch-on-mount + manual refresh, mirroring the
 * pattern in `components/app/data/hooks.ts`. All of these are DISPLAY reads
 * — money movement always flows through `useEarnAction`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/components/app";
import type { EarnVenue } from "./useEarnAction";

// ── Yield comparison ─────────────────────────────────────────────────────

/** One yield venue as returned by GET /api/yield/comparison. */
export type YieldVenue = {
  venue: EarnVenue;
  apy: number;
  supplied: number;
  pendingRewards: number;
  /** NAVI-only enrichment (cumulative accrued yield, USD). */
  earned?: number;
  earningPerDay?: number;
  principalSupplied?: number;
};

export type YieldComparison = {
  venues: YieldVenue[];
  best: { venue: EarnVenue; apy: number; supplied: number } | null;
};

const VENUE_LABELS: Record<EarnVenue, string> = {
  navi: "NAVI",
  deepbook: "DeepBook",
};
export function venueLabel(v: string): string {
  return VENUE_LABELS[v as EarnVenue] ?? v.charAt(0).toUpperCase() + v.slice(1);
}

export function useYieldComparison() {
  const [data, setData] = useState<YieldComparison | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<YieldComparison>("/api/yield/comparison", { fresh: true });
      if (!mounted.current) return;
      setData(res);
      setError(null);
    } catch (e) {
      if (!mounted.current) return;
      setError(e instanceof ApiError ? e : new ApiError(0, String(e)));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    const onTx = () => void load();
    window.addEventListener("talise:tx", onTx);
    return () => {
      mounted.current = false;
      window.removeEventListener("talise:tx", onTx);
    };
  }, [load]);

  return { data, loading, error, refresh: load };
}

// ── Round-up config ───────────────────────────────────────────────────────

export type RoundupConfig = {
  enabled: boolean;
  percentage: number;
  savedUsd: number;
};

export function useRoundup() {
  const [config, setConfig] = useState<RoundupConfig | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const cfg = await api<RoundupConfig>("/api/rewards/roundup");
      setConfig(cfg);
    } catch {
      /* keep last-good / null */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const update = useCallback(async (patch: { enabled?: boolean; percentage?: number }) => {
    const cfg = await api<RoundupConfig>("/api/rewards/roundup", {
      method: "POST",
      body: patch,
    });
    setConfig(cfg);
    return cfg;
  }, []);

  return { config, loading, update, refresh: load };
}

// ── Savings goals ──────────────────────────────────────────────────────────

export type Goal = {
  id: string;
  name: string;
  targetUsd: number;
  currentUsd: number;
  deadlineMs: number | null;
  color: string | null;
  createdAtMs: number;
  archived: boolean;
};

export function useGoals() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await api<{ goals: Goal[] }>("/api/rewards/goals");
      if (mounted.current) setGoals(res.goals ?? []);
    } catch {
      /* keep last-good */
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  return { goals, loading, refresh: load };
}

// ── Insights ────────────────────────────────────────────────────────────────

export type TopCounterparty = {
  address: string;
  name: string | null;
  count: number;
  totalUsd: number;
};

export type MonthInsights = {
  spentUsd: number;
  receivedUsd: number;
  savedUsd: number;
  monthStartMs: number;
  sampleSize: number;
  topCounterparties: TopCounterparty[];
};

export function useInsights() {
  const [data, setData] = useState<MonthInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await api<MonthInsights>("/api/rewards/insights");
      if (mounted.current) setData(res);
    } catch {
      /* keep last-good */
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    const onTx = () => void load();
    window.addEventListener("talise:tx", onTx);
    return () => {
      mounted.current = false;
      window.removeEventListener("talise:tx", onTx);
    };
  }, [load]);

  return { data, loading, refresh: load };
}

// ── Shared helpers ──────────────────────────────────────────────────────────

/** Format an APY fraction (0.0512) as a percent string, or "—" below 1bp. */
export function formatApy(apy: number): string {
  return apy >= 0.0001 ? `${(apy * 100).toFixed(2)}%` : "—";
}

/**
 * One-time Earn opt-in disclosure acceptance, persisted in localStorage.
 * Gates the user's FIRST supply behind the lending-service disclosure.
 */
const EARN_DISCLOSURE_KEY = "talise:earn-disclosure-accepted-v1";
export function hasAcceptedEarnDisclosure(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(EARN_DISCLOSURE_KEY) === "1";
  } catch {
    return false;
  }
}
export function markEarnDisclosureAccepted(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(EARN_DISCLOSURE_KEY, "1");
  } catch {
    /* ignore */
  }
}
