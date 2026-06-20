"use client";

import { useCallback, useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { RefreshIcon, AlertCircleIcon } from "@hugeicons/core-free-icons";
import type { AnalyticsSummary } from "@/lib/analytics/types";
import KpiCards from "./KpiCards";
import RecentTxTable from "./RecentTxTable";

export default function AnalyticsClient() {
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSummary = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/analytics/summary", { cache: "no-store" });
      if (!res.ok) {
        throw new Error(
          res.status === 401
            ? "Not authorized."
            : `Failed to load analytics (${res.status}).`
        );
      }
      const json = (await res.json()) as AnalyticsSummary;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load analytics.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchSummary();
  }, [fetchSummary]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    void fetchSummary();
  }, [fetchSummary]);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing || loading}
          className="inline-flex h-11 items-center gap-2 rounded-full bg-[#15300c] px-6 text-[14px] font-semibold text-[#f7fcf2] transition-transform hover:-translate-y-0.5 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
        >
          <HugeiconsIcon
            icon={RefreshIcon}
            size={18}
            strokeWidth={1.8}
            className={refreshing ? "animate-spin" : ""}
          />
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div
          className="flex items-start gap-3 rounded-[28px] bg-[#f7fcf2] p-5 text-[14px] text-[#c0532f]"
          style={{ boxShadow: "10px 10px 0 #15300c" }}
        >
          <HugeiconsIcon
            icon={AlertCircleIcon}
            size={20}
            strokeWidth={1.8}
            className="mt-0.5 shrink-0"
          />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <LoadingSkeleton />
      ) : data ? (
        <>
          <KpiCards totals={data.totals} />
          <RecentTxTable txs={data.recent} />
        </>
      ) : null}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-8" aria-busy="true">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className={`h-[152px] animate-pulse rounded-[28px] bg-[#f7fcf2] ${i === 0 ? "sm:col-span-2" : ""}`}
            style={{ boxShadow: "10px 10px 0 #15300c" }}
          />
        ))}
      </div>
      <div
        className="h-[420px] animate-pulse rounded-[28px] bg-[#f7fcf2]"
        style={{ boxShadow: "10px 10px 0 #15300c" }}
      />
    </div>
  );
}
