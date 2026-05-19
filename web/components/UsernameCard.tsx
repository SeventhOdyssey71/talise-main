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
  const isLg = size === "lg";

  return (
    <div
      className={
        "group relative w-full overflow-hidden rounded-2xl border border-white/10 " +
        "bg-gradient-to-br from-[#0a0a0a] via-[#0f0f0f] to-[#1a1a1a] " +
        "shadow-[0_8px_30px_rgba(0,0,0,0.35)] " +
        "transition-transform duration-300 ease-out will-change-transform hover:-translate-y-0.5 " +
        (isLg ? "aspect-[16/10] p-7 md:p-8" : "aspect-[16/8] p-4")
      }
    >
      {/* Inner ring — subtle inner border at the gradient edge. */}
      <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/5" />

      {/* Top-left: wordmark + mainnet dot */}
      <div className="relative flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span
            className={
              "font-mono uppercase tracking-[0.22em] text-white/70 " +
              (isLg ? "text-[10px]" : "text-[9px]")
            }
          >
            talise
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-flex h-1 w-1 rounded-full bg-white/80" />
            <span
              className={
                "font-mono uppercase tracking-[0.22em] text-white/40 " +
                (isLg ? "text-[9px]" : "text-[8px]")
              }
            >
              mainnet
            </span>
          </span>
        </div>
      </div>

      {/* Center: huge handle */}
      <div
        className={
          "relative flex items-center " +
          (isLg ? "mt-8 md:mt-10" : "mt-3")
        }
      >
        <span
          className={
            "font-display font-semibold tracking-[-0.035em] text-white " +
            (isLg
              ? "text-[44px] leading-[1.02] md:text-[64px]"
              : "text-[22px] leading-[1.05]")
          }
        >
          {formatHandle(username)}
        </span>
      </div>

      {/* Bottom row */}
      <div
        className={
          "absolute inset-x-0 bottom-0 flex items-end justify-between " +
          (isLg ? "p-7 md:p-8" : "p-4")
        }
      >
        <div
          className={
            "font-mono uppercase tracking-[0.22em] text-white/45 " +
            (isLg ? "text-[10px]" : "text-[9px]")
          }
        >
          Your money lands here
        </div>
        <div
          className={
            "font-mono text-white/55 " +
            (isLg ? "text-[11px]" : "text-[10px]")
          }
          title={address}
        >
          {shortAddress(address, 4, 4)}
        </div>
      </div>
    </div>
  );
}
