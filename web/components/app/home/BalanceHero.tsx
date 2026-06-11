"use client";

/**
 * Hero balance block. Two forms:
 *   • inline (Home) — a single calm BALANCE CARD: "Your balance" eyebrow → big
 *     ink figure → a quiet identity row (@handle + short address with copy) →
 *     two inline actions (Send solid accent, Request soft mint). The loose
 *     stack (bare number + action discs + separate identity card) is merged
 *     into this one card so Home reads calm on mobile.
 *   • carded (Business dashboard) — the same balance content inside a GlassCard
 *     so it pairs with the identity card at equal height (no identity row /
 *     actions; those live in the dashboard's own composition).
 * Pulls fresh once after first paint so the snapshot number reconciles against
 * live chain state without making the user wait on cold open.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Copy01Icon,
  Tick02Icon,
  SentIcon,
  MoneyReceive02Icon,
  ViewIcon,
  ViewOffSlashIcon,
} from "@hugeicons/core-free-icons";
import {
  useBalances,
  useCurrency,
  useToast,
  useHiddenAmounts,
  MASK_BALANCE,
  GlassCard,
  Eyebrow,
  Flag,
  type Me,
} from "@/components/app";
import { CC } from "@/lib/fx";
import { CURRENCIES } from "../data/currency";

export function BalanceHero({ inline = false, me = null }: { inline?: boolean; me?: Me | null }) {
  const { data, loading, error, refreshFresh } = useBalances();
  const { formatLocal, currency, setCurrency } = useCurrency();
  const { hidden, toggle } = useHiddenAmounts();

  // Country flag + code chip for the active display currency. Only currencies
  // we have a mapped ISO country code for get a flag (safe: <Flag> renders
  // nothing for an unknown code).
  const flagCode = CC[currency] ?? null;

  // NOTE: no forced fresh=1 read on mount. The balance loads instantly from the
  // display-only snapshot (useBalances → useResource revalidates in the
  // background), and a completed transaction force-refreshes via the global
  // `talise:tx` listener. Forcing a live chain read on every home visit blocked
  // the page for seconds when the RPC was slow. The tap targets below still
  // offer an explicit fresh refresh.

  const showSkeleton = loading && !data;
  const showError = !!error && !data;
  const usdsui = data?.usdsui ?? 0;
  const total = data?.totalUsd ?? 0;
  const usdsuiLine =
    usdsui < 0.01 ? `${usdsui.toFixed(4)} USDsui` : `${usdsui.toFixed(2)} USDsui`;

  // When hidden, keep the leading currency symbol from the formatted figure
  // visible (e.g. "$") and mask only the digits — so the chip still reads as money.
  const formattedTotal = formatLocal(total);
  const symbolPrefix = formattedTotal.match(/^[^\d]*/)?.[0] ?? "";
  const maskedBalance = `${symbolPrefix}${MASK_BALANCE}`;

  const numberSize = inline ? 44 : 40;

  const balanceFigure = showSkeleton ? (
    <div
      className="animate-pulse rounded-xl"
      style={{ width: 240, height: numberSize, background: "var(--color-surface-2)" }}
      aria-label="Loading balance"
    />
  ) : showError ? (
    <button
      type="button"
      onClick={() => void refreshFresh()}
      className="font-display font-semibold tabular-nums text-fg-dim"
      style={{ fontSize: numberSize, lineHeight: 1.02, letterSpacing: "-0.035em" }}
      aria-label="Couldn't load balance — tap to retry"
    >
      —
    </button>
  ) : (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
      <button
        type="button"
        onClick={toggle}
        className="group inline-flex items-baseline gap-2 text-left"
        aria-label={hidden ? "Show balance" : "Hide balance"}
        aria-pressed={hidden}
      >
        <span
          className="font-display font-semibold tabular-nums text-fg"
          style={{ fontSize: numberSize, lineHeight: 1.02, letterSpacing: "-0.035em" }}
        >
          {hidden ? maskedBalance : formatLocal(total)}
        </span>
        <HugeiconsIcon
          icon={hidden ? ViewOffSlashIcon : ViewIcon}
          size={18}
          strokeWidth={2}
          className="self-center text-fg-dim transition-colors group-hover:text-fg-muted"
        />
      </button>
    </div>
  );

  // Currency SWITCHER — the flag chip on the eyebrow row opens a small menu
  // of display currencies (display-only; the wallet settles in USDsui).
  const currencyChip = (
    <CurrencySwitcher currency={currency} flagCode={flagCode} onPick={setCurrency} />
  );

  const meta = showError ? (
    <button
      type="button"
      onClick={() => void refreshFresh()}
      className="mt-3 text-left font-mono text-[11px] text-fg-dim underline-offset-2 hover:text-fg-muted"
    >
      Couldn&apos;t load balance — tap to retry
    </button>
  ) : (
    <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1">
      {showSkeleton ? (
        <span className="animate-pulse rounded-full" style={{ width: 96, height: 12, background: "var(--color-surface-2)" }} />
      ) : (
        <span className="font-mono text-[12px] tabular-nums text-fg-muted">{usdsuiLine}</span>
      )}
      <span className="font-mono text-[12px] text-fg-dim">·</span>
      <Link
        href="/app/earn"
        className="font-mono text-[12px] font-medium tracking-[-0.01em] text-accent underline-offset-2 hover:underline"
      >
        Earn on idle balance
      </Link>
    </div>
  );

  // ── Business dashboard form: balance content inside a GlassCard. ───────────
  if (!inline) {
    return (
      <GlassCard className="flex h-full flex-col justify-center px-6 py-7 sm:px-8 sm:py-8" radius={14}>
        <Eyebrow>Total balance</Eyebrow>
        <div className="mt-2">{balanceFigure}</div>
        {meta}
      </GlassCard>
    );
  }

  // ── Home form: one clean balance card with identity + inline actions. ──────
  return (
    <BalanceCard
      me={me}
      eyebrow="Your balance"
      trailing={currencyChip}
      figure={balanceFigure}
      meta={meta}
    />
  );
}

// ── The merged Home balance card ─────────────────────────────────────────────

function BalanceCard({
  me,
  eyebrow,
  trailing,
  figure,
  meta,
}: {
  me: Me | null;
  eyebrow: string;
  /** Right-aligned chip on the eyebrow row (the currency flag). */
  trailing?: React.ReactNode;
  figure: React.ReactNode;
  meta: React.ReactNode;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const address = me?.suiAddress ?? "";
  const short = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "—";
  const handle = me?.taliseHandle ?? null;

  async function copyAddress() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      toast("Address copied", "success");
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast("Couldn't copy address", "danger");
    }
  }

  return (
    <div className="flex h-full flex-col rounded-3xl bg-surface p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_28px_-18px_rgba(35,78,20,0.18)] ring-1 ring-line/70 sm:p-7">
      <div className="flex items-center justify-between gap-3">
        <Eyebrow>{eyebrow}</Eyebrow>
        {trailing}
      </div>
      <div className="mt-2">{figure}</div>
      {meta}

      {/* Quiet identity row — @handle + short address with copy. mt-auto pins
          identity+actions to the card's bottom when the grid stretches it. */}
      <div className="mt-5 flex items-center gap-2 border-t border-line/70 pt-4 text-[12px] lg:mt-auto lg:pt-4">
        {handle ? (
          <span className="shrink-0 font-medium text-fg">{handle}@talise</span>
        ) : (
          <Link href="/app/settings#username" className="shrink-0 font-medium text-accent hover:underline">
            Claim your @name
          </Link>
        )}
        {handle && <span className="text-fg-dim">·</span>}
        <button
          type="button"
          onClick={copyAddress}
          disabled={!address}
          className="group inline-flex min-w-0 items-center gap-1.5 disabled:opacity-50"
          aria-label="Copy address"
        >
          <span className="truncate font-mono text-fg-muted">{short}</span>
          <HugeiconsIcon
            icon={copied ? Tick02Icon : Copy01Icon}
            size={13}
            strokeWidth={2}
            color={copied ? "var(--color-accent)" : undefined}
            className={copied ? "" : "text-fg-dim transition-colors group-hover:text-fg-muted"}
          />
        </button>
      </div>

      {/* Inline primary actions — Send (solid accent) + Request (soft mint). */}
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <Link
          href="/app/pay"
          className="inline-flex items-center justify-center gap-2 rounded-full bg-accent-deep px-5 py-2.5 text-[14px] font-medium text-white shadow-[0_6px_18px_-8px_rgba(35,78,20,0.45)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-accent-deep)_88%,white)] active:scale-[0.98] outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--color-accent-deep)_55%,transparent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]"
        >
          <HugeiconsIcon icon={SentIcon} size={17} strokeWidth={2} color="currentColor" />
          Send
        </Link>
        <Link
          href="/app/pay/request"
          className="inline-flex items-center justify-center gap-2 rounded-full bg-accent-soft px-5 py-2.5 text-[14px] font-medium text-accent transition-colors hover:bg-[color-mix(in_srgb,var(--color-accent-deep)_14%,#ffffff)] active:scale-[0.98] outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--color-accent-deep)_45%,transparent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]"
        >
          <HugeiconsIcon icon={MoneyReceive02Icon} size={17} strokeWidth={2} color="currentColor" />
          Request
        </Link>
      </div>
    </div>
  );
}

// ── Currency switcher chip ───────────────────────────────────────────────────

/** Flag chip → dropdown of display currencies. Display-only: changes how
 *  balances/amounts are SHOWN; the wallet always settles in USDsui. */
function CurrencySwitcher({
  currency,
  flagCode,
  onPick,
}: {
  currency: string;
  flagCode: string | null;
  onPick: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Change display currency"
        className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2 py-0.5 transition-colors hover:bg-[color-mix(in_srgb,var(--color-accent-deep)_10%,var(--color-surface-2))] outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--color-accent-deep)_45%,transparent)]"
      >
        {flagCode && <Flag code={flagCode} size={16} />}
        <span className="font-mono text-[11px] font-medium tracking-[0.02em] text-fg-muted">
          {currency}
        </span>
        <svg width="8" height="5" viewBox="0 0 8 5" aria-hidden className="text-fg-dim">
          <path d="M1 1l3 3 3-3" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label="Display currency"
          className="absolute right-0 z-30 mt-2 max-h-72 w-52 overflow-y-auto rounded-2xl bg-surface p-1.5 shadow-[0_2px_6px_rgba(0,0,0,0.06),0_16px_40px_-16px_rgba(35,78,20,0.3)] ring-1 ring-line/80"
        >
          {CURRENCIES.map((c) => {
            const cc = CC[c.code] ?? null;
            const active = c.code === currency;
            return (
              <li key={c.code}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onPick(c.code);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors ${
                    active ? "bg-accent-soft" : "hover:bg-surface-2"
                  }`}
                >
                  {cc ? <Flag code={cc} size={18} /> : <span className="size-[18px]" />}
                  <span className={`text-[13px] ${active ? "font-medium text-accent" : "text-fg"}`}>
                    {c.label}
                  </span>
                  <span className="ml-auto font-mono text-[11px] text-fg-dim">{c.code}</span>
                </button>
              </li>
            );
          })}
          <li className="mt-1 border-t border-line/70 px-2.5 py-1.5 font-mono text-[10px] text-fg-dim">
            Display only — you hold USDsui
          </li>
        </ul>
      )}
    </div>
  );
}
