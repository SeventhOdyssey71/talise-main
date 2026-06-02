"use client";

/**
 * Hero balance block — the first thing on Home. Big localized total with the
 * underlying "X.XX USDsui" sub-line and a mint "Earn up to 11%" nudge. We
 * pull-fresh once after the first paint so the snapshot-backed number gets
 * corrected against live chain state without making the user wait on cold open.
 */

import { useEffect, useRef } from "react";
import { useBalances, useCurrency, GlassCard, Eyebrow } from "@/components/app";

const APY_HEADLINE = 11; // matches iOS apyHeadline (0.11)

export function BalanceHero() {
  const { data, loading, refreshFresh } = useBalances();
  const { formatLocal } = useCurrency();
  const pulled = useRef(false);

  // Pull-fresh exactly once, just after first paint, so the display-only
  // snapshot is reconciled against a live read. Subsequent freshes are driven
  // by the global `talise:tx` event inside useBalances.
  useEffect(() => {
    if (pulled.current) return;
    pulled.current = true;
    const t = window.setTimeout(() => void refreshFresh(), 120);
    return () => window.clearTimeout(t);
  }, [refreshFresh]);

  const showSkeleton = loading && !data;
  const usdsui = data?.usdsui ?? 0;
  const total = data?.totalUsd ?? 0;

  const usdsuiLine =
    usdsui < 0.01 ? `${usdsui.toFixed(4)} USDsui` : `${usdsui.toFixed(2)} USDsui`;

  return (
    <GlassCard className="px-6 py-7 sm:px-8 sm:py-8" radius={26}>
      <Eyebrow>Balance</Eyebrow>

      <div className="mt-3">
        {showSkeleton ? (
          <div
            className="animate-pulse rounded-2xl"
            style={{ width: 220, height: 46, background: "var(--color-surface-2)" }}
            aria-label="Loading balance"
          />
        ) : (
          <div
            className="font-display font-semibold tabular-nums text-fg"
            style={{
              fontSize: 46,
              lineHeight: 1.02,
              letterSpacing: "-0.035em",
            }}
          >
            {formatLocal(total)}
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1">
        {showSkeleton ? (
          <span className="animate-pulse rounded-full" style={{ width: 96, height: 12, background: "var(--color-surface-2)" }} />
        ) : (
          <span className="font-mono text-[11px] tabular-nums text-fg-muted">{usdsuiLine}</span>
        )}
        <span className="font-mono text-[11px] text-fg-dim">·</span>
        <span className="font-mono text-[11px] font-medium tracking-[-0.01em] text-accent">
          Earn up to {APY_HEADLINE}%
        </span>
      </div>
    </GlassCard>
  );
}
