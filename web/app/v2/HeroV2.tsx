"use client";

import { useEffect, useRef } from "react";
import Lenis from "lenis";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

const TESTFLIGHT_URL = "https://testflight.apple.com/join/BFNEPYtM";

/**
 * v2 hero — bold, playful, type-driven (Wero-inspired) in Talise mint brand.
 * Giant Bricolage headline that clip-reveals word-by-word, a mint highlighter
 * swipe on the key phrase, a hero bento card, and the floating pill nav.
 * Initialises Lenis smooth scroll for the whole v2 page.
 */
export default function HeroV2() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Lenis smooth scroll for the page
    let lenis: Lenis | null = null;
    if (!reduce) {
      gsap.registerPlugin(ScrollTrigger);
      lenis = new Lenis({ lerp: 0.1, smoothWheel: true });
      lenis.on("scroll", ScrollTrigger.update);
      const onRaf = (t: number) => lenis!.raf(t * 1000);
      gsap.ticker.add(onRaf);
      gsap.ticker.lagSmoothing(0);
    }

    const ctx = gsap.context((self) => {
      const q = self.selector!;
      if (reduce) {
        gsap.set(q(".v2-word, .v2-anim"), { opacity: 1, y: 0, yPercent: 0 });
        gsap.set(q(".v2-hl"), { scaleX: 1 });
        gsap.set(q(".v2-card"), { opacity: 1, y: 0, rotate: -2 });
        return;
      }
      gsap.set(q(".v2-hl"), { scaleX: 0, transformOrigin: "left center" });
      const tl = gsap.timeline({ defaults: { ease: "power4.out" } });
      tl.from(q(".v2-eyebrow"), { opacity: 0, y: 14, duration: 0.5 })
        .from(q(".v2-word"), { yPercent: 115, duration: 0.85, stagger: 0.07 }, "-=0.1")
        .to(q(".v2-hl"), { scaleX: 1, duration: 0.55, ease: "power2.inOut" }, "-=0.25")
        .from(q(".v2-sub"), { opacity: 0, y: 16, duration: 0.6 }, "-=0.4")
        .from(q(".v2-cta"), { opacity: 0, y: 16, duration: 0.5, stagger: 0.08 }, "-=0.4")
        .from(q(".v2-card"), { opacity: 0, y: 40, rotate: 4, duration: 0.9, ease: "back.out(1.6)" }, "-=0.6")
        .from(q(".v2-nav"), { opacity: 0, y: 24, duration: 0.6 }, "-=0.5");
      gsap.to(q(".v2-coin"), { y: -14, rotate: 6, duration: 3, ease: "sine.inOut", yoyo: true, repeat: -1 });
    }, root);

    return () => {
      ctx.revert();
      lenis?.destroy();
    };
  }, []);

  return (
    <div ref={root}>
      <section className="mx-auto grid max-w-[1280px] items-center gap-12 px-6 pt-24 pb-16 md:px-10 lg:grid-cols-[1.15fr_1fr] lg:pt-28">
        {/* copy */}
        <div>
          <div className="v2-eyebrow mb-6 inline-flex items-center gap-2 rounded-full border border-[#15300c]/15 bg-white/60 px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.22em] text-[#3d7a29] backdrop-blur-sm">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#3d7a29]" /> Dollars, on Sui
          </div>

          <h1
            className="text-[clamp(44px,7vw,96px)] font-[800] leading-[0.95] tracking-[-0.035em]"
            style={{ fontFamily: "var(--font-display-v2)" }}
          >
            <Line>Money that</Line>
            <Line>moves like a</Line>
            <span className="relative mt-1 inline-block overflow-visible">
              <span className="v2-hl absolute inset-x-[-8px] inset-y-[6px] -z-0 -rotate-[1.5deg] rounded-[14px] bg-[#CAFFB8]" />
              <span className="v2-word relative z-10 inline-block">message.</span>
            </span>
          </h1>

          <p className="v2-sub mt-7 max-w-[460px] text-[17px] leading-[1.55] text-[#3a5230]">
            Hold real dollars, send them to a name, cash out at home. No seed
            phrase, no gas to think about — money that finally makes sense.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <a
              href={TESTFLIGHT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="v2-cta inline-flex h-12 items-center gap-2 rounded-full bg-[#15300c] px-7 text-[15px] font-semibold text-[#f7fcf2] transition-transform hover:-translate-y-0.5"
            >
              Get the app
              <span aria-hidden>↗</span>
            </a>
            <a
              href="/waitlist"
              className="v2-cta inline-flex h-12 items-center rounded-full border-2 border-[#15300c] px-7 text-[15px] font-semibold text-[#15300c] transition-colors hover:bg-[#15300c] hover:text-[#f7fcf2]"
            >
              How it works
            </a>
          </div>
        </div>

        {/* hero card */}
        <div className="v2-card relative mx-auto w-full max-w-[420px] -rotate-2">
          <div
            className="relative overflow-hidden rounded-[32px] bg-gradient-to-br from-[#3d7a29] to-[#1c4513] p-8 text-[#f7fcf2]"
            style={{ boxShadow: "14px 14px 0 #15300c" }}
          >
            <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#CAFFB8]">Your balance</div>
            <div className="mt-2 text-[44px] font-[800] leading-none" style={{ fontFamily: "var(--font-display-v2)" }}>
              $1,240.00
            </div>
            <div className="mt-1 font-mono text-[12px] text-[#cfe9c2]">1,240.00 USDsui · earning</div>

            <div className="mt-7 rounded-2xl bg-[#0e2a08]/60 p-4">
              <div className="font-mono text-[11px] text-[#9fc78c]">SEND TO</div>
              <div className="mt-1 text-[20px] font-semibold">sele@talise</div>
              <div className="mt-3 flex items-center justify-between">
                <span className="font-mono text-[12px] text-[#cfe9c2]">arrives in seconds</span>
                <span className="rounded-full bg-[#CAFFB8] px-4 py-1.5 text-[13px] font-bold text-[#15300c]">Send →</span>
              </div>
            </div>
          </div>
          {/* floating coin accent */}
          <div
            className="v2-coin absolute -right-5 -top-6 flex h-20 w-20 items-center justify-center rounded-full bg-[#FFE59E] text-[30px] font-[800] text-[#15300c]"
            style={{ boxShadow: "6px 6px 0 #15300c", fontFamily: "var(--font-display-v2)" }}
          >
            $
          </div>
        </div>
      </section>

      {/* floating pill nav */}
      <nav className="v2-nav pointer-events-auto fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full border border-[#15300c]/10 bg-white/85 px-2 py-2 shadow-[0_10px_40px_-12px_rgba(21,48,12,0.35)] backdrop-blur-md">
        {["What it is", "How", "Earn", "FAQ"].map((l) => (
          <a key={l} href="#" className="rounded-full px-4 py-2 text-[14px] font-medium text-[#15300c] transition-colors hover:bg-[#15300c]/[0.06]">
            {l}
          </a>
        ))}
        <a href={TESTFLIGHT_URL} target="_blank" rel="noopener noreferrer" className="ml-1 rounded-full bg-[#15300c] px-5 py-2 text-[14px] font-semibold text-[#f7fcf2]">
          Get the app
        </a>
      </nav>
    </div>
  );
}

function Line({ children }: { children: React.ReactNode }) {
  return (
    <span className="block overflow-hidden pb-[0.06em]">
      <span className="v2-word inline-block">{children}</span>
    </span>
  );
}
