"use client";

import { useEffect, useState } from "react";

/**
 * Legacy fallback toast for the redirect-based Stripe Crypto Onramp.
 *
 * The primary success surface is now the inline message inside
 * `<OnrampModal>` — which fires off the embedded `@stripe/crypto`
 * `fulfillment_complete` event without any redirect.
 *
 * This toast is kept ONLY as a safety net: if the embedded SDK ever
 * fails to load and we fall back to opening Stripe's hosted redirect,
 * the user will still see a confirmation when they land back on
 * `/home?onramp=success`. Lower priority than before — soft, dismissible,
 * no actions.
 */
export function OnrampSuccessToast({ show }: { show: boolean }) {
  const [visible, setVisible] = useState(show);

  useEffect(() => {
    if (!show) return;
    // Strip the query param so a refresh doesn't re-show the toast.
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("onramp");
      window.history.replaceState({}, "", url.toString());
    }
    const id = setTimeout(() => setVisible(false), 8000);
    return () => clearTimeout(id);
  }, [show]);

  if (!visible) return null;

  return (
    <div
      role="status"
      className="mb-6 flex items-start justify-between gap-4 rounded-2xl border border-[#d97706]/30 bg-[#d97706]/[0.06] p-4"
    >
      <div className="min-w-0">
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#7A5A12]">
          Onramp · in flight
        </div>
        <div className="mt-1.5 text-[14px] text-[var(--color-fg)]">
          USDC is on its way — should land in your wallet within ~1 minute.
        </div>
        <div className="mt-1 text-[12px] text-[var(--color-fg-muted)]">
          Tap <span className="font-medium text-[var(--color-fg)]">Convert all</span> in the banner once it arrives.
        </div>
      </div>
      <button
        type="button"
        onClick={() => setVisible(false)}
        className="shrink-0 rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1 text-[11px] text-[var(--color-fg-muted)] transition hover:border-[var(--color-fg)] hover:text-[var(--color-fg)]"
        aria-label="Dismiss"
      >
        dismiss
      </button>
    </div>
  );
}
