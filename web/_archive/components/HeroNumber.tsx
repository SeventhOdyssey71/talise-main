"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Reusable centered hero number used by /home, /earn, /rewards. Same
 * type scale, same entrance animation, same caption-below pattern —
 * so every "this is the headline metric on this page" lands the same.
 */
export function HeroNumber({
  value,
  caption,
  tabs,
  /** Re-key the animation when the value/asset changes. */
  animationKey,
}: {
  value: string;
  caption?: ReactNode;
  tabs?: ReactNode;
  animationKey?: string;
}) {
  return (
    <div className="text-center">
      {tabs}
      <motion.div
        key={animationKey ?? value}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
        className={tabs ? "mt-6" : "mt-0"}
      >
        <div className="font-display text-[56px] font-medium leading-[1] tracking-[-0.04em] text-[var(--color-fg)] md:text-[88px] lg:text-[104px]">
          {value}
        </div>
        {caption && (
          <div className="mt-4 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-fg-muted)]">
            {caption}
          </div>
        )}
      </motion.div>
    </div>
  );
}

/**
 * Pill-style tab strip — used above HeroNumber to switch asset / venue /
 * timeframe. Stays generic so each page can drive its own keys.
 */
export function HeroTabs<K extends string>({
  active,
  items,
  onChange,
}: {
  active: K;
  items: Array<{ key: K; label: string }>;
  onChange: (k: K) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] p-1">
      {items.map((it) => {
        const on = it.key === active;
        return (
          <button
            key={it.key}
            type="button"
            onClick={() => onChange(it.key)}
            className={`rounded-full px-3.5 py-1.5 text-[12px] font-medium transition ${
              on
                ? "bg-[var(--color-fg)] text-[var(--color-bg)]"
                : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
            }`}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Small stat card — eyebrow + big mono-ish number + optional sub. Used in
 * the stat row across pages. Optional `accent` color dot in the eyebrow
 * lets pages tie multiple cards to a sparkline.
 */
export function StatCard({
  eyebrow,
  value,
  sub,
  accent,
}: {
  eyebrow: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-fg-dim)]">
        {accent && (
          <span
            className="inline-flex h-1.5 w-1.5 rounded-full"
            style={{ background: accent }}
          />
        )}
        {eyebrow}
      </div>
      <div className="mt-3 text-[24px] font-medium leading-[1.1] tracking-[-0.02em] text-[var(--color-fg)] md:text-[28px]">
        {value}
      </div>
      {sub && (
        <div className="mt-1 font-mono text-[11px] text-[var(--color-fg-muted)]">
          {sub}
        </div>
      )}
    </div>
  );
}
