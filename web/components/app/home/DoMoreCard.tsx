"use client";

/**
 * "Do more with your money" — the companion card beside the identity card on
 * Home (mirrors Wise's right-hand tile). Nudges idle balance into Earn with a
 * single forest + button. Soft-fill card, calm copy.
 */

import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";
import { Eyebrow } from "@/components/app";

export function DoMoreCard() {
  return (
    <Link
      href="/app/earn"
      className="group flex h-full min-h-[180px] flex-col justify-between rounded-3xl bg-surface p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_28px_-18px_rgba(35,78,20,0.18)] ring-1 ring-line/70 transition-shadow hover:shadow-[0_2px_4px_rgba(0,0,0,0.05),0_12px_32px_-16px_rgba(35,78,20,0.26)] sm:p-7 outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--color-accent-deep)_55%,transparent)]"
    >
      <div>
        <Eyebrow>Do more with your money</Eyebrow>
        <p className="mt-3 max-w-[24ch] text-[15px] leading-relaxed text-fg-muted">
          Put idle dollars to work and earn on your balance — withdraw anytime.
        </p>
      </div>
      <span className="mt-5 inline-flex items-center gap-3">
        <span
          className="flex size-11 items-center justify-center rounded-full bg-accent-deep text-white transition-transform group-hover:scale-105"
          aria-hidden
        >
          <HugeiconsIcon icon={Add01Icon} size={20} strokeWidth={2.2} color="currentColor" />
        </span>
        <span className="text-[14px] font-medium text-accent">Start earning</span>
      </span>
    </Link>
  );
}
