"use client";

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01FreeIcons, SparklesFreeIcons } from "@hugeicons/core-free-icons";
import { defaultCurrency, formatLocal } from "@/lib/fx";
import { DashboardSparkline } from "@/components/DashboardSparkline";
import { HeroNumber, HeroTabs, StatCard } from "@/components/HeroNumber";
import type { ActivityEntry } from "@/lib/activity";

type Asset = "all" | "usdsui" | "sui";

/**
 * The Ledgerix-style centerpiece of /home. Big centered total at the top,
 * asset filter tabs above it, 14-day activity sparkline, weekly stat
 * cards, and the Ask-Talise command bar.
 */
export function DashboardHero({
  totalUsd,
  usdsui,
  sui,
  suiUsd,
  activity,
  earnApy,
  earnSupplied,
}: {
  totalUsd: number;
  usdsui: number;
  sui: number;
  suiUsd: number;
  activity: ActivityEntry[];
  earnApy: number;
  earnSupplied: number;
}) {
  const [asset, setAsset] = useState<Asset>("all");
  const currency = defaultCurrency();

  const shown =
    asset === "usdsui" ? usdsui : asset === "sui" ? suiUsd : totalUsd;

  // 7d stats from the activity feed.
  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  let sentThisWeek = 0;
  let receivedThisWeek = 0;
  let txCount = 0;
  for (const e of activity) {
    if (!e.timestampMs || e.timestampMs < weekAgo) continue;
    txCount += 1;
    const amt = Math.abs(e.amountUsdsui ?? 0);
    if (e.direction === "sent") sentThisWeek += amt;
    else receivedThisWeek += amt;
  }
  const dailyYield = earnSupplied > 0 ? (earnSupplied * earnApy) / 365 : 0;

  const tabs = (
    <HeroTabs
      active={asset}
      onChange={setAsset}
      items={[
        { key: "all", label: "All" },
        { key: "usdsui", label: "USDsui" },
        { key: "sui", label: "SUI" },
      ]}
    />
  );

  const caption = (
    <>
      <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[#21A179]" />
      {asset === "usdsui"
        ? "USDsui balance"
        : asset === "sui"
          ? `${sui.toFixed(4)} SUI`
          : "Available across all assets"}
    </>
  );

  return (
    <div className="space-y-10">
      <HeroNumber
        animationKey={asset}
        tabs={tabs}
        value={formatLocal(shown, currency)}
        caption={caption}
      />

      <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] px-6 py-5 md:px-8 md:py-6">
        <DashboardSparkline activity={activity} days={14} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          eyebrow="Sent · 7d"
          value={formatLocal(sentThisWeek, "USD")}
          accent="#c08a3e"
        />
        <StatCard
          eyebrow="Received · 7d"
          value={formatLocal(receivedThisWeek, "USD")}
          accent="#21A179"
        />
        <StatCard
          eyebrow="Yield earning"
          value={
            earnSupplied > 0
              ? `${(earnApy * 100).toFixed(2)}%`
              : "Not earning"
          }
          sub={
            earnSupplied > 0
              ? `+${formatLocal(dailyYield, "USD")} / day`
              : undefined
          }
        />
        <StatCard
          eyebrow="Transactions · 7d"
          value={String(txCount)}
          sub={txCount > 0 ? `last ${Math.min(txCount, 7)} on chain` : undefined}
        />
      </div>

      <a
        href="/chat"
        className="group flex items-center gap-3 rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 transition hover:border-[var(--color-fg)]"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1a1a1a] text-white">
          <HugeiconsIcon
            icon={SparklesFreeIcons}
            size={15}
            strokeWidth={1.8}
            color="currentColor"
          />
        </span>
        <div className="flex-1 text-[13px] text-[var(--color-fg-muted)]">
          Ask Talise anything — send money, move savings, check yield…
        </div>
        <span className="hidden items-center gap-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-dim)] md:inline-flex">
          Open
          <HugeiconsIcon
            icon={ArrowRight01FreeIcons}
            size={11}
            strokeWidth={1.8}
            color="currentColor"
          />
        </span>
      </a>
    </div>
  );
}
