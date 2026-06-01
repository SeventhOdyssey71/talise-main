"use client";

import { useState } from "react";
import {
  signAndSubmit,
  buildSpotLPDeposit,
  hasEphemeralKey,
  triggerOauthSignIn,
} from "@/lib/zkclient";
import { ErrorBox } from "@/components/ErrorBox";

export function SpotLPForm({
  senderAddress,
  availableUsdsui,
  availableSui,
  existingBmId,
}: {
  senderAddress: string;
  availableUsdsui: number;
  availableSui: number;
  existingBmId: string | null;
}) {
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    digest: string;
    amount: number;
    bmId: string | null;
  } | null>(null);

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

      const result = await signAndSubmit(
        buildSpotLPDeposit({
          senderAddress,
          amountMicro: BigInt(Math.round(amt * 1e6)),
        }),
        { senderAddress }
      );

      const bmId = result.created["BalanceManager"]?.[0] ?? null;

      // Persist the BM id for the manage flow.
      if (bmId) {
        await fetch("/api/spot/record-bm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bmId }),
        }).catch(() => {});
      }

      await fetch("/api/tx/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          digest: result.digest,
          kind: "spot-lp-deposit",
          amount: amt.toString(),
          asset: "USDsui",
          recipient: null,
          memo: "DeepBook Spot LP deposit",
        }),
      }).catch(() => {});

      setSuccess({ digest: result.digest, amount: amt, bmId });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    const net = process.env.NEXT_PUBLIC_SUI_NETWORK ?? "mainnet";
    return (
      <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-7">
        <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-dim)]">
          Deposited · BalanceManager live
        </div>
        <div className="mt-3 font-display text-[34px] tracking-[-0.02em]">
          ${success.amount.toFixed(2)} ready to LP.
        </div>
        <p className="mt-2 text-[13px] text-[var(--color-fg-muted)]">
          Your USDsui is now sitting in a non-custodial DeepBook BalanceManager.
          Order placement lands in the next release. Your liquidity is queued
          up to start earning fee yield + DEEP rewards.
        </p>

        {success.bmId && (
          <div className="mt-5 rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] p-3 text-[11px]">
            <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-dim)]">
              BalanceManager id
            </div>
            <div
              className="mt-1 font-mono text-[var(--color-fg)]"
              title={success.bmId ?? undefined}
            >
              {success.bmId
                ? `${success.bmId.slice(0, 10)}…${success.bmId.slice(-6)}`
                : ""}
            </div>
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3 text-[12px]">
          <a
            href={`https://suiscan.xyz/${net}/tx/${success.digest}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--color-fg)] transition hover:border-[var(--color-fg)]"
          >
            View tx on Suiscan ↗
          </a>
          {success.bmId && (
            <a
              href={`https://suiscan.xyz/${net}/object/${success.bmId}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--color-fg)] transition hover:border-[var(--color-fg)]"
            >
              View BM on Suiscan ↗
            </a>
          )}
          <a
            href="/home"
            className="text-[var(--color-fg-muted)] underline-offset-4 hover:text-[var(--color-fg)] hover:underline"
          >
            Done
          </a>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-7">
      <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-dim)]">
        Deposit USDsui into DeepBook Spot
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

      {existingBmId && (
        <div className="mt-5 rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] p-3 text-[11px]">
          <div className="text-[var(--color-fg-muted)]">
            You already have a BalanceManager from an earlier deposit:
          </div>
          <div className="mt-1 font-mono text-[var(--color-fg)]" title={existingBmId}>
            {`${existingBmId.slice(0, 10)}…${existingBmId.slice(-6)}`}
          </div>
          <div className="mt-1 text-[var(--color-fg-dim)]">
            This deposit mints a new manager. Future Manage UI will let you
            consolidate.
          </div>
        </div>
      )}

      <div className="mt-5 rounded-md border border-dashed border-[var(--color-line)] p-3 text-[11px] text-[var(--color-fg-muted)]">
        Inside one atomic transaction we&apos;ll:{" "}
        <span className="text-[var(--color-fg)]">
          mint a BalanceManager · deposit your USDsui · share the BM so it can
          participate in pool trades
        </span>
        . You stay the owner; only you can withdraw.
      </div>

      <button
        type="submit"
        disabled={!valid || submitting}
        className="mt-6 w-full rounded-md bg-[var(--color-fg)] px-5 py-3.5 text-[15px] font-medium text-[var(--color-bg)] transition hover:bg-[var(--color-accent-soft)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {submitting
          ? "Signing & depositing…"
          : valid
            ? `Deposit ${amt.toFixed(2)} USDsui to Spot LP`
            : availableUsdsui === 0
              ? "No USDsui to deposit"
              : "Enter an amount"}
      </button>

      {err && <div className="mt-3"><ErrorBox message={err} /></div>}
    </form>
  );
}
