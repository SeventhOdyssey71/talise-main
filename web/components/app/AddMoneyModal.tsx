"use client";

import { useCallback, useMemo, useState } from "react";
import { Sheet } from "@/components/app/ui/Sheet";
import type { SessionResult } from "@/lib/onramp/types";

/**
 * "Add money" (on-ramp) sheet — Transak hosted checkout.
 *
 * Flow: enter a USD amount → POST /api/onramp/v2/session → open the provider's
 * hosted widget in a new tab. Transak runs the KYC + card/bank payment itself
 * and delivers USDC on the user's Sui address; a follow-up swap converts that
 * USDC → USDsui. We collect NO identity fields here — the widget owns KYC.
 *
 * DORMANT by default: renders nothing unless NEXT_PUBLIC_ONRAMP_ENABLED is
 * "true". It only calls the additive /api/onramp/v2/* routes and never touches
 * the send/balance/limit path.
 */

const ENABLED = process.env.NEXT_PUBLIC_ONRAMP_ENABLED === "true";

export interface AddMoneyModalProps {
  open: boolean;
  onClose: () => void;
}

export function AddMoneyModal({ open, onClose }: AddMoneyModalProps) {
  const [amount, setAmount] = useState("");
  const [session, setSession] = useState<SessionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountCents = useMemo(() => {
    const n = Number(amount);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
  }, [amount]);

  const reset = useCallback(() => {
    setAmount("");
    setSession(null);
    setError(null);
    setLoading(false);
  }, []);

  const close = useCallback(() => {
    onClose();
    // reset after the close animation so a reopen is fresh
    setTimeout(reset, 200);
  }, [onClose, reset]);

  const start = useCallback(async () => {
    setError(null);
    if (amountCents <= 0) {
      setError("Enter an amount greater than 0.");
      return;
    }
    setLoading(true);
    try {
      const resp = await fetch("/api/onramp/v2/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ amountCents }),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error ?? "Could not start checkout.");
      const s = json as SessionResult;
      setSession(s);
      // Auto-open the hosted widget (popup-blockers may require the explicit
      // button below as a fallback).
      if (s.widgetUrl && typeof window !== "undefined") {
        window.open(s.widgetUrl, "_blank", "noopener,noreferrer");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [amountCents]);

  if (!ENABLED) return null;

  return (
    <Sheet open={open} onClose={close} title="Add money" size="md">
      <div className="space-y-5 pb-2">
        {!session ? (
          <>
            <div>
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.18em] text-fg-dim">
                Amount (USD)
              </label>
              <div className="talise-glass flex items-center gap-2 rounded-xl px-4 py-3">
                <span className="font-display text-[18px] text-fg-muted">$</span>
                <input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) =>
                    setAmount(e.target.value.replace(/[^0-9.]/g, ""))
                  }
                  placeholder="0.00"
                  className="w-full bg-transparent text-[18px] tabular-nums text-fg outline-none placeholder:text-fg-dim"
                />
              </div>
            </div>

            <p className="text-[13px] leading-relaxed text-fg-dim">
              You&apos;ll verify your identity and pay by card or bank with our
              partner. Funds arrive as USDsui in your wallet, usually within a
              few minutes.
            </p>

            <button
              type="button"
              disabled={loading || amountCents <= 0}
              onClick={start}
              className="inline-flex w-full items-center justify-center rounded-full bg-accent-deep px-5 py-3 text-[14px] font-semibold text-white shadow-[0_6px_18px_-8px_rgba(35,78,20,0.45)] transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "Starting…" : "Continue to secure checkout"}
            </button>
          </>
        ) : (
          /* Session started — widget opened in a new tab. */
          <div className="space-y-4 text-center">
            <p className="text-[15px] leading-relaxed text-fg">
              Complete your purchase in the checkout tab. Once it clears, your
              balance updates automatically.
            </p>
            {session.widgetUrl && (
              <a
                href={session.widgetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-full items-center justify-center rounded-full bg-accent-deep px-5 py-3 text-[14px] font-semibold text-white transition-opacity hover:opacity-90"
              >
                Open secure checkout
              </a>
            )}
            {session.requiresSwapToUsdsui && (
              <p className="text-[12px] leading-relaxed text-fg-dim">
                Funds arrive as USDC on Sui and are converted to USDsui for you.
              </p>
            )}
            <button
              type="button"
              onClick={close}
              className="text-[13px] text-fg-muted underline-offset-2 hover:underline"
            >
              Done
            </button>
          </div>
        )}

        {error && <p className="text-[12px] text-[var(--color-danger)]">{error}</p>}
      </div>
    </Sheet>
  );
}
