"use client";

/**
 * /business — the business dashboard.
 *
 * Same wallet + data layer as /app, framed for a business: balance + payable
 * identity up top, then the three things a business does most (invoice a
 * client, pay the team, cash out), then recent activity. Renders inside the
 * BUSINESS_NAV AppShell mounted by app/business/layout.tsx.
 */

import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Invoice01Icon, UserGroupIcon, BankIcon } from "@hugeicons/core-free-icons";
import { useMe, GlassCard, Eyebrow } from "@/components/app";
import { BalanceHero, IdentityCard, RecentActivity } from "@/components/app/home";
import type { IconSvgElement } from "@hugeicons/react";

export default function BusinessDashboard() {
  const { me } = useMe();
  const first = (me?.name ?? "").trim().split(/\s+/)[0];

  return (
    <div className="space-y-6">
      <header className="lg:pt-1">
        <Eyebrow>Business</Eyebrow>
        <h1
          className="mt-1 font-display text-[22px] font-semibold text-fg sm:text-[24px]"
          style={{ letterSpacing: "-0.03em" }}
        >
          {first ? `${first}'s business` : "Your business"}
        </h1>
        <p className="mt-0.5 text-[13px] text-fg-muted">
          Get paid, pay your team, and move money — all in USDsui.
        </p>
      </header>

      {/* Balance + payable identity, like the consumer home. */}
      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-[1.4fr_1fr] lg:items-stretch lg:gap-6">
        <BalanceHero />
        <IdentityCard me={me} />
      </div>

      {/* The three business jobs-to-be-done. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <ActionCard
          href="/business/invoices"
          icon={Invoice01Icon as IconSvgElement}
          title="New invoice"
          blurb="Bill a client and get paid by link."
        />
        <ActionCard
          href="/business/team"
          icon={UserGroupIcon as IconSvgElement}
          title="Pay your team"
          blurb="Streamed salaries, funded once."
        />
        <ActionCard
          href="/business/ramps"
          icon={BankIcon as IconSvgElement}
          title="Cash out"
          blurb="USDsui to your bank, via Paga."
        />
      </div>

      <RecentActivity />
    </div>
  );
}

function ActionCard({
  href,
  icon,
  title,
  blurb,
}: {
  href: string;
  icon: IconSvgElement;
  title: string;
  blurb: string;
}) {
  return (
    <Link href={href}>
      <GlassCard className="h-full p-5 transition-colors hover:border-[color-mix(in_srgb,var(--color-accent-deep)_40%,var(--color-line))]">
        <span
          className="flex size-11 items-center justify-center rounded-2xl text-accent"
          style={{ background: "var(--color-accent-soft)" }}
        >
          <HugeiconsIcon icon={icon} size={21} strokeWidth={1.8} />
        </span>
        <h2 className="mt-4 text-[16px] font-medium tracking-[-0.02em] text-fg">{title}</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-fg-muted">{blurb}</p>
      </GlassCard>
    </Link>
  );
}
