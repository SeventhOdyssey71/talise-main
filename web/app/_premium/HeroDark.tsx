"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import { gsap } from "gsap";

const TESTFLIGHT_URL = "https://testflight.apple.com/join/BFNEPYtM";

/**
 * Premium DARK Renaissance hero. A full-bleed mint-lit oil painting (diverse
 * people around a glowing globe — cross-border), a layered headline with a
 * ghosted/blurred duplicate behind it (the glassmorphism-depth reference), a
 * floating glass-orb accent, and GSAP reveals. Near-black, mint accent — the
 * "$100k" feel. Self-contained dark colours (doesn't depend on the mint theme).
 */
export default function HeroDark({ err }: { err?: string }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ctx = gsap.context((self) => {
      const q = self.selector!;
      if (reduce) {
        gsap.set(q(".hd-anim"), { opacity: 1, y: 0 });
        return;
      }
      gsap.set(q(".hd-art"), { scale: 1.08, opacity: 0 });
      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
      tl.to(q(".hd-art"), { opacity: 1, scale: 1, duration: 1.6, ease: "power2.out" }, 0)
        .from(q(".hd-eyebrow"), { opacity: 0, y: 14, duration: 0.6 }, 0.3)
        .from(q(".hd-line"), { opacity: 0, yPercent: 60, duration: 0.95, stagger: 0.12, ease: "power4.out" }, 0.4)
        .from(q(".hd-ghost"), { opacity: 0, duration: 1.2 }, 0.5)
        .from(q(".hd-sub"), { opacity: 0, y: 16, duration: 0.7 }, "-=0.5")
        .from(q(".hd-cta"), { opacity: 0, y: 16, duration: 0.6, stagger: 0.08 }, "-=0.45")
        .from(q(".hd-trust"), { opacity: 0, duration: 0.6 }, "-=0.3");
      // gentle float on the glass-orb accent
      gsap.to(q(".hd-orb"), { y: -18, rotation: 6, duration: 4, ease: "sine.inOut", yoyo: true, repeat: -1 });
    }, root);
    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={root}
      className="relative left-1/2 w-screen -translate-x-1/2 overflow-hidden bg-[#080d09]"
      style={{ minHeight: "100svh" }}
    >
      {/* full-bleed painting */}
      <div className="hd-art absolute inset-0">
        <Image
          src="/landing/hero-globe.png"
          alt="People around a glowing globe"
          fill
          priority
          className="object-cover object-center"
          sizes="100vw"
        />
        {/* scrims: darken left for text legibility + a vignette */}
        <div className="absolute inset-0 bg-gradient-to-r from-[#050807]/95 via-[#050807]/70 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#050807] via-transparent to-[#050807]/55" />
      </div>

      {/* floating glass-orb accent */}
      <div className="hd-orb pointer-events-none absolute right-[6%] top-[16%] hidden h-44 w-72 opacity-90 mix-blend-screen lg:block">
        <Image src="/landing/glass-orbs.png" alt="" fill className="object-contain" sizes="288px" />
      </div>

      {/* content */}
      <div className="relative z-10 mx-auto flex min-h-[100svh] w-full max-w-[1440px] flex-col justify-center px-6 py-28 md:px-12 lg:px-16">
        <div className="max-w-[760px]">
          <div className="hd-eyebrow mb-6 inline-flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.34em] text-[#CAFFB8]">
            <span className="inline-block h-px w-10 bg-[#CAFFB8]/60" />
            Cross-border dollars · Built on Sui
          </div>

          {/* layered headline: a blurred ghost behind the crisp text */}
          <div className="relative">
            <h1
              aria-hidden
              className="hd-ghost pointer-events-none absolute inset-0 select-none text-[clamp(40px,6.6vw,86px)] font-semibold leading-[0.98] tracking-[-0.03em] text-[#CAFFB8] opacity-25 blur-[14px]"
            >
              Send dollars home, in seconds.
            </h1>
            <h1 className="relative text-[clamp(40px,6.6vw,86px)] font-semibold leading-[0.98] tracking-[-0.03em] text-[#F4F7F2]">
              <span className="hd-line block">Send dollars home,</span>
              <span className="hd-line block">
                in{" "}
                <span className="italic text-[#CAFFB8]" style={{ fontFamily: "var(--font-serif)" }}>
                  seconds
                </span>
                .
              </span>
            </h1>
          </div>

          <p className="hd-sub mt-7 max-w-[540px] text-[17px] leading-[1.6] text-[#c5d2c6]">
            Hold real dollars. Send them to a name. Cash out in your own currency.
            No seed phrase, no gas to think about — money that finally makes sense.
          </p>

          <div className="mt-10 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            <a
              href={TESTFLIGHT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="hd-cta inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#CAFFB8] px-7 text-[14px] font-semibold text-[#0A130C] shadow-[0_12px_40px_-12px_rgba(202,255,184,0.55)] transition-transform hover:-translate-y-0.5"
            >
              <AppleGlyph /> Get the app · TestFlight
            </a>
            <a
              href="/waitlist"
              className="hd-cta inline-flex h-12 items-center justify-center rounded-full border border-white/20 bg-white/[0.04] px-7 text-[14px] font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/[0.1]"
            >
              See how it works
            </a>
          </div>

          <div className="hd-trust mt-7 font-mono text-[11px] tracking-[0.04em] text-[#7f8c81]">
            Sign in with Google — that&apos;s your wallet. Nothing to install.
          </div>
          {err ? <p className="mt-4 text-[13px] text-[#ffb4a2]">{decodeURIComponent(err)}</p> : null}
        </div>
      </div>

      {/* scroll cue */}
      <div className="pointer-events-none absolute bottom-7 left-1/2 -translate-x-1/2 font-mono text-[10px] uppercase tracking-[0.3em] text-white/40">
        Scroll
      </div>
    </section>
  );
}

function AppleGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M16.365 1.43c0 1.14-.493 2.27-1.177 3.08-.744.9-1.99 1.57-2.987 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.572-2.27 1.206-2.98.804-.94 2.142-1.64 3.248-1.68.03.13.05.28.05.43zm4.565 15.71c-.03.07-.463 1.58-1.518 3.12-.945 1.34-1.94 2.71-3.43 2.71-1.517 0-1.9-.88-3.63-.88-1.698 0-2.302.91-3.67.91-1.377 0-2.332-1.26-3.428-2.8-1.287-1.82-2.323-4.63-2.323-7.28 0-4.28 2.797-6.55 5.552-6.55 1.448 0 2.675.95 3.6.95.865 0 2.222-1.01 3.902-1.01.613 0 2.886.06 4.374 2.19-.13.09-2.383 1.37-2.383 4.19 0 3.26 2.854 4.42 2.955 4.45z" />
    </svg>
  );
}
