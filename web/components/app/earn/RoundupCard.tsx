"use client";

/**
 * Round-up & Save. A toggle + a 1–10% slider that controls how much of each
 * send gets auto-saved on settlement, plus the running "saved via round-up"
 * tally. Reads/writes GET/POST /api/rewards/roundup.
 */

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { PiggyBankIcon } from "@hugeicons/core-free-icons";
import { GlassCard, Eyebrow, useCurrency, useToast, ApiError } from "@/components/app";
import { useRoundup } from "./earn-data";

export function RoundupCard() {
  const { config, loading, update } = useRoundup();
  const { formatUsd } = useCurrency();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const enabled = config?.enabled ?? false;
  const percentage = config?.percentage ?? 5;
  const savedUsd = config?.savedUsd ?? 0;

  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      const next = await update({ enabled: !enabled });
      toast(next.enabled ? "Round-up on" : "Round-up off", "neutral");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't update round-up", "danger");
    } finally {
      setBusy(false);
    }
  }

  async function setPercentage(p: number) {
    if (busy) return;
    setBusy(true);
    try {
      await update({ percentage: p });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't update round-up", "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <GlassCard className="space-y-4 p-5" radius={24}>
      <div className="flex items-start gap-3.5">
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-full text-accent"
          style={{ background: "color-mix(in srgb, var(--color-accent) 12%, transparent)" }}
        >
          <HugeiconsIcon icon={PiggyBankIcon} size={19} strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-medium tracking-[-0.01em] text-fg">Round-up &amp; Save</p>
          <p className="text-[13px] text-fg-muted">
            Set aside a slice of every payment, automatically.
          </p>
        </div>
        <Switch on={enabled} onClick={toggle} disabled={loading || busy} />
      </div>

      {enabled && (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <Eyebrow>Save per payment</Eyebrow>
            <span className="text-[15px] font-medium tabular-nums text-accent">
              {percentage}%
            </span>
          </div>
          <input
            type="range"
            min={1}
            max={10}
            step={1}
            value={percentage}
            disabled={busy}
            onChange={(e) => setPercentage(Number(e.target.value))}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full disabled:opacity-50"
            style={{
              accentColor: "var(--color-accent-deep)",
              background: `linear-gradient(to right, var(--color-accent-deep) ${((percentage - 1) / 9) * 100}%, rgba(255,255,255,0.12) ${((percentage - 1) / 9) * 100}%)`,
            }}
            aria-label="Round-up percentage"
          />
        </div>
      )}

      <div
        className="flex items-center justify-between px-3.5 py-3"
        style={{
          borderRadius: 14,
          background: "color-mix(in srgb, var(--color-accent) 7%, transparent)",
        }}
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-dim">
          Saved via round-up
        </span>
        <span className="text-[17px] font-medium tracking-[-0.02em] tabular-nums text-accent">
          {formatUsd(savedUsd, { fixed: true })}
        </span>
      </div>
    </GlassCard>
  );
}

function Switch({
  on,
  onClick,
  disabled,
}: {
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-50"
      style={{
        background: on
          ? "var(--color-accent-deep)"
          : "rgba(255,255,255,0.12)",
      }}
    >
      <span
        className="inline-block size-5 transform rounded-full bg-white shadow transition-transform duration-200"
        style={{ transform: on ? "translateX(22px)" : "translateX(2px)" }}
      />
    </button>
  );
}
