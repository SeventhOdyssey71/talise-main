"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01FreeIcons, SparklesFreeIcons } from "@hugeicons/core-free-icons";
import { defaultCurrency, formatLocal, type Currency } from "@/lib/fx";
import { DashboardSparkline } from "@/components/DashboardSparkline";
import type { ActivityEntry } from "@/lib/activity";

type Asset = "all" | "usdsui" | "sui";

/**
 * The Ledgerix-style centerpiece of /home. One giant centered total at
 * the top, an inline asset filter above it (All / USDsui / SUI), the
 * 14-day activity sparkline, then a row of small stat cards, and finally
 * the "Ask Talise" command bar that routes into /chat.
 *
 * Designed to fit above the fold on a 13" laptop in light mode.
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

  return (
    <div className="space-y-10">
      {/* Hero number */}
      <div className="text-center">
        <AssetTabs asset={asset} onChange={setAsset} />
        <motion.div
          key={asset}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
          className="mt-6"
        >
          <BigNumber value={shown} currency={currency} />
          <div className="mt-4 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-fg-muted)]">
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[#21A179]" />
            {asset === "usdsui"
              ? "USDsui balance"
              : asset === "sui"
                ? `${sui.toFixed(4)} SUI`
                : "Available across all assets"}
          </div>
        </motion.div>
      </div>

      {/* Sparkline */}
      <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] px-6 py-5 md:px-8 md:py-6">
        <DashboardSparkline activity={activity} days={14} />
      </div>

      {/* Stat cards */}
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

      {/* Command bar — routes to /chat. */}
      <CommandBar />
    </div>
  );
}

function BigNumber({
  value,
  currency,
}: {
  value: number;
  currency: Currency;
}) {
  const formatted = formatLocal(value, currency);
  // Soft entry animation per character so the number "draws in" — nicked
  // from the way Ledgerix's hero number feels alive.
  return (
    <div className="font-display text-[56px] font-medium leading-[1] tracking-[-0.04em] text-[var(--color-fg)] md:text-[88px] lg:text-[104px]">
      {formatted}
    </div>
  );
}

function AssetTabs({
  asset,
  onChange,
}: {
  asset: Asset;
  onChange: (a: Asset) => void;
}) {
  const items: Array<{ key: Asset; label: string }> = [
    { key: "all", label: "All" },
    { key: "usdsui", label: "USDsui" },
    { key: "sui", label: "SUI" },
  ];
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] p-1">
      {items.map((it) => {
        const active = it.key === asset;
        return (
          <button
            key={it.key}
            type="button"
            onClick={() => onChange(it.key)}
            className={`rounded-full px-3.5 py-1.5 text-[12px] font-medium transition ${
              active
                ? "bg-[var(--color-fg)] text-[var(--color-bg)]"
                : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
            }`}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

function StatCard({
  eyebrow,
  value,
  sub,
  accent,
}: {
  eyebrow: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-fg-dim)]">
        {accent && (
          <span
            className="inline-flex h-1.5 w-1.5 rounded-full"
            style={{ background: accent }}
          />
        )}
        {eyebrow}
      </div>
      <div className="mt-3 text-[24px] font-medium leading-[1.1] tracking-[-0.02em] text-[var(--color-fg)] md:text-[28px]">
        {value}
      </div>
      {sub && (
        <div className="mt-1 font-mono text-[11px] text-[var(--color-fg-muted)]">
          {sub}
        </div>
      )}
    </div>
  );
}

function CommandBar() {
  return (
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
  );
}
