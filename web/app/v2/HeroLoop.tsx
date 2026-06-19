"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";

/**
 * Hero centerpiece: a premium, repeating 4-step money-movement loop.
 *   1. Open      - the wallet card lifts, a 3D coin pops out
 *   2. Type      - "sele@talise" types into the send field
 *   3. Send      - a 3D paper plane flies the money along a dotted arc
 *   4. Arrives   - the recipient card pops a "Received +$1,240.00" with a check
 * Then it loops. A faint dotted guide arc + a mint trail that draws on during
 * send give the dotted-line illustration feel. Respects prefers-reduced-motion
 * by rendering a single resolved frame.
 */
const STEPS = ["Open", "Type a name", "Send", "Arrives in seconds"];

export default function HeroLoop() {
  const root = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ctx = gsap.context((self) => {
      const q = self.selector!;

      if (reduce) {
        // resolved frame: money delivered, recipient confirmed
        setActive(3);
        gsap.set(q(".hl-coin"), { opacity: 0 });
        gsap.set(q(".hl-typed-clip"), { clipPath: "inset(0 0% 0 0)" });
        gsap.set(q(".hl-caret"), { opacity: 0 });
        gsap.set(q(".hl-plane"), { x: 150, y: 150, rotation: 26, opacity: 1 });
        gsap.set(q(".hl-trail"), { strokeDashoffset: 0 });
        gsap.set(q(".hl-recv"), { opacity: 1, y: 0, scale: 1 });
        gsap.set(q(".hl-check"), { scale: 1 });
        return;
      }

      const tl = gsap.timeline({ repeat: -1, defaults: { ease: "power3.out" } });

      // --- reset (re-runs at the start of every loop) ---
      tl.set(q(".hl-coin"), { x: 0, y: 0, scale: 0, opacity: 0, rotation: -25 })
        .set(q(".hl-typed-clip"), { clipPath: "inset(0 100% 0 0)" })
        .set(q(".hl-caret"), { opacity: 0 })
        .set(q(".hl-plane"), { x: 0, y: 0, rotation: 16, opacity: 0 })
        .set(q(".hl-trail"), { strokeDashoffset: 100 })
        .set(q(".hl-recv"), { opacity: 0, y: 20, scale: 0.92 })
        .set(q(".hl-check"), { scale: 0 })
        .set(q(".hl-card"), { y: 0 });

      // --- 1 - Open ---
      tl.call(() => setActive(0))
        .to(q(".hl-card"), { y: -6, duration: 0.5, ease: "power2.out" })
        .to(q(".hl-coin"), { opacity: 1, scale: 1, y: -42, rotation: 10, duration: 0.7, ease: "back.out(1.8)" }, "<")
        .to(q(".hl-coin"), { y: -34, duration: 0.4, ease: "sine.inOut" });

      // --- 2 - Type a name ---
      tl.call(() => setActive(1))
        .to(q(".hl-caret"), { opacity: 1, duration: 0.1 })
        .to(q(".hl-typed-clip"), { clipPath: "inset(0 0% 0 0)", duration: 0.9, ease: "steps(11)" })
        .to(q(".hl-caret"), { opacity: 0, duration: 0.15, delay: 0.15 });

      // --- 3 - Send (plane flies the money along the arc, trail draws on) ---
      tl.call(() => setActive(2))
        .to(q(".hl-trail"), { strokeDashoffset: 0, duration: 1.1, ease: "power1.inOut" })
        .to(q(".hl-plane"), { opacity: 1, duration: 0.15 }, "<")
        .to(
          q(".hl-plane"),
          { keyframes: [{ x: 55, y: -34, rotation: 6 }, { x: 120, y: 30, rotation: 18 }, { x: 158, y: 150, rotation: 30 }], duration: 1.1, ease: "power1.inOut" },
          "<"
        )
        .to(q(".hl-coin"), { keyframes: [{ x: 55, y: -76 }, { x: 120, y: -4 }, { x: 158, y: 116, scale: 0.55, opacity: 0 }], duration: 1.1, ease: "power1.inOut" }, "<")
        .to(q(".hl-plane"), { opacity: 0, scale: 0.8, duration: 0.25 });

      // --- 4 - Arrives ---
      tl.call(() => setActive(3))
        .to(q(".hl-recv"), { opacity: 1, y: 0, scale: 1, duration: 0.5, ease: "back.out(1.5)" })
        .to(q(".hl-check"), { scale: 1, duration: 0.5, ease: "back.out(2.4)" }, "-=0.25")
        .to({}, { duration: 1.1 }); // hold before the loop resets
    }, root);

    return () => ctx.revert();
  }, []);

  return (
    <div ref={root} className="v2-card relative mx-auto w-full max-w-[440px]">
      <div className="relative h-[470px] w-full">
        {/* dotted guide arc + mint trail */}
        <svg viewBox="0 0 440 470" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
          <path d="M 150 188 C 286 150, 372 232, 300 322" fill="none" stroke="#15300c" strokeOpacity="0.22" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="2 9" />
          <path className="hl-trail" d="M 150 188 C 286 150, 372 232, 300 322" fill="none" stroke="#3d7a29" strokeWidth="3" strokeLinecap="round" pathLength={100} strokeDasharray={100} strokeDashoffset={100} />
        </svg>

        {/* sender wallet card */}
        <div
          className="hl-card absolute left-0 top-3 w-[300px] overflow-hidden rounded-[28px] bg-gradient-to-br from-[#3d7a29] to-[#1c4513] p-7 text-[#f7fcf2]"
          style={{ boxShadow: "12px 12px 0 #15300c" }}
        >
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#CAFFB8]">Your balance</div>
          <div className="mt-1.5 text-[38px] font-[800] leading-none" style={{ fontFamily: "var(--font-display-v2)" }}>
            $1,240.00
          </div>
          <div className="mt-1 font-mono text-[11px] text-[#cfe9c2]">1,240.00 USDsui</div>

          <div className="mt-5 rounded-2xl bg-[#0e2a08]/60 p-4">
            <div className="font-mono text-[10px] tracking-[0.12em] text-[#9fc78c]">SEND TO</div>
            <div className="mt-1 flex h-[24px] items-center">
              <span className="hl-typed-clip inline-block overflow-hidden whitespace-nowrap text-[19px] font-semibold leading-none" style={{ clipPath: "inset(0 100% 0 0)" }}>
                sele@talise
              </span>
              <span className="hl-caret ml-[2px] inline-block h-[19px] w-[2px] bg-[#CAFFB8]" />
            </div>
          </div>
        </div>

        {/* recipient "received" card */}
        <div
          className="hl-recv absolute bottom-4 right-0 w-[236px] rounded-[24px] bg-[#f7fcf2] p-5"
          style={{ boxShadow: "10px 10px 0 #15300c", border: "1.5px solid #15300c" }}
        >
          <div className="flex items-center gap-3">
            <span className="hl-check flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#3d7a29]">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f7fcf2" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12.5 l4.5 4.5 L19 6.5" />
              </svg>
            </span>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#3d7a29]">Received</div>
              <div className="text-[20px] font-[800] leading-tight text-[#15300c]" style={{ fontFamily: "var(--font-display-v2)" }}>
                +$1,240.00
              </div>
            </div>
          </div>
          <div className="mt-3 font-mono text-[11px] text-[#3a5230]">arrived in seconds · ada@talise</div>
        </div>

        {/* flying money: coin + 3D plane */}
        <Image src="/v2/coin.png" alt="" width={72} height={72} className="hl-coin absolute left-[118px] top-[150px] h-[64px] w-[64px] object-contain drop-shadow-[0_8px_10px_rgba(21,48,12,0.25)]" />
        <Image src="/v2/plane.png" alt="" width={96} height={96} className="hl-plane absolute left-[150px] top-[150px] h-[84px] w-[84px] object-contain drop-shadow-[0_10px_12px_rgba(21,48,12,0.25)]" />
      </div>

      {/* step indicator */}
      <div className="mt-3 flex items-center justify-center gap-2">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <span
              className="inline-block h-2 w-2 rounded-full transition-all duration-300"
              style={{ background: active === i ? "#15300c" : "rgba(21,48,12,0.2)", transform: active === i ? "scale(1.35)" : "scale(1)" }}
            />
            <span
              className="font-mono text-[11px] transition-colors duration-300"
              style={{ color: active === i ? "#15300c" : "rgba(21,48,12,0.4)" }}
            >
              {s}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
