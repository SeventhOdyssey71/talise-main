"use client";

import { motion } from "framer-motion";

/**
 * Compact "earn yield on your balance" strip on the home dashboard.
 * Reads the real NAVI supply APY (same number /earn shows). Caller passes
 * the apy as a fraction (e.g. 0.0489 = 4.89%).
 */
export function EarnStrip({
  apy,
  supplied,
}: {
  /** Current supply APY as a fraction (0.0489 = 4.89%). */
  apy: number;
  /** Current supplied amount (USDsui). Shown when > 0. */
  supplied?: number;
}) {
  if (!apy) return null;
  const aprPct = (apy * 100).toFixed(2);

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
                {aprPct}%
              </span>
              <span className="text-[12px] text-[var(--color-fg-muted)]">per year</span>
            </div>
            <div className="mt-2 text-[12px] text-[var(--color-fg-muted)]">
              {supplied && supplied > 0
                ? `you have ~$${supplied.toFixed(2)} earning · withdraw anytime`
                : "via NAVI lending · interest accrues every block · withdraw anytime"}
            </div>
          </div>

          <a
            href="/earn"
            className="rounded-md bg-[var(--color-fg)] px-4 py-2 text-[13px] font-medium text-[var(--color-bg)] transition hover:bg-[var(--color-accent-soft)]"
          >
            {supplied && supplied > 0 ? "Manage savings →" : "Start earning →"}
          </a>
        </div>
      </motion.div>
    </section>
  );
}
