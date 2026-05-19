"use client";

import { motion } from "framer-motion";

export function BalanceCard({
  usdValue,
  suiBalance,
  yieldDailyUsd = 0,
  apyBps = 640,
}: {
  usdValue: number;
  suiBalance: number;
  yieldDailyUsd?: number;
  apyBps?: number;
}) {
  const [whole, fracRaw] = usdValue.toFixed(2).split(".");
  const wholeWithCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const apyPct = (apyBps / 100).toFixed(2);
  const empty = usdValue === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
      className="relative overflow-hidden rounded-2xl border border-[var(--color-line)] bg-gradient-to-b from-[var(--color-surface)] to-[var(--color-surface-2)] p-7 md:p-9"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(212,165,116,0.18), transparent 70%)",
        }}
      />

      <div className="relative">
        <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-fg-dim)]">
          Total balance
        </div>

        <div className="mt-2 flex items-baseline gap-2">
          <span className="font-display text-[14px] text-[var(--color-fg-muted)]">$</span>
          <span className="font-display text-[64px] leading-none tracking-[-0.03em] text-[var(--color-fg)] md:text-[80px]">
            {wholeWithCommas}
          </span>
          <span className="font-display text-[28px] leading-none text-[var(--color-fg-muted)] md:text-[36px]">
            .{fracRaw}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px]">
          <span className="text-[var(--color-fg-muted)]">
            {suiBalance.toFixed(4)} SUI
          </span>
          <Dot />
          {empty ? (
            <span className="text-[var(--color-fg-dim)]">no balance yet</span>
          ) : (
            <>
              <span className="text-[var(--color-accent)]">
                + ${yieldDailyUsd.toFixed(2)} today
              </span>
              <Dot />
              <span className="text-[var(--color-fg-muted)]">
                earning at {apyPct}%
              </span>
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function Dot() {
  return <span className="h-1 w-1 rounded-full bg-[var(--color-fg-dim)]" />;
}
