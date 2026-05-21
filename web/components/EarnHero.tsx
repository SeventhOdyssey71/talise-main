"use client";

import { useState } from "react";
import { formatLocal } from "@/lib/fx";
import { HeroNumber, HeroTabs, StatCard } from "@/components/HeroNumber";
import type { PendingReward } from "@t2000/sdk";

type Mode = "supplied" | "apy";

/**
 * Ledgerix-style hero for /earn. The headline metric is the user's
 * supplied USDsui (or the current APY when there's no position yet),
 * with a tab toggle so they can flip between "what's mine" and "what's
 * the rate".
 *
 * Below the hero: four stat cards covering APY, daily yield, monthly
 * projection, and pending rewards.
 */
export function EarnHero({
  supplied,
  apy,
  dailyYield,
  pending,
  totalPendingUsd,
}: {
  supplied: number;
  apy: number;
  dailyYield: number;
  pending: PendingReward[];
  totalPendingUsd: number;
}) {
  const supplying = supplied > 0;
  const [mode, setMode] = useState<Mode>(supplying ? "supplied" : "apy");

  const heroValue =
    mode === "supplied"
      ? formatLocal(supplied, "USD")
      : `${(apy * 100).toFixed(2)}%`;

  const heroCaption =
    mode === "supplied"
      ? supplying
        ? "Earning in NAVI lending"
        : "Nothing supplied yet"
      : "Live supply APY · changes per block";

  const monthlyYield = dailyYield * 30;
  const yearlyYield = supplied * apy;

  return (
    <div className="space-y-10">
      <HeroNumber
        animationKey={mode}
        tabs={
          <HeroTabs
            active={mode}
            onChange={setMode}
            items={[
              { key: "supplied", label: "Supplied" },
              { key: "apy", label: "APY" },
            ]}
          />
        }
        value={heroValue}
        caption={
          <>
            <span
              className="inline-flex h-1.5 w-1.5 rounded-full"
              style={{ background: supplying ? "#21A179" : "#a09a8a" }}
            />
            {heroCaption}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          eyebrow="APY · live"
          value={`${(apy * 100).toFixed(2)}%`}
          accent="#21A179"
        />
        <StatCard
          eyebrow="Daily yield"
          value={formatLocal(dailyYield, "USD")}
          sub={supplying ? "at current APY" : "supply to earn"}
          accent="#c08a3e"
        />
        <StatCard
          eyebrow="Monthly · projected"
          value={formatLocal(monthlyYield, "USD")}
          sub={yearlyYield > 0 ? `${formatLocal(yearlyYield, "USD")} / year` : undefined}
        />
        <StatCard
          eyebrow="Pending rewards"
          value={formatLocal(totalPendingUsd, "USD")}
          sub={
            pending.length > 0
              ? `${pending.length} token${pending.length === 1 ? "" : "s"} ready`
              : "claim when ready"
          }
        />
      </div>
    </div>
  );
}
