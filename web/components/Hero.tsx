"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import { useEffect } from "react";
import { SignInButton } from "./SignInButton";

// Match the server-side rule in `lib/db.ts`. Keep in sync.
const REFERRAL_CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;

export function Hero({ errorCode }: { errorCode?: string }) {
  // Capture `?ref=CODE` from the URL into an httpOnly cookie on mount so the
  // attribution survives the OAuth round-trip.
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const raw = params.get("ref");
      if (!raw) return;
      const code = raw.trim().toUpperCase();
      if (!REFERRAL_CODE_RE.test(code)) return;
      fetch("/api/referral/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      }).catch(() => {});
    } catch {}
  }, []);

  return (
    <section className="relative w-full overflow-hidden bg-[#fafaf7] text-[#111]">
      {/* The cosmic galaxy hero, anchored behind the headline. Light bleed
          on top + bottom of the page ensures the section blends into the
          surrounding cream without a hard seam. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-20 mx-auto h-[720px] w-[110%] max-w-[1600px] opacity-90"
      >
        <Image
          src="/landing-hero.png"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover object-center"
        />
        {/* Soft cream fade so the bottom of the galaxy melts into the
            section background without a visible edge. */}
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-b from-transparent to-[#fafaf7]"
        />
      </div>

      <div className="relative z-10 mx-auto flex max-w-6xl flex-col items-center px-6 pt-36 pb-20 text-center md:pt-44 md:pb-28">
        {/* Status pill */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="inline-flex items-center gap-2 rounded-full border border-[#e8e1cf] bg-white/60 px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-[#6b6457] backdrop-blur"
        >
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#c08a3e] opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#c08a3e]" />
          </span>
          UK · US · EU corridors live
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.1, ease: [0.2, 0.8, 0.2, 1] }}
          className="mt-10 max-w-4xl text-[44px] font-medium leading-[1.04] tracking-[-0.03em] md:text-[80px]"
        >
          Send money across
          <br />
          the globe.{" "}
          <span className="font-serif italic font-normal tracking-normal text-[#5a554a]">
            For free.
          </span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="mx-auto mt-7 max-w-2xl text-[16px] leading-[1.6] text-[#5a554a] md:text-[18px]"
        >
          Talise moves naira, shillings, cedis, and rand across borders in
          seconds — at a fraction of what Wise, Western Union, or Remitly
          charge. Sign in with Google. No app, no agent, no queue.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="mt-9 flex flex-wrap items-center justify-center gap-3"
        >
          <SignInButton variant="full" />
          <a
            href="#how"
            className="rounded-md border border-[#0a0a0a]/12 bg-white/70 px-5 py-3 text-[14px] text-[#1a1a1a] transition hover:bg-white"
          >
            How it works ↓
          </a>
        </motion.div>

        {errorCode && (
          <p className="mt-5 text-[12px] text-[#a05a3e]">
            ! {humanizeError(errorCode)}
          </p>
        )}

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.45 }}
          className="mt-7 font-mono text-[11px] uppercase tracking-[0.22em] text-[#8a8472]"
        >
          First send is on us
        </motion.div>
      </div>

      {/* Thin stat strip — moved BELOW the hero for breathing room. */}
      <div className="relative z-10 mx-auto max-w-5xl px-6 pb-16 md:pb-20">
        <div className="grid grid-cols-2 gap-x-8 gap-y-5 border-t border-[#e8e1cf] pt-8 md:grid-cols-4">
          <Metric label="Avg send fee" value="<1%" subtle="vs WU ~6.4%" />
          <Metric label="Settlement" value="~1 sec" subtle="one block" />
          <Metric label="Gas paid by sender" value="$0.00" subtle="we cover it" />
          <Metric label="Currencies" value="₦ KSh GH₵ R" subtle="more soon" />
        </div>
      </div>
    </section>
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
    <div className="text-left">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#8a8472]">
        {label}
      </div>
      <div className="mt-1.5 text-[20px] font-medium tracking-[-0.02em] text-[#111]">
        {value}
      </div>
      {subtle && (
        <div className="mt-0.5 font-mono text-[10px] text-[#a09a8a]">
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
    session_expired:
      "You were signed out — sign in again to pick up where you left off.",
  };
  return map[code] ?? "Something went sideways. Try again.";
}
