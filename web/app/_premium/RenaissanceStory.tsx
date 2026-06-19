"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

type Row = {
  img: string;
  alt: string;
  ratio: string; // tailwind aspect class
  eyebrow: string;
  title: React.ReactNode;
  body: string;
};

const ROWS: Row[] = [
  {
    img: "/landing/hold-dollars.png", alt: "A figure holding glowing coins", ratio: "aspect-[3/4]",
    eyebrow: "Hold", title: <>Hold <em>real</em> dollars.</>,
    body: "Your balance is genuine US dollars on Sui — not a fragile IOU. Hold it, spend it, or send it, any time you want.",
  },
  {
    img: "/landing/send-to-name.png", alt: "Two figures passing a glowing coin", ratio: "aspect-[16/9]",
    eyebrow: "Send", title: <>Send to a <em>name</em>.</>,
    body: "Type a handle like sele@talise, enter an amount, send. It arrives in seconds — stablecoin transactions on Sui cost nothing.",
  },
  {
    img: "/landing/earn.png", alt: "A sapling growing from coins", ratio: "aspect-[16/9]",
    eyebrow: "Earn", title: <>Idle money that <em>grows</em>.</>,
    body: "The moment your balance sits still, Talise puts it to work — auto-routed to a working rate, and always yours to move.",
  },
  {
    img: "/landing/cashout.png", alt: "Exchanging a coin for local currency", ratio: "aspect-[16/9]",
    eyebrow: "Cash out", title: <>Cash out <em>at home</em>.</>,
    body: "Turn dollars back into your local currency, or wire USD to your bank. Enter an amount, withdraw — Talise handles the rest.",
  },
  {
    img: "/landing/onboarding.png", alt: "A figure receiving a glowing orb", ratio: "aspect-[4/3]",
    eyebrow: "Start", title: <>Sign in. That&apos;s your <em>wallet</em>.</>,
    body: "Sign in with Google and you're in — no seed phrase, nothing to install, nothing to lose on a sticky note.",
  },
];

export default function RenaissanceStory() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const ctx = gsap.context((self) => {
      gsap.registerPlugin(ScrollTrigger);
      const rows = self.selector!(".rs-row") as HTMLElement[];
      rows.forEach((rowEl) => {
        const q = gsap.utils.selector(rowEl);
        gsap
          .timeline({ scrollTrigger: { trigger: rowEl, start: "top 78%" } })
          .from(q(".rs-img"), { opacity: 0, y: 60, scale: 0.96, duration: 1.0, ease: "power3.out" })
          .from(q(".rs-eyebrow"), { opacity: 0, y: 16, duration: 0.5 }, "-=0.7")
          .from(q(".rs-title"), { opacity: 0, y: 24, duration: 0.7 }, "-=0.55")
          .from(q(".rs-body"), { opacity: 0, y: 18, duration: 0.6 }, "-=0.5");
        // subtle parallax on the painting as the row scrolls through
        gsap.to(q(".rs-img img"), {
          yPercent: -8, ease: "none",
          scrollTrigger: { trigger: rowEl, start: "top bottom", end: "bottom top", scrub: true },
        });
      });
    }, root);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={root} className="relative mx-auto mt-24 w-full max-w-[1180px] md:mt-36">
      <div className="mb-16 text-center md:mb-24">
        <div className="mb-4 inline-flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.3em] text-[#CAFFB8]">
          <span className="inline-block h-px w-8 bg-[#CAFFB8]/60" /> How Talise works
        </div>
        <h2 className="mx-auto max-w-[760px] text-[clamp(30px,4.6vw,52px)] font-medium leading-[1.06] tracking-[-0.02em] text-[#F4F7F2]">
          Money that finally{" "}
          <span className="italic text-[#CAFFB8]" style={{ fontFamily: "var(--font-serif)" }}>
            makes sense
          </span>
          .
        </h2>
      </div>

      <div className="flex flex-col gap-24 md:gap-36">
        {ROWS.map((r, i) => (
          <div
            key={r.img}
            className={`rs-row grid items-center gap-10 md:gap-14 lg:grid-cols-2 ${
              i % 2 === 1 ? "lg:[&>.rs-copy]:order-first" : ""
            }`}
          >
            {/* painting in a glassy frame */}
            <div className="rs-img relative">
              <div
                className={`relative ${r.ratio} w-full overflow-hidden rounded-[22px] border border-white/10`}
                style={{ boxShadow: "0 40px 90px -40px rgba(0,0,0,0.8), inset 0 0 0 1px rgba(202,255,184,0.06)" }}
              >
                <Image src={r.img} alt={r.alt} fill className="object-cover" sizes="(max-width:1024px) 100vw, 560px" />
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#080d09]/40 to-transparent" />
              </div>
              {/* soft mint glow behind */}
              <div className="pointer-events-none absolute -inset-6 -z-10 rounded-[40px] bg-[#CAFFB8]/10 blur-3xl" />
            </div>

            {/* copy */}
            <div className="rs-copy">
              <div className="rs-eyebrow mb-4 font-mono text-[11px] uppercase tracking-[0.3em] text-[#CAFFB8]">
                {String(i + 1).padStart(2, "0")} · {r.eyebrow}
              </div>
              <h3 className="rs-title text-[clamp(28px,3.6vw,44px)] font-medium leading-[1.08] tracking-[-0.02em] text-[#F4F7F2] [&_em]:font-normal [&_em]:italic [&_em]:text-[#CAFFB8] [&_em]:[font-family:var(--font-serif)]">
                {r.title}
              </h3>
              <p className="rs-body mt-5 max-w-[460px] text-[16px] leading-[1.65] text-[#b6c4b8]">
                {r.body}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
