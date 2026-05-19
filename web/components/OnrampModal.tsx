"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorBox } from "@/components/ErrorBox";
import type { OnrampSession } from "@stripe/crypto";

/**
 * Embedded Stripe Crypto Onramp modal.
 *
 * Flow:
 *   1. User picks a fiat amount (preset chip or custom input).
 *   2. We POST `/api/onramp/session` → `{ clientSecret, id }`.
 *   3. Lazy-load `@stripe/crypto`.
 *   4. `loadStripeOnramp(pk).createSession({ clientSecret }).mount(div)`.
 *   5. Listen for `onramp_session_updated` — show inline success when the
 *      session reaches `fulfillment_complete`.
 *
 * The whole UI stays on-domain (mounted inside our DOM). No new tab, no
 * redirect, no `?onramp=success` query param dance.
 *
 * Docs: https://docs.stripe.com/crypto/onramp
 */

const PRESETS = [20, 50, 100, 200] as const;

export function OnrampModal({
  open,
  onClose,
  initialAmount = 20,
}: {
  open: boolean;
  onClose: () => void;
  initialAmount?: number;
}) {
  const [amount, setAmount] = useState<number>(initialAmount);
  const [custom, setCustom] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"select" | "embedded" | "success">(
    "select"
  );
  const [statusLine, setStatusLine] = useState<string>("");

  const mountRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<OnrampSession | null>(null);
  const autoDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset state every time the modal opens.
  useEffect(() => {
    if (open) {
      setAmount(initialAmount);
      setCustom("");
      setBusy(false);
      setError(null);
      setPhase("select");
      setStatusLine("");
    }
  }, [open, initialAmount]);

  const cleanup = useCallback(() => {
    if (autoDismissRef.current) {
      clearTimeout(autoDismissRef.current);
      autoDismissRef.current = null;
    }
    // Stripe's OnrampSession has no public `destroy()` method, so we
    // best-effort clear the mount container. Stripe's iframe lives in
    // there and is GC'd once the wrapper unmounts.
    if (mountRef.current) {
      mountRef.current.innerHTML = "";
    }
    sessionRef.current = null;
  }, []);

  // Cleanup when modal closes / unmounts.
  useEffect(() => {
    if (!open) cleanup();
    return () => cleanup();
  }, [open, cleanup]);

  // Esc-to-close + lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const finalAmount = (): number => {
    const c = Number(custom);
    if (custom && Number.isFinite(c) && c > 0) return Math.round(c * 100) / 100;
    return amount;
  };

  async function startSession() {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const pk = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
      if (!pk) {
        throw new Error(
          "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is missing. Add it to .env.local and reload."
        );
      }

      const r = await fetch("/api/onramp/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: finalAmount() }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        clientSecret?: string;
        id?: string;
        error?: string;
      };
      if (!r.ok || !j.clientSecret) {
        throw new Error(j.error ?? `Onramp failed (HTTP ${r.status})`);
      }

      // Lazy-load the SDK so we don't ship it on every page.
      // `@stripe/crypto` injects the actual script from
      // https://crypto-js.stripe.com — the npm package is just a loader.
      const { loadStripeOnramp } = await import("@stripe/crypto");
      const stripeOnramp = await loadStripeOnramp(pk);
      if (!stripeOnramp) {
        throw new Error(
          "Couldn't load the Stripe Onramp SDK. Check your network connection and ad blockers."
        );
      }

      const session = stripeOnramp.createSession({
        clientSecret: j.clientSecret,
      });

      session.addEventListener("onramp_ui_loaded", () => {
        setStatusLine("Stripe is ready.");
      });

      session.addEventListener("onramp_session_updated", (ev) => {
        const status = ev.payload?.session?.status;
        if (!status) return;
        if (status === "fulfillment_processing") {
          setStatusLine("Payment received. Settling on Sui…");
        } else if (status === "fulfillment_complete") {
          setPhase("success");
          // Auto-dismiss after 6s so the home page can sweep in.
          autoDismissRef.current = setTimeout(() => onClose(), 6000);
        } else if (status === "rejected") {
          setError("Stripe rejected the session. Try a different amount or card.");
        }
      });

      sessionRef.current = session;
      setPhase("embedded");

      // Mount on the next tick so the embedded container is in the DOM.
      requestAnimationFrame(() => {
        if (mountRef.current) {
          try {
            session.mount(mountRef.current);
          } catch (e) {
            setError(
              `Couldn't mount Stripe Onramp: ${(e as Error).message ?? "unknown"}`
            );
          }
        }
      });
    } catch (e) {
      setError((e as Error).message ?? "Could not start onramp.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-6"
      role="dialog"
      aria-modal="true"
      aria-label="Top up with card"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative flex max-h-[92vh] w-full max-w-[480px] flex-col overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-bg)] shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--color-line)] px-5 py-4">
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-dim)]">
              Stripe · secure card
            </div>
            <div className="mt-0.5 text-[15px] font-medium text-[var(--color-fg)]">
              Top up with card
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1 text-[12px] text-[var(--color-fg-muted)] transition hover:border-[var(--color-fg)] hover:text-[var(--color-fg)]"
            aria-label="Close"
          >
            close
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {phase === "select" && (
            <div className="p-5">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-dim)]">
                Amount
              </div>
              <div className="grid grid-cols-4 gap-2">
                {PRESETS.map((p) => {
                  const active = !custom && amount === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => {
                        setAmount(p);
                        setCustom("");
                      }}
                      className={`rounded-full border px-3 py-2 text-[13px] transition ${
                        active
                          ? "border-[var(--color-fg)] bg-[var(--color-fg)] text-[var(--color-bg)]"
                          : "border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-fg)] hover:border-[var(--color-fg)]"
                      }`}
                    >
                      ${p}
                    </button>
                  );
                })}
              </div>

              <div className="mt-4">
                <label className="mb-1 block font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-dim)]">
                  Custom (USD)
                </label>
                <div className="flex items-center rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3">
                  <span className="text-[14px] text-[var(--color-fg-dim)]">$</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="1"
                    step="1"
                    placeholder="e.g. 35"
                    value={custom}
                    onChange={(e) => setCustom(e.target.value)}
                    className="w-full bg-transparent px-2 py-2.5 text-[14px] text-[var(--color-fg)] outline-none placeholder:text-[var(--color-fg-dim)]"
                  />
                </div>
              </div>

              <div className="mt-5 text-[12px] leading-relaxed text-[var(--color-fg-muted)]">
                You&rsquo;ll buy USDC on Sui. The home banner sweeps it to
                USDsui automatically.
              </div>

              {error && (
                <div className="mt-4">
                  <ErrorBox
                    message={error}
                    onRetry={() => setError(null)}
                  />
                </div>
              )}

              <button
                type="button"
                disabled={busy || finalAmount() <= 0}
                onClick={startSession}
                className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[var(--color-fg)] px-5 py-3 text-[13px] font-medium text-[var(--color-bg)] transition hover:bg-[var(--color-accent-soft)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? "Starting…" : `Continue to Stripe · $${finalAmount()}`}
              </button>
            </div>
          )}

          {phase === "embedded" && (
            <div className="p-3">
              {statusLine && (
                <div
                  className="mb-2 rounded-xl border border-[#d97706]/40 bg-[#d97706]/[0.08] px-3 py-2 text-[12px] text-[#7A5A12]"
                  role="status"
                >
                  {statusLine}
                </div>
              )}
              {error && (
                <div className="mb-2">
                  <ErrorBox message={error} onRetry={() => setError(null)} />
                </div>
              )}
              {/* Stripe mounts its iframe here. Give it room to breathe. */}
              <div
                ref={mountRef}
                className="min-h-[520px] w-full rounded-xl bg-white"
              />
            </div>
          )}

          {phase === "success" && (
            <div className="p-6">
              <div
                role="status"
                className="rounded-xl border border-[#d97706]/40 bg-[#d97706]/[0.08] p-5"
              >
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#7A5A12]">
                  Onramp · complete
                </div>
                <div className="mt-2 text-[14px] text-[var(--color-fg)]">
                  USDC is in your wallet.
                </div>
                <div className="mt-1 text-[12px] text-[var(--color-fg-muted)]">
                  Convert to USDsui from the home banner.
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="mt-5 inline-flex w-full items-center justify-center rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] px-5 py-3 text-[13px] font-medium text-[var(--color-fg)] transition hover:border-[var(--color-fg)]"
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
