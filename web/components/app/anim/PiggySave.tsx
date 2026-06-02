"use client";

/**
 * PiggySave — the web port of the iOS save-success "piggy bank" (Figma 141:2 /
 * SavingsSuccessView's `SavingsPiggy` scrapbook entry).
 *
 * A soft mint/forest piggy bank drops in with the iOS scrapbook wobble, a warm
 * gold coin falls into its slot, and the piggy gives a little squash-and-settle
 * "gulp" as the coin lands — then a couple of mint sparkles twinkle. Tuned for
 * the light-mint app theme; the piggy body is the soft mint fill with forest
 * outlines so it reads cleanly on the white lifted cards.
 *
 * Plays exactly once on mount, ~1.6s, then calls `onDone`. Self-contained SVG;
 * no image assets. Respects prefers-reduced-motion (renders a static, settled
 * piggy with the coin already deposited and fires onDone immediately).
 */

import { useEffect } from "react";
import { motion, useReducedMotion, type Transition } from "framer-motion";

// ── Palette ────────────────────────────────────────────────────────────────
const GOLD = "#E8B23A";
const GOLD_LIGHT = "#F6D17A";
const GOLD_DEEP = "#C8902A";
const FOREST = "#3d7a29"; // accent-deep — outlines + details
const FOREST_SOFT = "#5ba23f";
const MINT = "#caffb8"; // accent-light — body fill + sparkles
const MINT_DEEP = "#a6ec8c"; // belly shade

const settleSpring: Transition = { type: "spring", stiffness: 380, damping: 15, mass: 0.9 };

export function PiggySave({
  onDone,
  size = 150,
}: {
  onDone?: () => void;
  /** Overall footprint (px). */
  size?: number;
}) {
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!onDone) return;
    const t = window.setTimeout(onDone, reduce ? 0 : 1600);
    return () => window.clearTimeout(t);
  }, [onDone, reduce]);

  if (reduce) {
    return (
      <div aria-hidden className="relative grid place-items-center" style={{ width: size, height: size }}>
        <Piggy size={size} />
      </div>
    );
  }

  return (
    <div aria-hidden className="relative grid place-items-center" style={{ width: size, height: size }}>
      {/* Mint bloom behind the piggy. */}
      <motion.div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background: `radial-gradient(circle at 50% 56%, ${MINT}cc 0%, ${MINT}33 44%, transparent 72%)`,
          filter: "blur(8px)",
        }}
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: [0, 0.9, 0.55], scale: [0.6, 1.06, 1] }}
        transition={{ duration: 1.1, times: [0, 0.4, 1], ease: [0.22, 1, 0.36, 1] }}
      />

      {/* The coin drops into the slot first, behind the piggy front so it
          reads as "going in". Times its arrival (~0.45s) with the piggy gulp. */}
      <motion.div
        className="absolute"
        style={{ width: size * 0.2, height: size * 0.2, top: size * 0.04 }}
        initial={{ y: -size * 0.42, opacity: 0, rotate: -20 }}
        animate={{
          y: [-size * 0.42, -size * 0.04, size * 0.16],
          opacity: [0, 1, 1, 0],
          rotate: [-20, 8, 0],
        }}
        transition={{ duration: 0.62, delay: 0.28, ease: [0.5, 0, 0.7, 1], times: [0, 0.55, 1] }}
      >
        <Coin px={size * 0.2} />
      </motion.div>

      {/* Piggy — scrapbook drop-in, then a coin-landing squash gulp. */}
      <motion.div
        style={{ width: size, height: size, transformOrigin: "50% 90%", willChange: "transform, opacity" }}
        initial={{ y: -28, scale: 1.16, rotate: -7, opacity: 0 }}
        animate={{
          y: [-28, 0, 0],
          scale: [1.16, 1, 1],
          rotate: [-7, 0, 0],
          opacity: [0, 1, 1],
        }}
        transition={settleSpring}
      >
        <motion.div
          style={{ width: "100%", height: "100%", transformOrigin: "50% 90%" }}
          // Squash-and-stretch "gulp" right as the coin lands (~0.5s in).
          initial={{ scaleX: 1, scaleY: 1 }}
          animate={{ scaleX: [1, 1, 1.07, 0.98, 1], scaleY: [1, 1, 0.93, 1.03, 1] }}
          transition={{ duration: 0.5, delay: 0.42, ease: "easeOut", times: [0, 0.1, 0.4, 0.7, 1] }}
        >
          <Piggy size={size} />
        </motion.div>
      </motion.div>

      {/* Sparkles — a brief twinkle after the gulp. */}
      {[
        { x: -size * 0.36, y: -size * 0.12, s: 8, d: 0.7 },
        { x: size * 0.38, y: -size * 0.02, s: 10, d: 0.78 },
        { x: size * 0.28, y: size * 0.24, s: 6, d: 0.86 },
      ].map((sp, i) => (
        <motion.div
          key={i}
          className="pointer-events-none absolute"
          style={{ x: sp.x, y: sp.y }}
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: [0, 1, 0], scale: [0, 1, 0.4], rotate: [0, 90] }}
          transition={{ duration: 0.66, delay: sp.d, ease: "easeOut" }}
        >
          <Sparkle size={sp.s} />
        </motion.div>
      ))}
    </div>
  );
}

/**
 * Piggy bank face-on: soft mint body with a forest outline, a coin slot on
 * top, snout, ear, eye, trotters and a curly tail. Unit viewBox scales with
 * the `size` frame.
 */
function Piggy({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      style={{ display: "block", filter: "drop-shadow(0 8px 14px rgba(35,78,20,0.2))" }}
    >
      <defs>
        <radialGradient id="piggy-body" cx="42%" cy="34%" r="78%">
          <stop offset="0%" stopColor={MINT} />
          <stop offset="70%" stopColor={MINT} />
          <stop offset="100%" stopColor={MINT_DEEP} />
        </radialGradient>
      </defs>

      {/* Back leg + front leg trotters */}
      <rect x="24" y="68" width="11" height="14" rx="4.5" fill={MINT_DEEP} stroke={FOREST} strokeWidth="2" />
      <rect x="63" y="68" width="11" height="14" rx="4.5" fill={MINT_DEEP} stroke={FOREST} strokeWidth="2" />

      {/* Body */}
      <ellipse cx="50" cy="52" rx="34" ry="27" fill="url(#piggy-body)" stroke={FOREST} strokeWidth="2.4" />

      {/* Ear */}
      <path d="M30 30 q-6 -10 6 -12 q3 7 -1 14 Z" fill={MINT_DEEP} stroke={FOREST} strokeWidth="2" strokeLinejoin="round" />

      {/* Coin slot on the back */}
      <rect x="42" y="26.5" width="20" height="4" rx="2" fill={FOREST} opacity="0.85" />

      {/* Snout */}
      <ellipse cx="80" cy="54" rx="11" ry="9" fill={MINT_DEEP} stroke={FOREST} strokeWidth="2.2" />
      <circle cx="77" cy="54" r="1.7" fill={FOREST} />
      <circle cx="83" cy="54" r="1.7" fill={FOREST} />

      {/* Eye */}
      <circle cx="64" cy="44" r="2.6" fill={FOREST} />
      <circle cx="65" cy="43" r="0.9" fill="#ffffff" opacity="0.85" />

      {/* Cheek blush */}
      <ellipse cx="68" cy="52" rx="4" ry="2.6" fill={FOREST_SOFT} opacity="0.3" />

      {/* Curly tail */}
      <path
        d="M16 50 q-7 -1 -6 -7 q1 -5 6 -3"
        fill="none"
        stroke={FOREST}
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Gold coin (shared idiom with CoinBurst — small face for the slot drop). */
function Coin({ px }: { px: number }) {
  const id = `pcoin-${Math.round(px)}`;
  return (
    <svg width={px} height={px} viewBox="0 0 48 48" fill="none" style={{ display: "block" }}>
      <defs>
        <radialGradient id={`${id}-face`} cx="38%" cy="32%" r="72%">
          <stop offset="0%" stopColor={GOLD_LIGHT} />
          <stop offset="55%" stopColor={GOLD} />
          <stop offset="100%" stopColor={GOLD_DEEP} />
        </radialGradient>
      </defs>
      <circle cx="24" cy="24" r="23" fill={FOREST} opacity="0.9" />
      <circle cx="24" cy="24" r="21" fill={`url(#${id}-face)`} />
      <ellipse cx="17" cy="15" rx="7.5" ry="4.6" fill={MINT} opacity="0.5" transform="rotate(-28 17 15)" />
      <text
        x="24"
        y="32.5"
        textAnchor="middle"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fontSize="20"
        fontWeight="700"
        fill={GOLD_DEEP}
        opacity="0.75"
      >
        $
      </text>
    </svg>
  );
}

function Sparkle({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M12 0 C13 7 17 11 24 12 C17 13 13 17 12 24 C11 17 7 13 0 12 C7 11 11 7 12 0 Z"
        fill={MINT}
      />
    </svg>
  );
}

export default PiggySave;
