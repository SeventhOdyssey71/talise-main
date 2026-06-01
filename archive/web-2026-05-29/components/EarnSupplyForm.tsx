"use client";

import { useState } from "react";
import {
  signAndSubmit,
  buildUsdsuiMarginSupply,
  hasEphemeralKey,
  triggerOauthSignIn,
} from "@/lib/zkclient";
import { ErrorBox } from "@/components/ErrorBox";

export function EarnSupplyForm({
  senderAddress,
  availableUsdsui,
  availableSui,
  supplyApr,
}: {
  senderAddress: string;
  availableUsdsui: number;
  availableSui: number;
  supplyApr: number;
}) {
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ digest: string; amount: number } | null>(
    null
  );

  const amt = Number(amount);
  const valid = amt > 0 && amt <= availableUsdsui && availableSui >= 0.005;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    try {
      if (!hasEphemeralKey()) {
        // Auto-recover: re-run OAuth with this page as return target.
        await triggerOauthSignIn({
          returnTo: window.location.pathname + window.location.search,
        });
        return; // page unloads
      }
      if (availableSui < 0.005) {
        throw new Error("Need a small SUI balance for gas (~0.005 SUI).");
      }

      const { digest } = await signAndSubmit(
        buildUsdsuiMarginSupply({
          senderAddress,
          amountMicro: BigInt(Math.round(amt * 1e6)),
        }),
        { senderAddress }
      );

      await fetch("/api/tx/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          digest,
          kind: "earn-supply",
          amount: amt.toString(),
          asset: "USDsui",
          recipient: null,
          memo: "DeepBook Margin supply",
        }),
      }).catch(() => {});

      setSuccess({ digest, amount: amt });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    const net = process.env.NEXT_PUBLIC_SUI_NETWORK ?? "mainnet";
    const yearly = success.amount * supplyApr;
    return (
      <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-6">
        <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-dim)]">
          Supplied · settled in one block
        </div>
        <div className="mt-3 font-display text-[34px] tracking-[-0.02em]">
          ${success.amount.toFixed(2)} earning.
        </div>
        <p className="mt-2 text-[13px] text-[var(--color-fg-muted)]">
          At today&apos;s {(supplyApr * 100).toFixed(2)}% APR, this yields about
          <span className="text-[var(--color-fg)]"> ${yearly.toFixed(2)} </span>
          per year. Variable; withdraw anytime.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3 text-[12px]">
          <a
            href={`https://suiscan.xyz/${net}/tx/${success.digest}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--color-fg)] transition hover:border-[var(--color-fg)]"
          >
            View on Suiscan ↗
          </a>
          <a
            href="/home"
            className="text-[var(--color-fg-muted)] underline-offset-4 hover:text-[var(--color-fg)] hover:underline"
          >
            Done
          </a>
        </div>
        <p className="mt-5 font-mono text-[11px] text-[var(--color-fg-dim)] break-all">
          digest: {success.digest}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-7">
      <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-dim)]">
        Supply USDsui
      </div>

      <div className="mt-4">
        <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--color-fg-dim)]">
          Amount (USDsui)
        </div>
        <div className="relative mt-2">
          <input
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-3 text-[18px] text-[var(--color-fg)] placeholder:text-[var(--color-fg-dim)] focus:border-[var(--color-fg)] focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setAmount(availableUsdsui.toFixed(2))}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] uppercase tracking-wider text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
          >
            max
          </button>
        </div>
        <p className="mt-2 text-[11px] text-[var(--color-fg-dim)]">
          available {availableUsdsui.toFixed(2)} USDsui · gas paid in SUI (~$0.005)
        </p>
      </div>

      {amt > 0 && (
        <div className="mt-5 rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] p-3 text-[12px]">
          <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--color-fg-dim)]">
            At today&apos;s rate
          </div>
          <div className="mt-1 text-[var(--color-fg)]">
            ≈ ${(amt * supplyApr).toFixed(4)} / year · ${((amt * supplyApr) / 12).toFixed(4)} / month
          </div>
        </div>
      )}

      <button
        type="submit"
        disabled={!valid || submitting}
        className="mt-6 w-full rounded-md bg-[var(--color-fg)] px-5 py-3.5 text-[15px] font-medium text-[var(--color-bg)] transition hover:bg-[var(--color-accent-soft)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {submitting
          ? "Signing & supplying…"
          : valid
            ? `Supply ${amt.toFixed(2)} USDsui`
            : availableUsdsui === 0
              ? "No USDsui to supply"
              : "Enter an amount"}
      </button>

      {err && <div className="mt-3"><ErrorBox message={err} /></div>}
    </form>
  );
}
