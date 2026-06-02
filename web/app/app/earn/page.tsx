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

import { HugeiconsIcon } from "@hugeicons/react";
import { GiftCardIcon, ArrowRight02Icon } from "@hugeicons/core-free-icons";
import Link from "next/link";
import { SupplyCard } from "@/components/app/earn/SupplyCard";
import { RoundupCard } from "@/components/app/earn/RoundupCard";
import { GoalsSection } from "@/components/app/earn/GoalsSection";
import { InsightsSection } from "@/components/app/earn/InsightsSection";

export default function EarnPage() {
  return (
    <div className="space-y-8">
      <div className="grid gap-8 lg:grid-cols-2 lg:items-start lg:gap-10">
        {/* Invest */}
        <div className="space-y-6">
          <SupplyCard />
        </div>

        {/* Spend & Save */}
        <div className="space-y-6">
          <RewardsLink />
          <RoundupCard />
          <GoalsSection />
          <InsightsSection />
        </div>
      </div>
    </div>
  );
}

/** Tappable banner linking to the Rewards & Referrals surface. */
function RewardsLink() {
  return (
    <Link
      href="/app/earn/rewards"
      className="talise-glass group flex items-center gap-3.5 px-4 py-3.5 transition-[transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-white/15"
      style={{ borderRadius: 20 }}
    >
      <span
        className="flex size-10 shrink-0 items-center justify-center rounded-full text-accent"
        style={{ background: "color-mix(in srgb, var(--color-accent) 12%, transparent)" }}
      >
        <HugeiconsIcon icon={GiftCardIcon} size={19} strokeWidth={1.8} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium tracking-[-0.01em] text-fg">
          Rewards &amp; Referrals
        </span>
        <span className="block truncate text-[13px] text-fg-muted">
          Earn points on every payment — redeem perks, invite friends.
        </span>
      </span>
      <HugeiconsIcon
        icon={ArrowRight02Icon}
        size={18}
        className="shrink-0 text-fg-dim transition-transform group-hover:translate-x-0.5"
        strokeWidth={2}
      />
    </Link>
  );
}
