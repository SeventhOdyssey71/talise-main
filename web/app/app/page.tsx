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
  SecondaryActions,
  DoMoreCard,
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

      {/* The lead: one calm balance card (eyebrow → balance → identity row →
          Send/Request inline). The remaining quick actions sit in a compact
          secondary row just beneath it. The card carries identity, so the old
          standalone identity card is gone. On lg the card pairs with the
          do-more tile so the row still reads intentional on desktop. */}
      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2 lg:items-stretch">
        <section className="space-y-3.5">
          <BalanceHero inline me={me} />
          <SecondaryActions me={me} />
        </section>
        <DoMoreCard />
      </div>

      {/* Recent activity. */}
      <RecentActivity />
    </div>
  );
}
