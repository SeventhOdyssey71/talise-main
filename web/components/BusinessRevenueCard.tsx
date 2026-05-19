"use client";

import { motion } from "framer-motion";

export function BusinessRevenueCard({
  usdsuiRevenue,
  totalUsd,
  suiPrice,
}: {
  usdsuiRevenue: number;
  totalUsd: number;
  suiPrice: number;
}) {
  const [whole, fracRaw] = totalUsd.toFixed(2).split(".");
  const wholeWithCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const empty = totalUsd === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
      className="relative overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-fg)] p-7 text-[var(--color-bg)] md:p-9"
    >
      <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-bg)]/60">
        Today&apos;s revenue
      </div>

      <div className="mt-2 flex items-baseline gap-2">
        <span className="font-mono text-[14px] text-[var(--color-bg)]/60">$</span>
        <span className="font-mono text-[60px] font-medium leading-none tracking-[-0.04em] md:text-[76px]">
          {wholeWithCommas}
        </span>
        <span className="font-mono text-[28px] leading-none text-[var(--color-bg)]/60 md:text-[34px]">
          .{fracRaw}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px]">
        <span className="font-mono text-[var(--color-bg)]/70">
          {usdsuiRevenue.toFixed(2)} USDsui
        </span>
        {suiPrice > 0 && (
          <>
            <span className="text-[var(--color-bg)]/40">·</span>
            <span className="text-[var(--color-bg)]/70 font-mono">
              SUI ${suiPrice.toFixed(3)}
            </span>
          </>
        )}
        {empty && (
          <>
            <span className="text-[var(--color-bg)]/40">·</span>
            <span className="text-[var(--color-bg)]/50">
              no payments received yet
            </span>
          </>
        )}
      </div>

      <div className="mt-6 grid grid-cols-3 gap-3 border-t border-[var(--color-bg)]/15 pt-5">
        <Stat label="Yesterday" value="$0.00" />
        <Stat label="This week" value="$0.00" />
        <Stat label="This month" value="$0.00" />
      </div>
    </motion.div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--color-bg)]/50">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-[15px]">{value}</div>
    </div>
  );
}
