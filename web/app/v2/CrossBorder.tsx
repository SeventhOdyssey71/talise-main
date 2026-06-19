"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

/** Handles that ring the globe — playful, on-brand `name@talise` pills. */
const HANDLES: { handle: string; bg: string; tilt: string }[] = [
  { handle: "ada@talise", bg: "#CAFFB8", tilt: "-3deg" },
  { handle: "kofi@talise", bg: "#FF9E7A", tilt: "2.5deg" },
  { handle: "mei@talise", bg: "#C9B8FF", tilt: "-2deg" },
  { handle: "diego@talise", bg: "#FFE59E", tilt: "3deg" },
  { handle: "noor@talise", bg: "#d8f5c6", tilt: "-2.5deg" },
];

/**
 * v2 cross-border beat — "pay people around the world".
 * Big Bricolage headline with mint highlighter swipe, short subline, and a
 * playful CSS/SVG globe ringed by `name@talise` pills. A clearly-marked slot
 * is left for the future /v2/globe.png 3D illustration. GSAP scroll-reveal,
 * with a prefers-reduced-motion early return.
 */
export default function CrossBorder() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = gsap.context((self) => {
      gsap.registerPlugin(ScrollTrigger);
      const q = self.selector!;
      gsap.set(q(".cb-hl"), { scaleX: 0, transformOrigin: "left center" });
      gsap
        .timeline({ scrollTrigger: { trigger: root.current, start: "top 72%" } })
        .from(q(".cb-head .v2-word"), { yPercent: 115, duration: 0.7, stagger: 0.06, ease: "power4.out" })
        .to(q(".cb-hl"), { scaleX: 1, duration: 0.5, ease: "power2.inOut" }, "-=0.2")
        .from(q(".cb-sub"), { opacity: 0, y: 16, duration: 0.6, ease: "power3.out" }, "-=0.3")
        .from(q(".cb-globe"), { opacity: 0, y: 40, scale: 0.92, duration: 0.85, ease: "back.out(1.5)" }, "-=0.45")
        .from(q(".cb-pill"), { opacity: 0, scale: 0.6, duration: 0.55, stagger: 0.08, ease: "back.out(2)" }, "-=0.5");

      // gentle float on the globe + a slow spin on the orbit ring
      gsap.to(q(".cb-globe"), { y: -12, duration: 3.2, ease: "sine.inOut", yoyo: true, repeat: -1 });
      gsap.to(q(".cb-orbit"), { rotate: 360, duration: 60, ease: "none", repeat: -1, transformOrigin: "50% 50%" });
    }, root);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={root} className="mx-auto grid max-w-[1200px] items-center gap-14 px-6 pb-28 pt-12 md:px-10 lg:grid-cols-[1fr_1.05fr] lg:gap-10 lg:pt-20">
      {/* copy */}
      <div className="cb-head">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#15300c]/15 bg-white/60 px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.22em] text-[#3d7a29] backdrop-blur-sm">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#3d7a29]" /> Going global, finally
        </div>

        <h2
          className="text-[clamp(36px,6vw,80px)] font-[800] leading-[0.96] tracking-[-0.035em] text-[#15300c]"
          style={{ fontFamily: "var(--font-display-v2)" }}
        >
          <span className="block overflow-hidden pb-[0.06em]"><span className="v2-word inline-block">Send money</span></span>
          <span className="block overflow-hidden pb-[0.06em]"><span className="v2-word inline-block">across the world.</span></span>
          <span className="relative mt-1 inline-block overflow-visible">
            <span className="cb-hl absolute inset-x-[-8px] inset-y-[6px] -z-0 -rotate-[1.5deg] rounded-[14px] bg-[#CAFFB8]" />
            <span className="v2-word relative z-10 inline-block">In seconds.</span>
          </span>
        </h2>

        <p className="cb-sub mt-7 max-w-[440px] text-[17px] leading-[1.55] text-[#3a5230]">
          Send to a name like <span className="font-mono text-[15px] text-[#15300c]">ada@talise</span> — across
          borders, and it arrives in seconds. Stablecoin transactions on Sui cost nothing.
        </p>
      </div>

      {/* playful globe + ring of name@talise pills */}
      <div className="relative mx-auto flex w-full max-w-[460px] items-center justify-center py-8">
        {/* slowly-rotating orbit ring the pills sit on */}
        <div className="cb-orbit absolute inset-0">
          <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden="true">
            <circle cx="50" cy="50" r="46" fill="none" stroke="#15300c" strokeOpacity="0.12" strokeWidth="0.6" strokeDasharray="2.4 2.4" />
          </svg>
        </div>

        {/* the globe — CSS/SVG for now.
            DROP-IN SLOT: replace the inner <div className="cb-globe-art"> with
            <Image src="/v2/globe.png" .../> when the 3D illustration is ready. */}
        <div className="cb-globe relative z-10 flex h-[260px] w-[260px] items-center justify-center">
          {/* 3D globe illustration */}
          <Image
            src="/v2/globe.png"
            alt="Globe"
            width={260}
            height={260}
            className="cb-globe-art h-[250px] w-[250px] object-contain drop-shadow-[12px_12px_0_rgba(21,48,12,0.85)]"
          />
        </div>

        {/* name@talise pills ringing the globe */}
        {HANDLES.map((h, i) => {
          // place pills evenly around the circle, starting at the top
          const angle = (i / HANDLES.length) * Math.PI * 2 - Math.PI / 2;
          const radius = 47; // % of container
          const left = 50 + Math.cos(angle) * radius;
          const top = 50 + Math.sin(angle) * radius;
          return (
            <span
              key={h.handle}
              className="cb-pill absolute z-20 whitespace-nowrap rounded-full px-3.5 py-1.5 font-mono text-[12px] font-medium text-[#15300c]"
              style={{
                left: `${left}%`,
                top: `${top}%`,
                transform: `translate(-50%, -50%) rotate(${h.tilt})`,
                background: h.bg,
                boxShadow: "4px 4px 0 #15300c",
              }}
            >
              {h.handle}
            </span>
          );
        })}
      </div>
    </section>
  );
}
