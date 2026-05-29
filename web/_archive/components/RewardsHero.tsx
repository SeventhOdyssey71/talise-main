"use client";

import { useState } from "react";
import { HeroNumber, HeroTabs, StatCard } from "@/components/HeroNumber";

type Mode = "points" | "referrals" | "volume";

/**
 * Ledgerix-style hero for /rewards. Big centered points/referrals/volume
 * number with tabs to flip the headline, then a row of stat cards that
 * stays the same regardless of which tab is active so the user can
 * always see all three at once below the hero.
 */
export function RewardsHero({
  pointsTotal,
  referralCount,
  sentCount,
  sentVolumeUsd,
  subnameLabel,
}: {
  pointsTotal: number;
  referralCount: number;
  sentCount: number;
  sentVolumeUsd: number;
  subnameLabel: string | null;
}) {
  const [mode, setMode] = useState<Mode>("points");

  const value =
    mode === "points"
      ? pointsTotal.toLocaleString()
      : mode === "referrals"
        ? referralCount.toLocaleString()
        : `$${sentVolumeUsd.toLocaleString(undefined, {
            maximumFractionDigits: 0,
          })}`;

  const caption =
    mode === "points"
      ? "Lifetime points earned"
      : mode === "referrals"
        ? referralCount === 1
          ? "Friend invited"
          : "Friends invited"
        : "USDsui volume sent";

  return (
    <div className="space-y-10">
      <HeroNumber
        animationKey={mode}
        tabs={
          <HeroTabs
            active={mode}
            onChange={setMode}
            items={[
              { key: "points", label: "Points" },
              { key: "referrals", label: "Referrals" },
              { key: "volume", label: "Volume" },
            ]}
          />
        }
        value={value}
        caption={
          <>
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[#c08a3e]" />
            {caption}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          eyebrow="Points · lifetime"
          value={pointsTotal.toLocaleString()}
          accent="#c08a3e"
        />
        <StatCard
          eyebrow="Referrals"
          value={referralCount.toLocaleString()}
          sub={referralCount === 1 ? "friend invited" : "friends invited"}
          accent="#21A179"
        />
        <StatCard
          eyebrow="Sends"
          value={sentCount.toLocaleString()}
          sub={
            sentVolumeUsd > 0
              ? `$${sentVolumeUsd.toLocaleString(undefined, {
                  maximumFractionDigits: 0,
                })} volume`
              : "no volume yet"
          }
        />
        <StatCard
          eyebrow="Subname"
          value={subnameLabel ?? "Not claimed"}
          sub={subnameLabel ? "active" : "claim to earn 250 points"}
        />
      </div>
    </div>
  );
}
