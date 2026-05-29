"use client";

import { motion } from "framer-motion";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01FreeIcons } from "@hugeicons/core-free-icons";

/**
 * Compact earn card that sits next to the balance card in /home's hero
 * row. Same height + visual weight so the two read as a pair.
 *
 * Renders nothing when there's no APY signal yet (so we never show a
 * "0.00%" placeholder which would look broken).
 */
export function EarnCard({
  apy,
  supplied,
}: {
  /** Live supply APY as a fraction (0.0427 = 4.27%). */
  apy: number;
  /** USDsui currently supplied. */
  supplied?: number;
}) {
  if (!apy) return null;
  const aprPct = (apy * 100).toFixed(2);
  const supplying = (supplied ?? 0) > 0;
  const dailyYield = supplying ? (supplied! * apy) / 365 : 0;

  return (
    <motion.a
      href="/earn"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.05, ease: [0.2, 0.8, 0.2, 1] }}
      className="group relative flex h-full flex-col justify-between overflow-hidden rounded-2xl border border-[#e8e1cf] bg-white p-6 transition hover:border-[#1a1a1a] md:p-7"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-[#21A179]/8 blur-3xl"
      />

      <div className="relative">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#8a8472]">
          Earn yield
        </div>

        <div className="mt-2.5 flex items-baseline gap-1.5">
          <span className="text-[36px] font-medium leading-[1] tracking-[-0.03em] text-[#111] md:text-[44px]">
            {aprPct}%
          </span>
          <span className="font-mono text-[11px] text-[#8a8472]">apy</span>
        </div>

        {supplying ? (
          <div className="mt-3 space-y-0.5 font-mono text-[11px] text-[#5a554a]">
            <div>${supplied!.toFixed(2)} earning</div>
            <div className="text-[#8a8472]">+${dailyYield.toFixed(3)}/day</div>
          </div>
        ) : (
          <div className="mt-3 text-[12px] leading-[1.45] text-[#5a554a]">
            Move idle USDsui into yield. Withdraw anytime.
          </div>
        )}
      </div>

      <div className="relative mt-5 inline-flex items-center gap-1.5 text-[12px] font-medium text-[#111]">
        {supplying ? "Manage" : "Start earning"}
        <span className="transition group-hover:translate-x-0.5">
          <HugeiconsIcon
            icon={ArrowRight01FreeIcons}
            size={13}
            strokeWidth={2}
            color="currentColor"
          />
        </span>
      </div>
    </motion.a>
  );
}
