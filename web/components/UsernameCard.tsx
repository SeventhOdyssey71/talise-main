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

  return (
    <div
      className={
        "group relative w-full overflow-hidden rounded-2xl border border-white/10 " +
        "bg-gradient-to-br from-[#0a0a0a] via-[#0f0f0f] to-[#1a1a1a] " +
        "shadow-[0_8px_30px_rgba(0,0,0,0.35)] " +
        "transition-transform duration-300 ease-out will-change-transform hover:-translate-y-0.5 " +
        "aspect-[16/10] p-7 md:p-8"
      }
    >
      {/* Inner ring — subtle inner border at the gradient edge. */}
      <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/5" />

      {/* Top-left: wordmark + mainnet dot */}
      <div className="relative flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/70">
            talise
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-flex h-1 w-1 rounded-full bg-white/80" />
            <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-white/40">
              mainnet
            </span>
          </span>
        </div>
      </div>

      {/* Center: huge handle */}
      <div className="relative mt-8 flex items-center md:mt-10">
        <span className="font-display text-[44px] font-semibold leading-[1.02] tracking-[-0.035em] text-white md:text-[64px]">
          {formatHandle(username)}
        </span>
      </div>

      {/* Bottom row */}
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between p-7 md:p-8">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/45">
          Your money lands here
        </div>
        <div className="font-mono text-[11px] text-white/55" title={address}>
          {shortAddress(address, 4, 4)}
        </div>
      </div>
    </div>
  );
}
