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
      className="group flex min-h-[180px] flex-col justify-between rounded-xl border border-line bg-surface-2 p-6 transition-colors hover:border-[color-mix(in_srgb,var(--color-accent-deep)_35%,var(--color-line))] sm:p-7"
    >
      <div>
        <Eyebrow>Do more with your money</Eyebrow>
        <p className="mt-3 max-w-[22ch] text-[15px] leading-relaxed text-fg-muted">
          Put idle dollars to work and earn on your balance — withdraw anytime.
        </p>
      </div>
      <span
        className="mt-5 flex size-11 items-center justify-center rounded-full bg-accent-deep text-white transition-transform group-hover:scale-105"
        aria-hidden
      >
        <HugeiconsIcon icon={Add01Icon} size={20} strokeWidth={2.2} color="currentColor" />
      </span>
    </Link>
  );
}
