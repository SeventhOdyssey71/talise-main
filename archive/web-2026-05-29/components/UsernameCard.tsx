"use client";

import { formatHandle } from "@/lib/handle";
import { shortAddress } from "@/lib/format";

/**
 * Hero artifact of the username feature. Pure black/white, restrained, premium.
 * Renders both as the big claim preview (`size="lg"`) and as a small in-app
 * chip on the dashboard (`size="sm"`).
 */
export function UsernameCard({
  username,
  address,
  size = "lg",
}: {
  username: string;
  address: string;
  size?: "lg" | "sm";
}) {
  if (size === "sm") {
    return (
      <div
        className={
          "group relative flex items-center justify-between gap-4 overflow-hidden " +
          "rounded-xl border border-white/10 px-4 py-3 " +
          "bg-gradient-to-br from-[#0a0a0a] via-[#0f0f0f] to-[#1a1a1a] " +
          "shadow-[0_4px_18px_rgba(0,0,0,0.28)] " +
          "transition-transform duration-300 ease-out hover:-translate-y-0.5"
        }
      >
        <div className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-white/5" />
        <div className="relative flex min-w-0 flex-col">
          <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-white/40">
            your handle
          </span>
          <span className="mt-1 truncate font-display text-[18px] font-semibold tracking-[-0.025em] text-white">
            {formatHandle(username)}
          </span>
        </div>
        <div
          className="relative shrink-0 text-right font-mono text-[10px] text-white/55"
          title={address}
        >
          {shortAddress(address, 4, 4)}
        </div>
      </div>
    );
  }

  // Credit-card proportions — 1.586:1 (ISO/IEC 7810 ID-1), much friendlier
  // at full container width than the previous 16:10 poster.
  return (
    <div
      className={
        "group relative w-full max-w-md overflow-hidden rounded-2xl border border-white/10 " +
        "bg-gradient-to-br from-[#0a0a0a] via-[#0f0f0f] to-[#1a1a1a] " +
        "shadow-[0_8px_30px_rgba(0,0,0,0.35)] " +
        "transition-transform duration-300 ease-out will-change-transform hover:-translate-y-0.5 " +
        "aspect-[1.586/1] p-5 md:p-6"
      }
    >
      {/* Inner ring */}
      <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/5" />

      {/* Soft aura behind the handle — adds the "premium card" depth without color */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(420px circle at 80% 110%, rgba(255,255,255,0.05), transparent 60%)",
        }}
      />

      {/* Top row: wordmark + mainnet pill */}
      <div className="relative flex items-start justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/70">
          talise
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5">
          <span className="inline-flex h-1 w-1 rounded-full bg-white/80" />
          <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-white/55">
            mainnet
          </span>
        </span>
      </div>

      {/* Center: the handle */}
      <div className="relative mt-5 flex items-center md:mt-6">
        <span className="font-display text-[28px] font-semibold leading-[1.04] tracking-[-0.03em] text-white md:text-[34px]">
          {formatHandle(username)}
        </span>
      </div>

      {/* Bottom row */}
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between p-5 md:p-6">
        <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-white/45">
          Your money lands here
        </div>
        <div className="font-mono text-[10px] text-white/55" title={address}>
          {shortAddress(address, 4, 4)}
        </div>
      </div>
    </div>
  );
}
