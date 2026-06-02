"use client";

/**
 * Home — the Talise dashboard.
 *
 * A premium fintech home, not a marketing page: a hero balance, four quick
 * actions, the user's payable identity, and a recent-activity preview.
 *
 * Layout:
 *   lg+   →  two columns inside the shell's content width — balance + quick
 *            actions + identity on the left, recent activity on the right.
 *   <lg   →  a single stacked column.
 *
 * The shell (app/app/layout.tsx) mounts <CurrencyProvider> + <ToastProvider>
 * and the responsive chrome; this page only renders the content inside <main>.
 * It reads `me` via useMe() (the same session the shell resolved server-side);
 * balances/activity refresh themselves on the global `talise:tx` event.
 */

import { useMe } from "@/components/app";
import {
  BalanceHero,
  QuickActions,
  IdentityCard,
  RecentActivity,
} from "@/components/app/home";

export default function HomePage() {
  const { me } = useMe();

  const greeting = (() => {
    const first = (me?.name ?? "").trim().split(/\s+/)[0];
    const hour = new Date().getHours();
    const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    return first ? `${part}, ${first}` : part;
  })();

  return (
    <div className="space-y-6">
      {/* Greeting — quiet, sets a personal tone above the numbers. */}
      <header className="lg:pt-1">
        <h1
          className="font-display text-[22px] font-semibold text-fg sm:text-[24px]"
          style={{ letterSpacing: "-0.03em" }}
        >
          {greeting}
        </h1>
        <p className="mt-0.5 text-[13px] text-fg-muted">Here&apos;s your money.</p>
      </header>

      {/* lg+: two-column dashboard. Mobile: single stacked column. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        {/* Left: balance, quick actions, identity */}
        <div className="space-y-4 sm:space-y-5">
          <BalanceHero />
          <QuickActions me={me} />
          <IdentityCard me={me} />
        </div>

        {/* Right: recent activity */}
        <div>
          <RecentActivity />
        </div>
      </div>
    </div>
  );
}
