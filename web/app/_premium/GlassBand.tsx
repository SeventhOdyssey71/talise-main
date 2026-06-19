"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

const POINTS = [
  { k: "Instant", v: "Transfers settle in a blink — money arrives in seconds, any time of day." },
  { k: "Costs nothing", v: "Stablecoin transactions on Sui cost nothing. No spread games, no surprise fees." },
  { k: "Gas, sponsored", v: "Talise covers the network gas — you never hold it, see it, or think about it." },
];

/**
 * "Why Sui" glass band — the glassmorphism beat (Elva reference): a cluster of
 * glass orbs with a big headline layered over a blurred ghost twin for depth,
 * then three quiet proof points. Dark, mint accent, GSAP scroll reveal.
 */
export default function GlassBand() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = gsap.context((self) => {
      gsap.registerPlugin(ScrollTrigger);
      const q = self.selector!;
      gsap.to(q(".gb-orbs"), { y: -16, duration: 4.5, ease: "sine.inOut", yoyo: true, repeat: -1 });
      gsap
        .timeline({ scrollTrigger: { trigger: root.current, start: "top 72%" } })
        .from(q(".gb-orbs"), { opacity: 0, scale: 0.9, duration: 1.1, ease: "power2.out" })
        .from(q(".gb-head"), { opacity: 0, y: 28, duration: 0.8 }, "-=0.7")
        .from(q(".gb-ghost"), { opacity: 0, duration: 1.0 }, "-=0.6")
        .from(q(".gb-pt"), { opacity: 0, y: 22, duration: 0.6, stagger: 0.12 }, "-=0.4");
    }, root);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={root} className="relative mx-auto mt-32 w-full max-w-[1100px] text-center md:mt-44">
      {/* glass orbs centerpiece */}
      <div className="gb-orbs relative mx-auto h-[260px] w-full max-w-[720px] md:h-[340px]">
        <Image src="/landing/glass-orbs.png" alt="" fill priority={false} className="object-contain mix-blend-screen" sizes="720px" />
        <div className="pointer-events-none absolute inset-0 -z-10 mx-auto h-[70%] w-[70%] translate-y-6 rounded-full bg-[#CAFFB8]/12 blur-3xl" />
      </div>

      {/* layered headline */}
      <div className="relative -mt-6 md:-mt-10">
        <h2 aria-hidden className="gb-ghost pointer-events-none absolute inset-0 select-none text-[clamp(30px,5vw,60px)] font-semibold leading-[1.02] tracking-[-0.02em] text-[#CAFFB8] opacity-20 blur-[16px]">
          The rails finally match the promise.
        </h2>
        <h2 className="gb-head relative mx-auto max-w-[820px] text-[clamp(30px,5vw,60px)] font-medium leading-[1.04] tracking-[-0.02em] text-[#F4F7F2]">
          The rails finally{" "}
          <span className="italic text-[#CAFFB8]" style={{ fontFamily: "var(--font-serif)" }}>
            match the promise
          </span>
          .
        </h2>
      </div>

      <p className="mx-auto mt-5 max-w-[560px] text-[15px] leading-[1.6] text-[#9fb0a1]">
        Talise is built on Sui — so the money moves the way a message does.
      </p>

      {/* proof points */}
      <div className="mt-14 grid gap-4 sm:grid-cols-3">
        {POINTS.map((p) => (
          <div
            key={p.k}
            className="gb-pt rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-left backdrop-blur-sm"
            style={{ boxShadow: "inset 0 0 0 1px rgba(202,255,184,0.05)" }}
          >
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#CAFFB8]">{p.k}</div>
            <p className="mt-3 text-[14px] leading-[1.55] text-[#b6c4b8]">{p.v}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
