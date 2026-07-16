"use client";

import type { ReactNode } from "react";
import { Diamond } from "@/components/Diamond";

export type PerpsUser = { name: string | null; picture: string | null };

/**
 * Dedicated chrome for the standalone /perps surface (perps.talise.io) — a
 * focused trading header instead of the full app nav, so the terminal gets the
 * whole viewport. Editorial "talise / Perps [beta]" lockup, a link back to the
 * wallet, and the account initial.
 */
export function PerpsChrome({ me, children }: { me: PerpsUser; children: ReactNode }) {
  const initial = (me.name?.trim()?.[0] ?? "T").toUpperCase();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 flex h-14 flex-none items-center justify-between border-b border-[#15300c]/10 bg-[#f7fcf2]/80 px-4 backdrop-blur-md lg:px-8">
        <a href="/perps" className="flex items-center gap-2.5" aria-label="Talise Perps">
          <Diamond />
          <span className="text-[19px] font-bold leading-none tracking-[-0.02em]">talise</span>
          <span className="text-[#15300c]/30">/</span>
          <span className="text-[15px] font-semibold leading-none">Perps</span>
          <span className="rounded-full bg-[#CAFFB8] px-2 py-[3px] text-[10px] font-bold lowercase leading-none text-[#15300c]">beta</span>
        </a>
        <div className="flex items-center gap-3">
          <a
            href="/app"
            className="hidden items-center gap-1.5 rounded-full border border-[#15300c]/15 bg-white/60 px-3 py-1.5 text-[13px] font-semibold text-[#15300c] transition-colors hover:bg-white sm:flex"
          >
            Wallet
            <span aria-hidden>↗</span>
          </a>
          <span
            className="flex size-9 items-center justify-center overflow-hidden rounded-full bg-[#15300c] text-[14px] font-bold text-white"
            aria-label={me.name ?? "Account"}
          >
            {me.picture ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={me.picture} alt="" className="size-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              initial
            )}
          </span>
        </div>
      </header>
      <main className="w-full flex-1 px-4 pb-10 pt-4 lg:px-6">
        {children}
      </main>
    </div>
  );
}
