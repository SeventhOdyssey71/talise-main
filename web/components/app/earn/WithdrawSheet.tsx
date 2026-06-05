"use client";

/**
 * Position detail + redeem flow. Opens when the user taps a venue card with a
 * non-zero supplied balance. Shows Supplied / APY / Earned so far / Earning
 * per day, then offers three paths:
 *   • partial withdraw (amount field + MAX)
 *   • withdraw earned (NAVI only, when accrued yield is above the dust floor)
 *   • withdraw all
 *
 * All routes go through `useEarnAction` (prepare → sponsor → execute).
 */

import { useEffect, useMemo, useState } from "react";
import {
  Sheet,
  MicroLabel,
  PrimaryButton,
  GlassPill,
  useCurrency,
  useToast,
  ApiError,
} from "@/components/app";
import { useEarnAction } from "./useEarnAction";
import { type YieldVenue, venueLabel, formatApy } from "./earn-data";

/** Below this much accrued yield, the "Withdraw earned" button is dust. */
const WITHDRAW_EARNED_DUST_USD = 0.01;

export function WithdrawSheet({
  venue,
  bestApy,
  onClose,
  onWithdrawn,
}: {
  venue: YieldVenue | null;
  bestApy: number;
  onClose: () => void;
  onWithdrawn: () => void;
}) {
  const { withdraw, withdrawEarned, working } = useEarnAction();
  const { symbol, rate, formatUsd, currency } = useCurrency();
  const { toast } = useToast();

  const [partial, setPartial] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Reset the form whenever the target changes (sheet opens for a new venue).
  useEffect(() => {
    setPartial("");
    setError(null);
  }, [venue?.venue]);

  const supplied = venue?.supplied ?? 0;
  const apy = venue?.apy ?? 0;
  const earned = venue?.earned;
  const dailyEarning = venue?.earningPerDay ?? (supplied * apy) / 365;

  const partialUsd = useMemo(() => {
    const local = Number(partial);
    if (!Number.isFinite(local) || local <= 0) return 0;
    return local / (rate || 1);
  }, [partial, rate]);

  const canWithdrawPartial =
    partialUsd > 0 && partialUsd <= supplied + 0.0001 && !working;
  const canWithdrawEarned =
    venue?.venue === "navi" &&
    earned !== undefined &&
    earned >= WITHDRAW_EARNED_DUST_USD &&
    !working;

  async function handle(fn: () => Promise<{ digest: string }>, label: string) {
    setError(null);
    try {
      await fn();
      toast(label, "success");
      onWithdrawn();
    } catch (e) {
      if (e instanceof ApiError && e.code === "NOT_SIGNED_IN") return;
      setError(e instanceof ApiError ? e.message : "Withdraw failed. Try again.");
    }
  }

  const v = venue; // capture for closures

  return (
    <Sheet open={!!venue} onClose={onClose} title="Position" size="md">
      {v && (
        <div className="space-y-5 pb-1">
          <h2 className="text-[22px] font-medium tracking-[-0.02em] text-fg">
            Your {venueLabel(v.venue)} earnings
          </h2>

          {/* Position card */}
          <div className="talise-glass overflow-hidden" style={{ borderRadius: 12 }}>
            <PositionRow label="Supplied" value={formatUsd(supplied, { fixed: true })} />
            <Divider />
            <PositionRow label="APY" value={formatApy(apy || bestApy)} accent />
            {earned !== undefined && (
              <>
                <Divider />
                <PositionRow
                  label="Earned so far"
                  value={formatUsd(earned, { fixed: true })}
                  accent
                />
              </>
            )}
            <Divider />
            <PositionRow
              label="Earning / day"
              value={supplied > 0 && apy > 0 ? formatUsd(dailyEarning) : "—"}
            />
          </div>

          {/* Partial withdraw */}
          <div className="space-y-2">
            <MicroLabel>Withdraw amount</MicroLabel>
            <div
              className="talise-glass flex items-center gap-2 px-4 py-3.5"
              style={{ borderRadius: 12 }}
            >
              <span className="text-[22px] font-medium text-fg-muted">{symbol}</span>
              <input
                inputMode="decimal"
                value={partial}
                onChange={(e) => {
                  const val = e.target.value.replace(/[^0-9.]/g, "");
                  if ((val.match(/\./g) ?? []).length <= 1) setPartial(val);
                  setError(null);
                }}
                placeholder="0.00"
                className="w-full bg-transparent text-[22px] font-medium tracking-[-0.01em] tabular-nums text-fg outline-none placeholder:text-fg-dim"
              />
              <GlassPill
                size="sm"
                tint="#3c7a2a"
                onClick={() => setPartial((supplied * rate).toFixed(2))}
              >
                MAX
              </GlassPill>
              <span className="text-[13px] font-medium text-fg-muted">{currency}</span>
            </div>
          </div>

          {error && <p className="text-[13px] text-danger">{error}</p>}

          {/* Actions */}
          <div className="space-y-2.5">
            <PrimaryButton
              full
              disabled={!canWithdrawPartial}
              loading={working}
              onClick={() =>
                handle(
                  () => withdraw(v.venue, partialUsd),
                  `Withdrew ${formatUsd(partialUsd, { fixed: true })}`
                )
              }
            >
              {partialUsd > 0 ? `Withdraw ${formatUsd(partialUsd, { fixed: true })}` : "Withdraw"}
            </PrimaryButton>

            {canWithdrawEarned && earned !== undefined && (
              <PrimaryButton
                full
                variant="ghost"
                loading={working}
                onClick={() =>
                  handle(
                    () => withdrawEarned(),
                    `Withdrew ${formatUsd(earned, { fixed: true })} earned`
                  )
                }
              >
                Withdraw earned ({formatUsd(earned, { fixed: true })})
              </PrimaryButton>
            )}

            <PrimaryButton
              full
              variant="ghost"
              disabled={working || supplied <= 0}
              onClick={() =>
                handle(() => withdraw(v.venue), "Withdrew everything + rewards")
              }
            >
              Withdraw all
            </PrimaryButton>
          </div>
        </div>
      )}
    </Sheet>
  );
}

function PositionRow({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-[13px] text-fg-muted">{label}</span>
      <span
        className={`text-[15px] font-medium tracking-[-0.01em] tabular-nums ${
          accent ? "text-accent" : "text-fg"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function Divider() {
  return <div className="mx-3.5 h-px bg-line" />;
}
