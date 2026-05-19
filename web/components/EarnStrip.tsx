"use client";

import { motion } from "framer-motion";
import type { MarginPoolInfo } from "@/lib/deepbook";

export function EarnStrip({ marginUsdc }: { marginUsdc: MarginPoolInfo | null }) {
  if (!marginUsdc) return null;
  const apr = (marginUsdc.supplyApr * 100).toFixed(2);
  const util = (marginUsdc.utilization * 100).toFixed(0);

  return (
    <section className="mt-12">
      <h2 className="text-[11px] uppercase tracking-[0.2em] text-[var(--color-fg-dim)]">
        Earn on your balance
      </h2>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="mt-4 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-6"
      >
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-dim)]">
              Earn yield on your savings
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="font-display text-[44px] leading-none tracking-[-0.02em] text-[var(--color-fg)]">
                {apr}%
              </span>
              <span className="text-[12px] text-[var(--color-fg-muted)]">per year</span>
            </div>
            <div className="mt-2 text-[12px] text-[var(--color-fg-muted)]">
              live rate · interest accrues instantly · withdraw anytime
            </div>
          </div>

          <a
            href="/earn"
            className="rounded-md bg-[var(--color-fg)] px-4 py-2 text-[13px] font-medium text-[var(--color-bg)] transition hover:bg-[var(--color-accent-soft)]"
          >
            Start earning →
          </a>
        </div>
      </motion.div>
    </section>
  );
}
