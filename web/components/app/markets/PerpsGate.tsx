"use client";

import { Diamond } from "@/components/Diamond";
import { triggerOauthSignIn } from "@/lib/zkclient";

/**
 * Access gate for the standalone /perps surface. Not signed in → Continue with
 * Google (returns to /perps). Signed in but not yet allowed into the beta → a
 * calm waiting message. Mirrors the app's gate, in the perps chrome.
 */
export function PerpsGate({ blocked, name }: { blocked: boolean; name: string | null }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 flex-none items-center px-4 lg:px-8">
        <div className="flex items-center gap-2.5">
          <Diamond />
          <span className="text-[19px] font-bold leading-none tracking-[-0.02em]">talise</span>
          <span className="text-[#15300c]/30">/</span>
          <span className="text-[15px] font-semibold leading-none">Perps</span>
          <span className="rounded-full bg-[#CAFFB8] px-2 py-[3px] text-[10px] font-bold lowercase leading-none text-[#15300c]">beta</span>
        </div>
      </header>
      <div className="flex flex-1 items-center justify-center px-6 pb-24">
        <div className="w-full max-w-[420px] text-center">
          {blocked ? (
            <>
              <h1
                className="text-[34px] leading-[1.05] tracking-[-0.02em]"              >
                You&apos;re on the list.
              </h1>
              <p className="mx-auto mt-3 max-w-[34ch] text-[15.5px] leading-relaxed text-[#40532f]">
                {name ? `Thanks, ${name.split(" ")[0]}. ` : ""}Your account is ready — Perps access is opening in waves. We&apos;ll email you the moment it&apos;s your turn.
              </p>
              <a
                href="/app"
                className="mt-6 inline-flex items-center gap-1.5 rounded-full border border-[#15300c]/15 bg-white px-5 py-2.5 text-[14px] font-semibold text-[#15300c]"
              >
                Open your wallet <span aria-hidden>↗</span>
              </a>
            </>
          ) : (
            <>
              <h1
                className="text-[36px] leading-[1.04] tracking-[-0.02em]"              >
                Trade perps
                <br />
                on Talise.
              </h1>
              <p className="mx-auto mt-3 max-w-[32ch] text-[15.5px] leading-relaxed text-[#40532f]">
                Crypto &amp; stocks, up to 25× leverage. Sign in with Google — no wallet, no seed phrase.
              </p>
              <button
                onClick={() => triggerOauthSignIn({ returnTo: "/perps" })}
                className="mt-6 inline-flex items-center justify-center gap-2 rounded-full bg-[#15300c] px-6 py-3 text-[15px] font-semibold text-white transition-transform active:scale-95"
              >
                Continue with Google
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
