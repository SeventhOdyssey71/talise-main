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

import { useState } from "react";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Copy01Icon, Tick02Icon, SentIcon, MoneyReceive02Icon } from "@hugeicons/core-free-icons";
import {
  useBalances,
  useCurrency,
  useToast,
  GlassCard,
  Eyebrow,
  type Me,
} from "@/components/app";

export function BalanceHero({ inline = false, me = null }: { inline?: boolean; me?: Me | null }) {
  const { data, loading, error, refreshFresh } = useBalances();
  const { formatLocal } = useCurrency();

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
    <div
      className="font-display font-semibold tabular-nums text-fg"
      style={{ fontSize: numberSize, lineHeight: 1.02, letterSpacing: "-0.035em" }}
    >
      {formatLocal(total)}
    </div>
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
      figure={balanceFigure}
      meta={meta}
    />
  );
}

// ── The merged Home balance card ─────────────────────────────────────────────

function BalanceCard({
  me,
  eyebrow,
  figure,
  meta,
}: {
  me: Me | null;
  eyebrow: string;
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
    <div className="rounded-3xl bg-surface p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_28px_-18px_rgba(35,78,20,0.18)] ring-1 ring-line/70 sm:p-7">
      <Eyebrow>{eyebrow}</Eyebrow>
      <div className="mt-2">{figure}</div>
      {meta}

      {/* Quiet identity row — @handle + short address with copy. */}
      <div className="mt-5 flex items-center gap-2 border-t border-line/70 pt-4 text-[12px]">
        {handle ? (
          <span className="shrink-0 font-medium text-fg">@{handle}</span>
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
          className="inline-flex items-center justify-center gap-2 rounded-full bg-accent-deep px-5 py-2.5 text-[14px] font-medium text-white shadow-[0_6px_18px_-8px_rgba(35,78,20,0.45)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-accent-deep)_88%,white)] active:scale-[0.98]"
        >
          <HugeiconsIcon icon={SentIcon} size={17} strokeWidth={2} color="currentColor" />
          Send
        </Link>
        <Link
          href="/app/pay/request"
          className="inline-flex items-center justify-center gap-2 rounded-full bg-accent-soft px-5 py-2.5 text-[14px] font-medium text-accent transition-colors hover:bg-[color-mix(in_srgb,var(--color-accent-deep)_14%,#ffffff)] active:scale-[0.98]"
        >
          <HugeiconsIcon icon={MoneyReceive02Icon} size={17} strokeWidth={2} color="currentColor" />
          Request
        </Link>
      </div>
    </div>
  );
}
