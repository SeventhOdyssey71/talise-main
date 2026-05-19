"use client";

import { useEffect, useState } from "react";

/**
 * One-time toast that confirms the user came back from Stripe Crypto Onramp.
 * Reads `?onramp=success` from the URL and auto-dismisses after 8 seconds.
 *
 * Uses the same soft-amber palette as AutoConvertBanner so the two banners
 * feel like the same family — onramp lands, banner sweeps to USDsui.
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
      className="mb-6 flex items-start justify-between gap-4 rounded-2xl border border-[#F6C66D]/40 bg-[#F6C66D]/[0.08] p-4"
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
