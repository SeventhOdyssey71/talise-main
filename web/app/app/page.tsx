"use client";

/**
 * Home — the Talise dashboard, Wise-clean.
 *
 * Leads with the balance on the canvas (not in a card), then the primary money
 * actions as pills, then two tiles (your payable identity + a "do more" Earn
 * nudge), then recent activity. Single stacked column on mobile; the two tiles
 * sit side-by-side on lg.
 *
 * The shell (app/app/layout.tsx) mounts the providers + chrome; this page only
 * renders content inside <main>. `me` comes from useMe(); balances/activity
 * refresh on the global `talise:tx` event.
 */

import { useMe } from "@/components/app";
import {
  BalanceHero,
  ActionPills,
  DoMoreCard,
  IdentityCard,
  RecentActivity,
} from "@/components/app/home";

export default function HomePage() {
  const { me } = useMe();
  const first = (me?.name ?? "").trim().split(/\s+/)[0];

  return (
    <div className="space-y-8">
      {/* Greeting — quiet, personal, above the balance. */}
      {first ? (
        <p className="text-[13px] text-fg-dim">Welcome back, {first}.</p>
      ) : null}

      {/* Balance + primary actions — the Wise lead. One action row, no
          redundant tiles. Receive opens its sheet from the pill. */}
      <section className="space-y-5">
        <BalanceHero inline />
        <ActionPills me={me} />
      </section>

      {/* Two tiles: payable identity + do-more. */}
      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2 lg:items-stretch">
        <IdentityCard me={me} />
        <DoMoreCard />
      </div>

      {/* Recent activity. */}
      <RecentActivity />
    </div>
  );
}
