"use client";

/**
 * EARN — the money-management hub.
 *
 *   • Invest idle cash (NAVI) — live venue cards, supply, withdraw.
 *   • Spend & Save — round-up, savings goals, month-to-date insights.
 *   • A clear entry into Rewards & Referrals (/app/earn/rewards).
 *
 * Desktop is a two-column layout (Invest on the left, Spend & Save on the
 * right); mobile stacks everything in a single column.
 */

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  GiftCardIcon,
  ArrowRight02Icon,
  ArrowDown01Icon,
} from "@hugeicons/core-free-icons";
import Link from "next/link";
import { GlassCard } from "@/components/app";
import { SupplyCard } from "@/components/app/earn/SupplyCard";
import { RoundupCard } from "@/components/app/earn/RoundupCard";
import { GoalsSection } from "@/components/app/earn/GoalsSection";
import { InsightsSection } from "@/components/app/earn/InsightsSection";

export default function EarnPage() {
  // Mobile keeps the lead clear — Earn (Supply) + Rewards + Round-up. Goals and
  // Insights are real but secondary, so on phones they sit behind a single
  // "More" disclosure rather than extending the scroll. Desktop shows the full
  // two-column layout unchanged.
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <div className="space-y-6">
      {/* min-w-0 on the grid columns: grid items default to min-width:auto and
          refuse to shrink below their widest child, which pushed every card
          past the phone viewport (clipped right edges on mobile). min-w-0 lets
          the columns — and therefore the cards — actually fit the screen. */}
      <div className="grid gap-6 lg:grid-cols-2 lg:items-start lg:gap-8">
        {/* Invest */}
        <div className="min-w-0 space-y-5">
          <SupplyCard />
        </div>

        {/* Spend & Save */}
        <div className="min-w-0 space-y-5">
          <RewardsLink />
          <RoundupCard />

          {/* Goals + Insights — always visible on lg; collapsed behind a
              "More" toggle on mobile to keep the first screen calm. */}
          <div className={moreOpen ? "space-y-5" : "hidden space-y-5 lg:block"}>
            <GoalsSection />
            <InsightsSection />
          </div>

          {!moreOpen && (
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-2xl border border-line bg-surface px-4 py-3 text-[14px] font-medium text-fg-muted transition-colors hover:text-fg lg:hidden"
            >
              Goals &amp; insights
              <HugeiconsIcon icon={ArrowDown01Icon} size={16} strokeWidth={2} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Tappable banner linking to the Rewards & Referrals surface. */
function RewardsLink() {
  return (
    <GlassCard as="div" interactive radius={14} className="!p-0">
      <Link
        href="/app/earn/rewards"
        className="group flex items-center gap-3.5 px-4 py-3.5"
      >
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent"
        >
          <HugeiconsIcon icon={GiftCardIcon} size={17} strokeWidth={1.8} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-medium tracking-[-0.01em] text-fg">
            Rewards &amp; Referrals
          </span>
          <span className="block truncate text-[12px] text-fg-muted">
            Earn points on every payment — redeem perks, invite friends.
          </span>
        </span>
        <HugeiconsIcon
          icon={ArrowRight02Icon}
          size={16}
          className="shrink-0 text-fg-dim transition-transform group-hover:translate-x-0.5"
          strokeWidth={2}
        />
      </Link>
    </GlassCard>
  );
}
