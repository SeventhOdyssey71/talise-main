"use client";

import { useCallback, useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Coins01Icon, ArrowDown01Icon } from "@hugeicons/core-free-icons";
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
  // On mobile, lead with tier + referral (the actions) and tuck the lifetime
  // tallies + "how you earn" explainer behind a single disclosure. Desktop
  // keeps the full two-column layout, so this only gates the <lg view.
  const [detailsOpen, setDetailsOpen] = useState(false);

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
      {/* Page header */}
      <header className="space-y-1">
        <Eyebrow>Rewards</Eyebrow>
        <h1
          className="text-fg"
          style={{ fontSize: 26, fontWeight: 500, letterSpacing: "-0.03em" }}
        >
          Spend, save, earn
        </h1>
      </header>

      {loading ? (
        <RewardsSkeleton />
      ) : error ? (
        <GlassCard className="p-2" radius={14}>
          <EmptyState
            icon={<HugeiconsIcon icon={Coins01Icon} size={24} strokeWidth={1.6} />}
            title="Rewards are taking a break"
            subtitle={error}
            action={<PrimaryButton onClick={refresh}>Try again</PrimaryButton>}
          />
        </GlassCard>
      ) : summary ? (
        <>
          {/* Top region — tier+stats+rules (3 col) alongside referral (2 col).
              On mobile the order is tightened to tier → referral → (collapsed
              stats + rules) so the first screen leads with the actions. */}
          <div className="flex flex-col gap-5 lg:grid lg:grid-cols-5">
            <div className="order-1 space-y-4 lg:col-span-3">
              <TierCard tier={summary.tier} points={summary.pointsTotal} />
              {/* Stats + rules: always shown on lg; behind "More" on mobile. */}
              <div className={detailsOpen ? "space-y-4" : "hidden space-y-4 lg:block"}>
                <LifetimeStats
                  sentUsd={summary.lifetimeSentUsd}
                  savedUsd={summary.lifetimeSavedUsd}
                />
                <EarnRules rates={summary.pointRates} />
              </div>
            </div>
            <div className="order-2 lg:col-span-2 lg:order-none">
              <ReferralCard code={summary.code} referralCount={summary.referralCount} />
            </div>
            {!detailsOpen && (
              <button
                type="button"
                onClick={() => setDetailsOpen(true)}
                className="order-3 inline-flex w-full items-center justify-center gap-1.5 rounded-2xl border border-line bg-surface px-4 py-3 text-[14px] font-medium text-fg-muted transition-colors hover:text-fg lg:hidden"
              >
                Stats &amp; how you earn
                <HugeiconsIcon icon={ArrowDown01Icon} size={16} strokeWidth={2} />
              </button>
            )}
          </div>

          {/* Redemption catalogue spans the full width */}
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

/** Flat placeholders matching the loaded layout, so the page doesn't jump. */
function RewardsSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          {/* TierCard skeleton */}
          <GlassCard className="p-5" radius={14}>
            <div className="h-2.5 w-16 animate-pulse rounded-full bg-surface-2" />
            <div className="mt-3 h-10 w-36 animate-pulse rounded-lg bg-surface-2" />
            <div className="mt-5 h-1.5 w-full animate-pulse rounded-full bg-surface-2" />
          </GlassCard>
          {/* LifetimeStats skeleton */}
          <div className="grid grid-cols-2 gap-2.5">
            {[0, 1].map((i) => (
              <GlassCard key={i} className="p-4" radius={14}>
                <div className="h-2.5 w-16 animate-pulse rounded-full bg-surface-2" />
                <div className="mt-3 h-6 w-24 animate-pulse rounded bg-surface-2" />
              </GlassCard>
            ))}
          </div>
          {/* EarnRules skeleton */}
          <GlassCard className="overflow-hidden !p-0" radius={14}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i}>
                {i > 0 && <div className="mx-4 h-px bg-line" />}
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className="size-9 shrink-0 rounded-full bg-surface-2 animate-pulse" />
                  <div className="flex-1 h-3 w-28 rounded-full bg-surface-2 animate-pulse" />
                  <div className="h-3 w-10 rounded-full bg-surface-2 animate-pulse" />
                </div>
              </div>
            ))}
          </GlassCard>
        </div>
        {/* ReferralCard skeleton */}
        <div className="lg:col-span-2">
          <GlassCard className="space-y-4 p-5" radius={14}>
            <div className="h-2.5 w-24 animate-pulse rounded-full bg-surface-2" />
            <div className="h-11 w-full animate-pulse rounded-xl bg-surface-2" />
            <div className="h-10 w-full animate-pulse rounded-xl bg-surface-2" />
          </GlassCard>
        </div>
      </div>
    </div>
  );
}
