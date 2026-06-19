"use client";

import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";

const TESTFLIGHT_URL = "https://testflight.apple.com/join/BFNEPYtM";

/**
 * Premium animated hero — refined mint-light. An Instrument-Serif headline that
 * clip-reveals word by word, then a CROSS-BORDER map: two headshot location
 * pins joined by a forest arc that draws itself while a mint coin races across,
 * and a center callout that flips from the old way (grey · fees · days) to
 * Talise (mint · seconds · costs nothing). Scrapbook coin floats alongside.
 *
 * Pins are placeholders (mint-ring avatars) sized + positioned to swap in the
 * Higgsfield headshot pins (see marketing/higgsfield-flow/next-video-assets.md).
 * Colours come from the .landing-mint CSS vars so the page stays on-theme.
 */
export default function PremiumHero({ err }: { err?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [flip, setFlip] = useState(false); // old-way → Talise callout

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    gsap.registerPlugin(MotionPathPlugin);

    const ctx = gsap.context((self) => {
      const q = self.selector!;
      if (reduce) {
        gsap.set(q(".ph-anim"), { opacity: 1, y: 0, clipPath: "inset(0 0 0 0)" });
        gsap.set(q(".ph-arc"), { strokeDashoffset: 0 });
        gsap.set(q(".ph-pin"), { opacity: 1, scale: 1, y: 0 });
        setFlip(true);
        return;
      }

      // Arc draw setup.
      const arc = q(".ph-arc")[0] as SVGPathElement | undefined;
      if (arc) {
        const len = arc.getTotalLength();
        gsap.set(arc, { strokeDasharray: len, strokeDashoffset: len });
      }
      gsap.set(q(".ph-coin"), { opacity: 0 });
      gsap.set(q(".ph-pin"), { opacity: 0, scale: 0.4, y: -14, transformOrigin: "50% 100%" });

      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });

      // Eyebrow + headline words + subtitle + CTAs.
      tl.from(q(".ph-eyebrow"), { opacity: 0, y: 12, duration: 0.6 })
        .from(
          q(".ph-word"),
          { yPercent: 110, opacity: 0, duration: 0.9, stagger: 0.08, ease: "power4.out" },
          "-=0.2"
        )
        .from(q(".ph-sub"), { opacity: 0, y: 16, duration: 0.7 }, "-=0.5")
        .from(q(".ph-cta"), { opacity: 0, y: 16, duration: 0.6, stagger: 0.08 }, "-=0.45")
        .from(q(".ph-trust"), { opacity: 0, duration: 0.6 }, "-=0.3");

      // Map: globe rings, pins drop in (scrapbook tilt), arc draws, coin flies,
      // callout flips.
      tl.from(q(".ph-globe"), { opacity: 0, scale: 0.85, duration: 1.0, ease: "power2.out" }, 0.2)
        .to(q(".ph-pin"), {
          opacity: 1,
          scale: 1,
          y: 0,
          duration: 0.7,
          ease: "back.out(2)",
          stagger: 0.18,
        }, 0.5)
        .to(arc ?? {}, { strokeDashoffset: 0, duration: 1.1, ease: "power2.inOut" }, 0.9)
        .set(q(".ph-coin"), { opacity: 1 }, 1.0)
        .to(
          q(".ph-coin"),
          { duration: 1.1, ease: "power1.inOut", motionPath: { path: ".ph-arc", align: ".ph-arc", alignOrigin: [0.5, 0.5] } },
          1.0
        )
        .add(() => setFlip(true), 1.7);

      // Gentle perpetual float on the scrapbook coin.
      gsap.to(q(".ph-float"), {
        y: -14,
        rotation: 4,
        duration: 3.2,
        ease: "sine.inOut",
        yoyo: true,
        repeat: -1,
      });
    }, root);

    return () => ctx.revert();
  }, []);

  return (
    <section ref={root} className="relative pt-10 md:pt-16">
      <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_1fr] lg:gap-6">
        {/* ── Copy ── */}
        <div className="text-center lg:text-left">
          <div className="ph-eyebrow inline-flex items-center gap-2.5 font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--color-fg-dim)]">
            <span aria-hidden className="inline-block h-px w-8 bg-[var(--color-accent-deep)]" />
            Cross-border dollars · Built on Sui
          </div>

          <h1 className="mt-5 text-[clamp(38px,5.6vw,68px)] font-medium leading-[1.08] tracking-[-0.03em] text-[var(--color-fg)]">
            <Word>Send</Word>
            <Word>dollars</Word>
            <Word>home</Word>
            <br />
            <Word>in</Word>
            <span className="ph-word-wrap mr-[0.26em] inline-block overflow-hidden pb-[0.12em] align-bottom">
              <span
                className="ph-word inline-block italic text-[var(--color-accent-deep)]"
                style={{ fontFamily: "var(--font-serif)" }}
              >
                seconds,
              </span>
            </span>
            <Word>not</Word>
            <Word>days.</Word>
          </h1>

          <p className="ph-sub mx-auto mt-6 max-w-[520px] text-[16px] leading-[1.6] text-[var(--color-fg-muted)] lg:mx-0">
            Hold real dollars. Send them to a name. Cash out in your own currency.
            No seed phrase, no gas to think about.
          </p>

          <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row lg:justify-start">
            <a
              href={TESTFLIGHT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="ph-cta inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[var(--color-accent-deep)] px-7 text-[14px] font-semibold text-white shadow-[0_10px_30px_-10px_rgba(35,78,20,0.5)] transition-transform hover:-translate-y-0.5"
            >
              <AppleGlyph /> Get the app · TestFlight
            </a>
            <a
              href="/waitlist"
              className="ph-cta inline-flex h-12 items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--color-accent-deep)_30%,var(--color-line))] px-7 text-[14px] font-medium text-[var(--color-fg)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-accent-deep)_6%,transparent)]"
            >
              See how it works
            </a>
          </div>

          <div className="ph-trust mt-6 font-mono text-[11px] tracking-[0.04em] text-[var(--color-fg-dim)]">
            Sign in with Google — that&apos;s your wallet. Nothing to install on web.
          </div>
          {err ? (
            <p className="mt-4 text-[13px] text-[#c0492f]">{decodeURIComponent(err)}</p>
          ) : null}
        </div>

        {/* ── Cross-border map ── */}
        <div className="relative mx-auto w-full max-w-[560px]">
          <CrossBorderMap flip={flip} />
        </div>
      </div>
    </section>
  );
}

function Word({ children }: { children: React.ReactNode }) {
  // mr gives reliable inter-word spacing (the overflow-hidden wrappers don't
  // collapse whitespace between them); pb keeps descenders from clipping.
  return (
    <span className="ph-word-wrap mr-[0.26em] inline-block overflow-hidden pb-[0.12em] align-bottom">
      <span className="ph-word inline-block">{children}</span>
    </span>
  );
}

function CrossBorderMap({ flip }: { flip: boolean }) {
  // Arc endpoints (must match the pin positions below).
  const A = { x: 120, y: 250 };
  const B = { x: 440, y: 170 };
  const arcD = `M ${A.x} ${A.y} Q 280 40 ${B.x} ${B.y}`;

  return (
    <div className="ph-globe relative aspect-[4/3] w-full">
      <svg viewBox="0 0 560 420" className="absolute inset-0 h-full w-full" aria-hidden>
        <defs>
          <radialGradient id="ph-glow" cx="50%" cy="42%" r="60%">
            <stop offset="0%" stopColor="#CAFFB8" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#CAFFB8" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="ph-arcg" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--color-accent-deep)" />
            <stop offset="100%" stopColor="#3d7a29" />
          </linearGradient>
        </defs>

        {/* soft glow + globe rings */}
        <circle cx="280" cy="200" r="180" fill="url(#ph-glow)" />
        {[200, 150, 100].map((r) => (
          <circle key={r} cx="280" cy="210" r={r} fill="none" stroke="var(--color-accent-deep)" strokeOpacity="0.1" />
        ))}
        <line x1="80" y1="210" x2="480" y2="210" stroke="var(--color-accent-deep)" strokeOpacity="0.1" />

        {/* the transfer arc */}
        <path d={arcD} fill="none" stroke="url(#ph-arcg)" strokeWidth="3" strokeLinecap="round" className="ph-arc" />

        {/* the racing coin */}
        <g className="ph-coin">
          <circle r="10" fill="#CAFFB8" stroke="#3d7a29" strokeWidth="1.5" />
          <circle r="3.2" fill="#3d7a29" />
        </g>

        {/* pins */}
        <Pin x={A.x} y={A.y} label="Lagos" hue="#3d7a29" />
        <Pin x={B.x} y={B.y} label="New York" hue="#4b8a37" />
      </svg>

      {/* center callout: old way → Talise */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
        <div
          className="rounded-2xl border border-[color-mix(in_srgb,var(--color-accent-deep)_18%,var(--color-line))] bg-[color-mix(in_srgb,#ffffff_72%,transparent)] px-5 py-3 backdrop-blur-sm transition-all duration-500"
          style={{ boxShadow: "0 16px 40px -20px rgba(21,48,12,0.3)" }}
        >
          {flip ? (
            <>
              <div
                className="text-[26px] leading-none italic text-[var(--color-accent-deep)]"
                style={{ fontFamily: "var(--font-serif)" }}
              >
                in seconds
              </div>
              <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-muted)]">
                stablecoin transfers on Sui cost nothing
              </div>
            </>
          ) : (
            <>
              <div className="text-[22px] font-medium leading-none text-[var(--color-fg-dim)] line-through decoration-[#c0492f]/50">
                $500 + fees
              </div>
              <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-dim)]">
                the old way · 1–5 days
              </div>
            </>
          )}
        </div>
      </div>

      {/* scrapbook coin cutout, gently floating */}
      <div className="ph-float pointer-events-none absolute -right-2 -top-3 hidden h-20 w-20 sm:block">
        <CoinCutout />
      </div>
    </div>
  );
}

function Pin({ x, y, label, hue }: { x: number; y: number; label: string; hue: string }) {
  return (
    <g className="ph-pin" style={{ filter: "drop-shadow(0 8px 10px rgba(21,48,12,0.18))" }}>
      {/* teardrop tail */}
      <path d={`M ${x} ${y + 30} L ${x - 12} ${y + 6} A 22 22 0 1 1 ${x + 12} ${y + 6} Z`} fill={hue} />
      {/* avatar disc */}
      <circle cx={x} cy={y - 6} r="20" fill="#fff" />
      <circle cx={x} cy={y - 6} r="17" fill={`color-mix(in srgb, ${hue} 18%, #fff)`} />
      {/* simple person glyph (placeholder for a Higgsfield headshot) */}
      <circle cx={x} cy={y - 11} r="5.5" fill={hue} />
      <path d={`M ${x - 9} ${y + 4} A 9 9 0 0 1 ${x + 9} ${y + 4} Z`} fill={hue} />
      <text x={x} y={y + 50} textAnchor="middle" className="font-mono" fontSize="11" fill="var(--color-fg-muted)" style={{ letterSpacing: "0.5px" }}>
        {label}
      </text>
    </g>
  );
}

function CoinCutout() {
  return (
    <svg viewBox="0 0 80 80" className="h-full w-full" style={{ filter: "drop-shadow(0 10px 14px rgba(21,48,12,0.22))" }}>
      <circle cx="40" cy="40" r="34" fill="#CAFFB8" stroke="#3d7a29" strokeWidth="2.5" />
      <circle cx="40" cy="40" r="26" fill="none" stroke="#3d7a29" strokeOpacity="0.5" strokeWidth="1.5" />
      <text x="40" y="50" textAnchor="middle" fontSize="30" fontWeight="600" fill="#15300c">$</text>
    </svg>
  );
}

function AppleGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M16.365 1.43c0 1.14-.493 2.27-1.177 3.08-.744.9-1.99 1.57-2.987 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.572-2.27 1.206-2.98.804-.94 2.142-1.64 3.248-1.68.03.13.05.28.05.43zm4.565 15.71c-.03.07-.463 1.58-1.518 3.12-.945 1.34-1.94 2.71-3.43 2.71-1.517 0-1.9-.88-3.63-.88-1.698 0-2.302.91-3.67.91-1.377 0-2.332-1.26-3.428-2.8-1.287-1.82-2.323-4.63-2.323-7.28 0-4.28 2.797-6.55 5.552-6.55 1.448 0 2.675.95 3.6.95.865 0 2.222-1.01 3.902-1.01.613 0 2.886.06 4.374 2.19-.13.09-2.383 1.37-2.383 4.19 0 3.26 2.854 4.42 2.955 4.45z" />
    </svg>
  );
}
