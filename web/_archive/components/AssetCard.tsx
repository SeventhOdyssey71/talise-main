"use client";

import { motion } from "framer-motion";

export type AssetCardData = {
  symbol: string;
  name: string;
  /** Human-readable balance (e.g. "120.4521" or "0.054 oz"). Empty string → 0. */
  balance: string;
  /** Display unit ("SUI", "USDC", "oz"). */
  unit: string;
  /** USD value (number). */
  usdValue: number;
  /** "+0.42%" style or null. */
  changeLabel?: string | null;
  /** Yield strip ("Earning ~6.4% via DeepBook Margin") */
  yieldNote?: string | null;
  /** When true: render as a "coming soon" disabled card with copy. */
  comingSoon?: boolean;
  /** Optional href for the card click action (e.g. /send?asset=SUI). */
  href?: string;
};

export function AssetCard(p: AssetCardData) {
  const Inner = (
    <motion.div
      whileHover={p.comingSoon ? undefined : { y: -3 }}
      transition={{ duration: 0.2 }}
      className={`group relative flex h-full flex-col rounded-xl border border-[var(--color-line)] p-5 ${
        p.comingSoon
          ? "bg-[var(--color-surface)]/40"
          : "bg-[var(--color-surface)] hover:border-[var(--color-accent)]"
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <AssetGlyph symbol={p.symbol} muted={p.comingSoon} />
          <div className="leading-tight">
            <div
              className={`text-[14px] font-medium ${
                p.comingSoon ? "text-[var(--color-fg-muted)]" : "text-[var(--color-fg)]"
              }`}
            >
              {p.name}
            </div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-dim)]">
              {p.symbol}
            </div>
          </div>
        </div>
        {p.comingSoon && (
          <span className="rounded-full border border-[var(--color-line)] bg-[var(--color-bg)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--color-fg-dim)]">
            soon
          </span>
        )}
      </div>

      <div className="mt-6">
        <div
          className={`font-display text-[26px] leading-none tracking-[-0.02em] ${
            p.comingSoon ? "text-[var(--color-fg-muted)]" : "text-[var(--color-fg)]"
          }`}
        >
          ${p.usdValue.toFixed(2)}
        </div>
        <div className="mt-1.5 flex items-center gap-2 text-[12px]">
          <span className="font-mono text-[var(--color-fg-muted)]">
            {p.balance || "0.0000"} {p.unit}
          </span>
          {p.changeLabel && (
            <>
              <span className="h-1 w-1 rounded-full bg-[var(--color-fg-dim)]" />
              <span className="text-[var(--color-accent)]">{p.changeLabel}</span>
            </>
          )}
        </div>
      </div>

      {p.yieldNote && (
        <div className="mt-auto pt-5">
          <div className="rounded-md border border-dashed border-[var(--color-line)] px-2.5 py-2 text-[11px] text-[var(--color-fg-muted)]">
            <span className="text-[var(--color-accent)]">●</span> {p.yieldNote}
          </div>
        </div>
      )}
    </motion.div>
  );

  if (p.href && !p.comingSoon) {
    return (
      <a href={p.href} className="block">
        {Inner}
      </a>
    );
  }
  return Inner;
}

function AssetGlyph({ symbol, muted }: { symbol: string; muted?: boolean }) {
  return (
    <div
      className="flex h-9 w-9 items-center justify-center rounded-full font-mono text-[10px] text-[var(--color-bg)]"
      style={{
        background: muted
          ? "linear-gradient(135deg, #888, #555)"
          : "linear-gradient(135deg, var(--color-accent), var(--color-accent-soft))",
        opacity: muted ? 0.4 : 1,
      }}
    >
      {symbol.slice(0, 3)}
    </div>
  );
}
