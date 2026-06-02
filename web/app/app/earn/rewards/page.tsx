"use client";

import { useCallback, useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Coins01Icon } from "@hugeicons/core-free-icons";
import { Eyebrow, EmptyState, GlassCard, PrimaryButton, api, ApiError } from "@/components/app";
import {
  TierCard,
  LifetimeStats,
  EarnRules,
  Redemptions,
  ReferralCard,
  type ReferralSummary,
  type Catalogue,
} from "@/components/app/rewards";

/**
 * Rewards + Referrals — the points-and-perks hub.
 *
 * Tier progression, lifetime tallies, the "how you earn" rules, the
 * redemption catalogue, and the referral card. Two live reads:
 *   GET /api/referral/summary   → points, tier, lifetime stats, rates, code
 *   GET /api/rewards/catalogue  → redeemable perks + affordability
 *
 * Desktop: a two-column grid (tier + stats + earn rules on the left,
 * referral on the right) with the redemption grid spanning full width.
 * Mobile: a single stacked column.
 */
export default function RewardsPage() {
  const [summary, setSummary] = useState<ReferralSummary | null>(null);
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setError(null);
    try {
      const [s, c] = await Promise.all([
        api<ReferralSummary>("/api/referral/summary", { signal }),
        api<Catalogue>("/api/rewards/catalogue", { signal }),
      ]);
      setSummary(s);
      setCatalogue(c);
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      setError(
        err instanceof ApiError
          ? err.message
          : "We couldn't load your rewards. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  // Refresh after a redemption: points + catalogue affordability both change.
  const refresh = useCallback(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <header className="space-y-1.5">
        <Eyebrow>Rewards</Eyebrow>
        <h1
          className="text-fg"
          style={{ fontSize: 28, fontWeight: 500, letterSpacing: "-0.03em" }}
        >
          Spend, save, earn
        </h1>
      </header>

      {loading ? (
        <RewardsSkeleton />
      ) : error ? (
        <GlassCard className="p-2">
          <EmptyState
            icon={<HugeiconsIcon icon={Coins01Icon} size={26} strokeWidth={1.6} />}
            title="Rewards are taking a break"
            subtitle={error}
            action={<PrimaryButton onClick={refresh}>Try again</PrimaryButton>}
          />
        </GlassCard>
      ) : summary ? (
        <>
          {/* Top region: tier + stats + earn rules (left) and referral (right) */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
            <div className="space-y-4 lg:col-span-3">
              <TierCard tier={summary.tier} points={summary.pointsTotal} />
              <LifetimeStats
                sentUsd={summary.lifetimeSentUsd}
                savedUsd={summary.lifetimeSavedUsd}
              />
              <EarnRules rates={summary.pointRates} />
            </div>
            <div className="lg:col-span-2">
              <ReferralCard code={summary.code} referralCount={summary.referralCount} />
            </div>
          </div>

          {/* Redemption catalogue spans the full width. */}
          <Redemptions
            items={catalogue?.items ?? []}
            pointsTotal={catalogue?.pointsTotal ?? summary.pointsTotal}
            onRedeemed={refresh}
          />
        </>
      ) : null}
    </div>
  );
}

/** Glass placeholders matching the loaded layout, so the page doesn't jump. */
function RewardsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <GlassCard className="h-40 p-6">
            <div className="h-3 w-20 animate-pulse rounded-full bg-surface-2" />
            <div className="mt-4 h-12 w-40 animate-pulse rounded-lg bg-surface-2" />
            <div className="mt-6 h-2 w-full animate-pulse rounded-full bg-surface-2" />
          </GlassCard>
          <div className="grid grid-cols-2 gap-3">
            <GlassCard className="h-24 p-5">
              <div className="h-3 w-16 animate-pulse rounded-full bg-surface-2" />
              <div className="mt-4 h-7 w-24 animate-pulse rounded bg-surface-2" />
            </GlassCard>
            <GlassCard className="h-24 p-5">
              <div className="h-3 w-16 animate-pulse rounded-full bg-surface-2" />
              <div className="mt-4 h-7 w-24 animate-pulse rounded bg-surface-2" />
            </GlassCard>
          </div>
          <GlassCard className="h-56 p-5">
            <div className="h-3 w-24 animate-pulse rounded-full bg-surface-2" />
            <div className="mt-5 space-y-5">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-4 w-full animate-pulse rounded bg-surface-2" />
              ))}
            </div>
          </GlassCard>
        </div>
        <div className="lg:col-span-2">
          <GlassCard className="h-56 p-6">
            <div className="h-3 w-28 animate-pulse rounded-full bg-surface-2" />
            <div className="mt-5 h-12 w-full animate-pulse rounded-2xl bg-surface-2" />
            <div className="mt-5 h-12 w-full animate-pulse rounded-full bg-surface-2" />
          </GlassCard>
        </div>
      </div>
    </div>
  );
}
