"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

type Card = { tag: string; title: string; body: string; bg: string; glyph: string; tilt: string };

const CARDS: Card[] = [
  {
    tag: "Instant",
    title: "Settles in a blink.",
    body: "Transfers clear on Sui the moment you tap send — your money arrives in seconds, not days.",
    bg: "#FF9E7A",
    glyph: "⚡",
    tilt: "-1.5deg",
  },
  {
    tag: "Costs nothing",
    title: "Costs nothing to move.",
    body: "Stablecoin transactions on Sui cost nothing — send a dollar or a thousand, the amount lands whole.",
    bg: "#C9B8FF",
    glyph: "🪙",
    tilt: "1.4deg",
  },
  {
    tag: "Gas, sponsored",
    title: "We cover the gas.",
    body: "Talise pays the network gas on every move. You never hold it, never top it up, never even see it.",
    bg: "#FFE59E",
    glyph: "🛡️",
    tilt: "-1.1deg",
  },
];

/**
 * v2 "Why Sui" / trust beat — the rails finally match the promise.
 * Bricolage headline word-reveal + mint highlighter swipe, then a row of three
 * bento cards (coral / lilac / butter, hard offset shadow, slight tilt) that pop
 * in on scroll. Respects prefers-reduced-motion.
 */
export default function WhySui() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = gsap.context((self) => {
      gsap.registerPlugin(ScrollTrigger);
      const q = self.selector!;
      gsap.set(q(".ws-hl"), { scaleX: 0, transformOrigin: "left center" });
      gsap
        .timeline({ scrollTrigger: { trigger: root.current, start: "top 75%" } })
        .from(q(".ws-head .v2-word"), { yPercent: 115, duration: 0.7, stagger: 0.06, ease: "power4.out" })
        .to(q(".ws-hl"), { scaleX: 1, duration: 0.5, ease: "power2.inOut" }, "-=0.2")
        .from(q(".ws-card"), { opacity: 0, y: 48, scale: 0.94, duration: 0.7, stagger: 0.1, ease: "back.out(1.5)" }, "-=0.2");
    }, root);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={root} className="mx-auto max-w-[1180px] px-6 pt-20 pb-28 md:px-10 md:pt-28">
      <div className="ws-head mb-14 max-w-[760px]">
        <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.28em] text-[#3d7a29]">Built on Sui</div>
        <h2 className="text-[clamp(32px,5vw,60px)] font-[800] leading-[0.98] tracking-[-0.03em]" style={{ fontFamily: "var(--font-display-v2)" }}>
          <span className="block overflow-hidden pb-[0.06em]"><span className="v2-word inline-block">The rails finally</span></span>
          <span className="relative inline-block">
            <span className="ws-hl absolute inset-x-[-8px] inset-y-[6px] -z-0 -rotate-[1.2deg] rounded-[12px] bg-[#CAFFB8]" />
            <span className="v2-word relative z-10 inline-block">match the promise.</span>
          </span>
        </h2>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {CARDS.map((c) => (
          <article
            key={c.tag}
            className="ws-card relative overflow-hidden rounded-[28px] p-7 md:p-9"
            style={{ background: c.bg, boxShadow: "10px 10px 0 #15300c", transform: `rotate(${c.tilt})` }}
          >
            <div className="flex items-start justify-between">
              <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#15300c]/70">{c.tag}</div>
              <div className="text-[40px] leading-none">{c.glyph}</div>
            </div>
            <h3 className="mt-6 text-[clamp(24px,3vw,32px)] font-[800] leading-[1.02] tracking-[-0.02em] text-[#15300c]" style={{ fontFamily: "var(--font-display-v2)" }}>
              {c.title}
            </h3>
            <p className="mt-3 max-w-[320px] text-[15px] leading-[1.5] text-[#15300c]/75">{c.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
