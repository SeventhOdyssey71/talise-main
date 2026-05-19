"use client";

import { useMemo, useState } from "react";
import { Transaction } from "@mysten/sui/transactions";
import {
  signAndSubmit,
  hasEphemeralKey,
  triggerOauthSignIn,
  readEphemeralForT2000,
  buildSpotLPDeposit,
} from "@/lib/zkclient";
import { ErrorBox } from "@/components/ErrorBox";
import { formatLocal, type Currency } from "@/lib/fx";
import type { PendingReward } from "@t2000/sdk";

/**
 * Clean Earn dashboard.
 *
 * Top: your savings card — supplied amount, current APY, daily yield.
 * Middle: pending rewards card with a one-tap "Claim all".
 * Bottom: deposit form — "Add to savings".
 *
 * Backed by NAVI via `@t2000/sdk`. APY and supplied amount come from chain
 * via the server-side `getEarnSnapshot` helper passed in as props.
 */

type Props = {
  senderAddress: string;
  availableUsdsui: number;
  supplied: number;
  apy: number;
  dailyYield: number;
  pending: PendingReward[];
  totalPendingUsd: number;
};

export function EarnDashboard({
  senderAddress,
  availableUsdsui,
  supplied,
  apy,
  dailyYield,
  pending,
  totalPendingUsd,
}: Props) {
  const ccy: Currency = "NGN";
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const amt = Number(amount);
  const validAmt = amt > 0 && amt <= availableUsdsui;

  const monthlyYield = useMemo(() => dailyYield * 30, [dailyYield]);
  const yearlyYield = useMemo(() => supplied * apy, [supplied, apy]);

  async function deposit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      if (!hasEphemeralKey()) {
        await triggerOauthSignIn({
          returnTo: window.location.pathname + window.location.search,
        });
        return;
      }
      if (!validAmt) throw new Error("Enter an amount above 0 and within your balance.");

      // Use T2000.save through the existing API. The route accepts the
      // ephemeral key + signs as zkLogin, builds the NAVI supply PTB, runs
      // through Onara sponsor for gas.
      const eph = readEphemeralForT2000();
      if (!eph) throw new Error("Session expired. Sign in again.");

      const r = await fetch("/api/t2000/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          op: "save",
          amount: amt,
          asset: "USDsui",
          ...eph,
        }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Deposit failed (HTTP ${r.status})`);
      }
      setSuccess(`Deposited ${formatLocal(amt, ccy)} into savings.`);
      setAmount("");
      // Reload after a beat so the supplied amount updates from chain.
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      setErr((e as Error).message ?? "Couldn't deposit.");
    } finally {
      setSubmitting(false);
    }
  }

  async function claim() {
    setErr(null);
    setSuccess(null);
    setClaiming(true);
    try {
      if (!hasEphemeralKey()) {
        await triggerOauthSignIn({
          returnTo: window.location.pathname + window.location.search,
        });
        return;
      }
      const eph = readEphemeralForT2000();
      if (!eph) throw new Error("Session expired. Sign in again.");

      const r = await fetch("/api/t2000/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "claimRewards", ...eph }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Claim failed (HTTP ${r.status})`);
      }
      setSuccess("Rewards claimed. They're in your wallet now.");
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      setErr((e as Error).message ?? "Couldn't claim rewards.");
    } finally {
      setClaiming(false);
    }
  }

  // Silence the unused import (kept for backwards-compatibility / future tooltips).
  void Transaction;
  void buildSpotLPDeposit;

  return (
    <div className="space-y-6">
      {/* Top: savings position */}
      <section className="overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)]">
        <div className="grid gap-px bg-[var(--color-line)] md:grid-cols-3">
          <Tile
            label="Your savings"
            primary={formatLocal(supplied, ccy)}
            secondary={`≈ $${supplied.toFixed(2)} USDsui`}
            wide
          />
          <Tile
            label="Earning"
            primary={`${(apy * 100).toFixed(2)}%`}
            secondary="per year · NAVI lending"
          />
          <Tile
            label="Earning per day"
            primary={`+${formatLocal(dailyYield, ccy)}`}
            secondary={`≈ +${formatLocal(monthlyYield, ccy)} / month`}
          />
        </div>
        {supplied > 0 && (
          <div className="border-t border-[var(--color-line)] bg-[var(--color-surface-2)] px-6 py-3 font-mono text-[11px] text-[var(--color-fg-dim)]">
            at current rates, projected{" "}
            <span className="text-[var(--color-fg)]">
              {formatLocal(yearlyYield, ccy)}
            </span>{" "}
            in a year
          </div>
        )}
      </section>

      {/* Pending rewards */}
      <section className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-dim)]">
              Pending rewards
            </div>
            <div className="mt-2 font-display text-[28px] tracking-[-0.025em] text-[var(--color-fg)]">
              {totalPendingUsd > 0
                ? `≈ $${totalPendingUsd.toFixed(4)}`
                : "Nothing to claim yet."}
            </div>
            {pending.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-2 font-mono text-[11px]">
                {pending.map((p) => (
                  <li
                    key={`${p.protocol}-${p.coinType}`}
                    className="rounded-full border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2.5 py-1"
                  >
                    {p.amount.toFixed(4)} {p.symbol}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            type="button"
            onClick={claim}
            disabled={claiming || pending.length === 0}
            className="rounded-md bg-[var(--color-fg)] px-4 py-2 text-[13px] font-medium text-[var(--color-bg)] transition hover:bg-[var(--color-accent-soft)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {claiming ? "Claiming…" : "Claim all"}
          </button>
        </div>
      </section>

      {/* Deposit */}
      <section className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-6">
        <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-dim)]">
          Add to savings
        </div>
        <p className="mt-2 max-w-2xl text-[13px] text-[var(--color-fg-muted)]">
          Your USDsui supplies the NAVI lending market and earns{" "}
          <span className="font-mono text-[var(--color-fg)]">
            {(apy * 100).toFixed(2)}%
          </span>{" "}
          APY today. Withdraw any time, no lockup, no minimum.
        </p>

        <form onSubmit={deposit} className="mt-5 space-y-4">
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[16px] text-[var(--color-fg-muted)]">
              $
            </span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] py-3 pl-9 pr-20 text-[18px] text-[var(--color-fg)] placeholder:text-[var(--color-fg-dim)] focus:border-[var(--color-fg)] focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setAmount(availableUsdsui.toFixed(2))}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] uppercase tracking-wider text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
            >
              max
            </button>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-2 font-mono text-[11px] text-[var(--color-fg-dim)]">
            <span>available ${availableUsdsui.toFixed(2)} USDsui · gas is on us</span>
            {amt > 0 && (
              <span>
                ≈ +${(amt * apy).toFixed(2)} / yr
              </span>
            )}
          </div>

          <button
            type="submit"
            disabled={!validAmt || submitting}
            className="w-full rounded-md bg-[var(--color-fg)] px-5 py-3 text-[15px] font-medium text-[var(--color-bg)] transition hover:bg-[var(--color-accent-soft)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting
              ? "Depositing…"
              : validAmt
                ? `Deposit $${amt.toFixed(2)} to savings`
                : "Enter an amount"}
          </button>

          {err && <ErrorBox message={err} />}
          {success && (
            <div className="rounded-md border border-[#21A179]/25 bg-[#21A179]/[0.06] px-3 py-2 text-[13px] text-[#1f6f57]">
              {success}
            </div>
          )}
        </form>
      </section>
    </div>
  );
}

function Tile({
  label,
  primary,
  secondary,
  wide,
}: {
  label: string;
  primary: string;
  secondary?: string;
  wide?: boolean;
}) {
  return (
    <div
      className={`bg-[var(--color-surface)] p-6 ${wide ? "md:col-span-1" : ""}`}
    >
      <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-dim)]">
        {label}
      </div>
      <div className="mt-2 font-display text-[28px] leading-[1.05] tracking-[-0.025em] text-[var(--color-fg)] md:text-[32px]">
        {primary}
      </div>
      {secondary && (
        <div className="mt-1 font-mono text-[11px] text-[var(--color-fg-muted)]">
          {secondary}
        </div>
      )}
    </div>
  );
}
