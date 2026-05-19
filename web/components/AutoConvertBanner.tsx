"use client";

import { useMemo, useState } from "react";
import { ErrorBox } from "@/components/ErrorBox";
import { readEphemeralForT2000 } from "@/lib/zkclient";
import type { OwnedCoinSummary } from "@/lib/coins";

/**
 * Sticky-feel banner inviting the user to auto-convert any non-USDsui coin
 * holdings into USDsui via the Cetus aggregator (one sponsored swap per
 * non-USDsui coin type). USDsui is our canonical settlement balance.
 *
 * Server hands us the pre-filtered list of non-USDsui coins; we render
 * progress as we POST each swap to /api/t2000/execute.
 */
export function AutoConvertBanner({
  coins,
  suiUsdPrice = 0,
}: {
  coins: OwnedCoinSummary[];
  /** Optional USD price for SUI so we can show a soft total estimate. */
  suiUsdPrice?: number;
}) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{
    index: number;
    total: number;
    symbol: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doneCount, setDoneCount] = useState(0);

  // Pre-filter ineligible / dust coins before showing the banner.
  // - `amount` must be a positive finite number once converted to human units
  // - we skip native SUI in the "convertible" list because the user needs at
  //   least a wisp of SUI around for any future non-sponsored path (gas is
  //   sponsored today, but it's a sane default and Cetus pools don't always
  //   route from 0x2::sui::SUI cleanly anyway). The aggregator can swap SUI
  //   too if needed, so we still list it but it's the lowest-priority.
  const eligible = useMemo(
    () => coins.filter((c) => c.amount > 0 && Number.isFinite(c.amount)),
    [coins]
  );

  const approxUsd = useMemo(() => {
    // Best-effort total. We know prices only for a handful of symbols; for
    // unknowns we contribute 0 rather than make something up, which keeps the
    // headline honest.
    let total = 0;
    for (const c of eligible) {
      const sym = c.symbol.toUpperCase();
      if (sym === "USDC" || sym === "USDT" || sym === "USDE" || sym === "DAI") {
        total += c.amount;
      } else if (sym === "SUI" && suiUsdPrice > 0) {
        total += c.amount * suiUsdPrice;
      }
      // Unknown coins (WAL, NAVX, ETH, …) — leave out of the headline.
    }
    return total;
  }, [eligible, suiUsdPrice]);

  if (eligible.length === 0) return null;

  async function runAll() {
    setError(null);
    setRunning(true);
    setDoneCount(0);

    const eph = readEphemeralForT2000();
    if (!eph) {
      setError("Your session expired. Sign in again to convert.");
      setRunning(false);
      return;
    }

    for (let i = 0; i < eligible.length; i++) {
      const coin = eligible[i];
      setProgress({ index: i + 1, total: eligible.length, symbol: coin.symbol });
      try {
        const r = await fetch("/api/t2000/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            op: "swap",
            from: coin.symbol,
            to: "USDsui",
            amount: coin.amount,
            ephemeralPrivateKey: eph.ephemeralPrivateKey,
            ephemeralPubKeyB64: eph.ephemeralPubKeyB64,
            maxEpoch: eph.maxEpoch,
            randomness: eph.randomness,
          }),
        });
        if (!r.ok) {
          const j = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(
            j.error ?? `Convert ${coin.symbol} failed (HTTP ${r.status})`
          );
        }
        setDoneCount((d) => d + 1);
      } catch (e) {
        setError(
          `Stopped at ${coin.symbol}: ${(e as Error).message ?? "unknown error"}`
        );
        setRunning(false);
        setProgress(null);
        return;
      }
    }

    setProgress(null);
    setRunning(false);
    // All done — pull fresh balances. A reload is the simplest way to
    // refresh both the server-rendered banner and downstream balance cards.
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  }

  const headline = approxUsd > 0
    ? `Convert ${eligible.length} ${eligible.length === 1 ? "coin" : "coins"} (~$${formatUsd(approxUsd)}) to USDsui`
    : `Convert ${eligible.length} ${eligible.length === 1 ? "coin" : "coins"} to USDsui`;

  return (
    <div className="mb-6 rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface-2)] p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-fg-dim)]">
            Auto-convert
          </div>
          <div className="mt-1.5 text-[15px] text-[var(--color-fg)]">
            {headline}
          </div>
          <div className="mt-1 text-[12px] text-[var(--color-fg-muted)]">
            USDsui is your canonical balance. We&apos;ll route each coin
            through Cetus in one tap. Gas is sponsored.
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {eligible.map((c) => (
              <span
                key={c.coinType}
                className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1 text-[11px]"
                title={c.coinType}
              >
                <span className="font-mono text-[var(--color-fg)]">
                  {formatAmount(c.amount)}
                </span>
                <span className="text-[var(--color-fg-muted)]">
                  {c.symbol}
                </span>
              </span>
            ))}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <button
            type="button"
            onClick={runAll}
            disabled={running}
            className="rounded-md bg-[var(--color-fg)] px-4 py-2 text-[13px] font-medium text-[var(--color-bg)] transition hover:bg-[var(--color-accent-soft)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {running ? "Converting…" : "Convert all"}
          </button>
          {progress && (
            <div className="font-mono text-[11px] text-[var(--color-fg-muted)]">
              {progress.index}/{progress.total} · {progress.symbol} → USDsui
            </div>
          )}
          {!progress && doneCount > 0 && !error && (
            <div className="font-mono text-[11px] text-[var(--color-fg-muted)]">
              {doneCount}/{eligible.length} done
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-4">
          <ErrorBox message={error} onRetry={() => setError(null)} />
        </div>
      )}
    </div>
  );
}

/** Format a human-readable coin amount with sane precision per magnitude. */
function formatAmount(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0";
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 0.001) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return n.toExponential(2);
}

function formatUsd(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
