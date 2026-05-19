"use client";

import { motion } from "framer-motion";
import { SignInButton } from "./SignInButton";

export function Hero({ errorCode }: { errorCode?: string }) {
  return (
    <section className="relative w-full overflow-hidden bg-[#0a0a0a] text-white">
      {/* Layered radial aura — soft white-blue glow at the bottom edge, plus
          a subtle top vignette. Reflect-style depth without color noise. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: `
            radial-gradient(1100px circle at 50% 110%, rgba(168, 188, 240, 0.22), transparent 55%),
            radial-gradient(900px circle at 50% -10%, rgba(255,255,255,0.06), transparent 55%)
          `,
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent"
      />

      {/* Top stat strip — Reflect-style: thin row of metrics above the headline. */}
      <div className="relative z-10 mx-auto max-w-6xl px-6 pt-28 md:pt-24">
        <div className="grid grid-cols-2 gap-x-8 gap-y-3 border-b border-white/10 pb-5 text-left md:grid-cols-4">
          <Metric label="Avg send fee" value="<1%" subtle="vs WU ~6.4%" />
          <Metric label="Settlement" value="~1 sec" subtle="one block" />
          <Metric label="Gas paid by sender" value="$0.00" subtle="we cover it" />
          <Metric label="Currencies" value="₦ KSh GH₵ R" subtle="more soon" />
        </div>
      </div>

      <div className="relative z-10 mx-auto flex max-w-6xl flex-col items-center px-6 pt-12 pb-14 text-center md:pt-16 md:pb-20">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 text-[12px] text-white/70"
        >
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-50" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
          </span>
          UK · US · EU corridors live
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.1, ease: [0.2, 0.8, 0.2, 1] }}
          className="mt-8 max-w-4xl text-[44px] font-semibold leading-[1.04] tracking-[-0.025em] md:text-[80px]"
        >
          Send money home.
          <br />
          Instantly.{" "}
          <span className="font-serif italic font-normal tracking-normal">
            Almost free.
          </span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="mx-auto mt-7 max-w-2xl text-[16px] leading-[1.6] text-white/65 md:text-[18px]"
        >
          Talise sends naira, shillings, cedis, and rand across borders in
          seconds — at a fraction of what Wise, Western Union, or Remitly charge.
          Sign in with Google. No app, no agent, no queue.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="mt-9 flex flex-wrap items-center justify-center gap-3"
        >
          <SignInButton variant="full" />
          <a
            href="#features"
            className="rounded-md border border-white/15 bg-white/5 px-5 py-3 text-[14px] text-white/90 transition hover:bg-white/10"
          >
            How it works ↓
          </a>
        </motion.div>

        {errorCode && (
          <p className="mt-5 text-[12px] text-white/70">! {humanizeError(errorCode)}</p>
        )}

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.45 }}
          className="mt-7 text-[11px] uppercase tracking-[0.2em] text-white/40"
        >
          First send is on us
        </motion.div>
      </div>

      {/* Product preview — remittance UI mock */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, delay: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
        className="relative mx-auto -mb-1 max-w-6xl px-6 pb-0"
      >
        <ProductPreview />
      </motion.div>
    </section>
  );
}

function ProductPreview() {
  return (
    <div className="relative">
      <div
        aria-hidden
        className="absolute inset-x-16 -bottom-6 h-16 rounded-full bg-black/40 blur-2xl"
      />
      <div className="relative overflow-hidden rounded-t-2xl border border-white/10 bg-white shadow-[0_40px_100px_-30px_rgba(0,0,0,0.6)]">
        {/* Browser chrome */}
        <div className="flex items-center gap-2 border-b border-[#e5e5e5] bg-[#fafafa] px-4 py-2.5">
          <div className="flex gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-[#d3d3d3]" />
            <div className="h-2.5 w-2.5 rounded-full bg-[#d3d3d3]" />
            <div className="h-2.5 w-2.5 rounded-full bg-[#d3d3d3]" />
          </div>
          <div className="ml-3 font-mono text-[10px] text-[#a3a3a3]">
            talise.io/send
          </div>
          <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] text-[#525252]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#0a0a0a]" />
            Live
          </span>
        </div>

        {/* Body */}
        <div className="bg-white p-6 text-[#0a0a0a] md:p-10">
          <div className="text-[9px] uppercase tracking-[0.2em] text-[#a3a3a3]">
            New transfer · UK to Nigeria
          </div>
          <div className="mt-1 text-[22px] font-semibold tracking-tight md:text-[26px]">
            Send £100 → Mom receives ₦210,000
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {/* Sender card */}
            <div className="rounded-xl border border-[#e5e5e5] p-5">
              <div className="text-[10px] uppercase tracking-[0.18em] text-[#a3a3a3]">
                You send
              </div>
              <div className="mt-2 flex items-baseline gap-1.5 font-mono">
                <span className="text-[16px] text-[#525252]">£</span>
                <span className="text-[40px] font-semibold leading-none tracking-[-0.02em] text-[#0a0a0a]">
                  100
                </span>
                <span className="text-[16px] text-[#525252]">.00</span>
              </div>
              <div className="mt-4 flex items-center gap-2 text-[11px] text-[#525252]">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#0a0a0a] text-white">
                  E
                </span>
                <span className="font-medium text-[#0a0a0a]">Emeka</span>
                <span className="text-[#a3a3a3]">· London, UK</span>
              </div>
            </div>

            {/* Recipient card */}
            <div className="rounded-xl border border-[#0a0a0a] bg-[#0a0a0a] p-5 text-white">
              <div className="text-[10px] uppercase tracking-[0.18em] text-white/50">
                Mom receives
              </div>
              <div className="mt-2 flex items-baseline gap-1.5 font-mono">
                <span className="text-[16px] text-white/60">₦</span>
                <span className="text-[40px] font-semibold leading-none tracking-[-0.02em]">
                  210,000
                </span>
              </div>
              <div className="mt-4 flex items-center gap-2 text-[11px] text-white/60">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-[#0a0a0a]">
                  A
                </span>
                <span className="font-medium text-white">Adaeze</span>
                <span className="text-white/40">· Lagos · mobile money</span>
              </div>
            </div>
          </div>

          {/* Fee + speed bar */}
          <div className="mt-4 flex items-center justify-between rounded-lg border border-[#e5e5e5] bg-[#fafafa] px-4 py-2.5">
            <div className="flex items-center gap-3 font-mono text-[11px] text-[#525252]">
              <span>
                fee <span className="text-[#0a0a0a]">$0.42</span>
              </span>
              <span className="text-[#d3d3d3]">·</span>
              <span>
                arrives in <span className="text-[#0a0a0a]">2 sec</span>
              </span>
              <span className="text-[#d3d3d3]">·</span>
              <span>
                rate <span className="text-[#0a0a0a]">£1 = ₦2,100</span>
              </span>
            </div>
            <div className="rounded bg-[#0a0a0a] px-3 py-1.5 text-[11px] font-medium text-white">
              Send now
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  subtle,
}: {
  label: string;
  value: string;
  subtle?: string;
}) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/40">
        {label}
      </div>
      <div className="mt-1.5 font-display text-[18px] font-medium tracking-tight text-white md:text-[20px]">
        {value}
      </div>
      {subtle && (
        <div className="mt-0.5 font-mono text-[10px] text-white/35">
          {subtle}
        </div>
      )}
    </div>
  );
}

function humanizeError(code: string): string {
  const map: Record<string, string> = {
    bad_state: "Session expired. Try again.",
    missing_code: "Sign-in cancelled.",
    unverified_email: "Your Google email is not verified.",
    bad_audience: "OAuth client mismatch.",
    session_expired: "You were signed out — sign in again to pick up where you left off.",
  };
  return map[code] ?? "Something went sideways. Try again.";
}
