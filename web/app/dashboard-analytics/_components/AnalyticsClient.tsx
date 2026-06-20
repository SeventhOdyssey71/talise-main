"use client";

import { useCallback, useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  RefreshIcon,
  AlertCircleIcon,
  ChartLineData01Icon,
} from "@hugeicons/core-free-icons";
import type { AnalyticsSummary } from "@/lib/analytics/types";
import KpiCards from "./KpiCards";
import VolumeChart from "./VolumeChart";
import UserTable from "./UserTable";

export default function AnalyticsClient() {
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reindexing, setReindexing] = useState(false);

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
    }
  }, []);

  useEffect(() => {
    void fetchSummary();
  }, [fetchSummary]);

  const handleReindex = useCallback(async () => {
    setReindexing(true);
    setError(null);
    try {
      const res = await fetch("/api/analytics/reindex", { method: "POST" });
      if (!res.ok) {
        throw new Error(`Re-index failed (${res.status}).`);
      }
      await fetchSummary();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Re-index failed.");
    } finally {
      setReindexing(false);
    }
  }, [fetchSummary]);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={() => void handleReindex()}
          disabled={reindexing}
          className="inline-flex h-11 items-center gap-2 rounded-full bg-[#15300c] px-6 text-[14px] font-semibold text-[#f7fcf2] transition-transform hover:-translate-y-0.5 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
        >
          <HugeiconsIcon
            icon={RefreshIcon}
            size={18}
            strokeWidth={1.8}
            className={reindexing ? "animate-spin" : ""}
          />
          {reindexing ? "Re-indexing…" : "Re-index"}
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
        data.totals.users === 0 ? (
          <EmptyState onReindex={() => void handleReindex()} busy={reindexing} />
        ) : (
          <>
            <KpiCards totals={data.totals} indexedAt={data.indexedAt} />
            <VolumeChart points={data.volumeByDay} />
            <UserTable users={data.users} />
          </>
        )
      ) : (
        !error && <EmptyState onReindex={() => void handleReindex()} busy={reindexing} />
      )}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-8" aria-busy="true">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-[120px] animate-pulse rounded-[28px] bg-[#f7fcf2]"
            style={{ boxShadow: "10px 10px 0 #15300c" }}
          />
        ))}
      </div>
      <div
        className="h-[280px] animate-pulse rounded-[28px] bg-[#f7fcf2]"
        style={{ boxShadow: "10px 10px 0 #15300c" }}
      />
      <div
        className="h-[360px] animate-pulse rounded-[28px] bg-[#f7fcf2]"
        style={{ boxShadow: "10px 10px 0 #15300c" }}
      />
    </div>
  );
}

function EmptyState({
  onReindex,
  busy,
}: {
  onReindex: () => void;
  busy: boolean;
}) {
  return (
    <div
      className="flex flex-col items-center rounded-[28px] bg-[#f7fcf2] px-6 py-16 text-center"
      style={{ boxShadow: "10px 10px 0 #15300c" }}
    >
      <span className="flex size-14 items-center justify-center rounded-full bg-[#CAFFB8]">
        <HugeiconsIcon
          icon={ChartLineData01Icon}
          size={26}
          strokeWidth={1.8}
          color="#15300c"
        />
      </span>
      <h2
        className="mt-5 text-[22px] font-[800] uppercase tracking-[-0.02em] text-[#15300c]"
        style={{ fontFamily: "var(--font-display-v2)" }}
      >
        No data yet
      </h2>
      <p className="mt-2 max-w-sm text-[14px] leading-relaxed text-[#3a5230]">
        Run an index pass to pull on-chain activity for every Talise subname and
        populate the dashboard.
      </p>
      <button
        type="button"
        onClick={onReindex}
        disabled={busy}
        className="mt-6 inline-flex h-11 items-center gap-2 rounded-full bg-[#15300c] px-6 text-[14px] font-semibold text-[#f7fcf2] transition-transform hover:-translate-y-0.5 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
      >
        <HugeiconsIcon
          icon={RefreshIcon}
          size={18}
          strokeWidth={1.8}
          className={busy ? "animate-spin" : ""}
        />
        {busy ? "Re-indexing…" : "Run first index"}
      </button>
    </div>
  );
}
