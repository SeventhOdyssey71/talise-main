"use client";

import { useState } from "react";
import { ErrorBox } from "@/components/ErrorBox";

/**
 * Pill button that opens a Stripe Crypto Onramp session in a new tab.
 *
 * Two sizes via `compact`:
 *   - compact: toolbar-sized pill that sits next to the "live" indicator.
 *   - full: hero-sized button suitable for a balance row.
 *
 * Stripe brand-purple is deliberately avoided — we keep the black/white
 * aesthetic. The "Stripe · secure card" caption is the only nod to the
 * provider.
 */
export function TopUpButton({
  amount = 20,
  compact = false,
}: {
  /** Fiat amount in USD. Defaults to $20. */
  amount?: number;
  /** Compact toolbar variant. Defaults to full-size. */
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const r = await fetch("/api/onramp/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        redirectUrl?: string;
        error?: string;
      };
      if (!r.ok || !j.redirectUrl) {
        throw new Error(j.error ?? `Onramp failed (HTTP ${r.status})`);
      }
      // Short "opening Stripe…" affordance so the user understands the new
      // tab that's about to open isn't unsolicited.
      setOpening(true);
      window.open(j.redirectUrl, "_blank", "noopener,noreferrer");
      setTimeout(() => setOpening(false), 1000);
    } catch (e) {
      setError((e as Error).message ?? "Could not start onramp.");
    } finally {
      setBusy(false);
    }
  }

  if (compact) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={onClick}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-line)] bg-[var(--color-fg)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-bg)] transition hover:bg-[var(--color-accent-soft)] disabled:cursor-not-allowed disabled:opacity-60"
          aria-label="Top up with card"
        >
          <CardIcon />
          {opening ? "Opening Stripe…" : busy ? "…" : "Top up with card"}
        </button>
        <span className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--color-fg-dim)]">
          <LockIcon /> Stripe · secure card
        </span>
        {error && (
          <div className="mt-1 w-64">
            <ErrorBox message={error} onRetry={() => setError(null)} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="inline-flex w-fit items-center gap-2 rounded-full bg-[var(--color-fg)] px-5 py-2.5 text-[13px] font-medium text-[var(--color-bg)] transition hover:bg-[var(--color-accent-soft)] disabled:cursor-not-allowed disabled:opacity-60"
        aria-label="Top up with card"
      >
        <CardIcon />
        {opening ? "Opening Stripe…" : busy ? "Starting…" : "Top up with card"}
      </button>
      <span className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--color-fg-dim)]">
        <LockIcon /> Stripe · secure card
      </span>
      {error && <ErrorBox message={error} onRetry={() => setError(null)} />}
    </div>
  );
}

function CardIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg
      width="8"
      height="8"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
