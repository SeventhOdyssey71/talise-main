"use client";

import Link from "next/link";

/**
 * Balance hero — mirrors the iOS Home top block.
 *
 *   Balance
 *   ₦332.58                          [+]  [➤]
 *   0.24 USDsui · Earn up to 11%
 *
 * Top-right action buttons: deposit (+) and send (paperplane). Both
 * route to existing pages today; can be replaced with sheet triggers
 * later when we add modal flows.
 */
export function BalanceCard({
  usdsui,
  primaryDisplay,
  secondaryDisplay,
}: {
  usdsui: number;
  /** Localized headline like "₦332.58". */
  primaryDisplay: string;
  /** Sub-line like "0.24 USDsui". */
  secondaryDisplay: string;
}) {
  void usdsui;
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="flex-1 min-w-0">
        <div className="text-[var(--color-fg-dim)] text-[15px] mb-0.5">Balance</div>
        <div
          className="text-[44px] leading-tight font-medium tracking-tight text-[var(--color-fg)]"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {primaryDisplay}
        </div>
        <div className="mt-1.5 flex items-center gap-2 text-[12px] font-mono">
          <span className="text-[var(--color-fg-muted)]">{secondaryDisplay}</span>
          <span className="text-[var(--color-fg-dim)]">·</span>
          <span className="text-[var(--color-accent)]">Earn up to 11%</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <ActionButton href="/receive" icon="plus" label="Deposit" />
        <ActionButton href="/send" icon="paperplane" label="Send" />
      </div>
    </div>
  );
}

function ActionButton({
  href,
  icon,
  label,
}: {
  href: string;
  icon: "plus" | "paperplane";
  label: string;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="grid place-items-center w-12 h-12 rounded-2xl bg-[var(--color-surface-2)] hover:bg-[var(--color-surface)] transition text-[var(--color-fg)]"
    >
      {icon === "plus" ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 2 11 13" />
          <path d="M22 2 15 22l-4-9-9-4z" />
        </svg>
      )}
    </Link>
  );
}
