"use client";

/**
 * CoinBurst — the web port of the iOS send-success "coin drop" (Figma 141:18 /
 * SuccessfulTxView's `SuccessCoins` scrapbook entry).
 *
 * A small cluster of warm-gold coins drops in and scatters out, then settles
 * with a low-damping spring — the same "paper cutout pressed onto the page"
 * wobble as the iOS `scrapbookEntry` modifier. A soft mint bloom blooms behind
 * them and a few sparkles twinkle once. Tuned for the light-mint app theme:
 * coins are gold (#E8B23A) with a forest rim + mint highlight, sitting on the
 * white lifted cards — never gaudy, never cartoonish.
 *
 * Plays exactly once on mount, ~1.5s, then calls `onDone`. Self-contained SVG;
 * no image assets. Respects prefers-reduced-motion (renders a single static,
 * already-settled coin and fires onDone immediately).
 */

import { useEffect } from "react";
import { motion, useReducedMotion, type Transition } from "framer-motion";

// ── Palette (warm gold coin + the two Talise greens) ───────────────────────
const GOLD = "#E8B23A";
const GOLD_LIGHT = "#F6D17A";
const GOLD_DEEP = "#C8902A";
const FOREST = "#3d7a29"; // accent-deep — coin rim
const MINT = "#caffb8"; // accent-light — highlight + bloom (FILL only)

/**
 * Where each coin settles, as an offset (in px) from the cluster center, plus
 * its final scale and resting tilt. Hand-tuned so the pile reads as scattered
 * gold rather than a neat stack. The first/center coin is the largest "hero".
 */
const COINS: Array<{
  x: number;
  y: number;
  scale: number;
  rot: number;
  delay: number;
  /** Each coin drops in from a little above + an outward fan. */
  fromX: number;
  fromY: number;
}> = [
  { x: 0, y: 4, scale: 1.0, rot: -6, delay: 0.0, fromX: 0, fromY: -54 },
  { x: -34, y: 14, scale: 0.82, rot: 10, delay: 0.06, fromX: -20, fromY: -48 },
  { x: 32, y: 12, scale: 0.86, rot: -12, delay: 0.05, fromX: 22, fromY: -50 },
  { x: -18, y: -22, scale: 0.7, rot: 14, delay: 0.12, fromX: -10, fromY: -46 },
  { x: 22, y: -26, scale: 0.66, rot: -8, delay: 0.14, fromX: 14, fromY: -44 },
];

/** Sparkle positions around the cluster (px from center). */
const SPARKLES: Array<{ x: number; y: number; size: number; delay: number }> = [
  { x: -48, y: -30, size: 7, delay: 0.34 },
  { x: 50, y: -18, size: 9, delay: 0.42 },
  { x: 38, y: 30, size: 6, delay: 0.5 },
  { x: -44, y: 22, size: 5, delay: 0.46 },
];

// Low-damping spring → a visible 1–2 wobble settle, like the iOS scrapbook drop.
const settleSpring: Transition = { type: "spring", stiffness: 420, damping: 16, mass: 0.9 };

export function CoinBurst({
  onDone,
  size = 140,
}: {
  onDone?: () => void;
  /** Overall footprint of the cluster (px). */
  size?: number;
}) {
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!onDone) return;
    // Mirror the animation envelope so the parent can sequence follow-on UI.
    const t = window.setTimeout(onDone, reduce ? 0 : 1500);
    return () => window.clearTimeout(t);
  }, [onDone, reduce]);

  // Reduced motion: a single, already-settled coin. No drop, no scatter.
  if (reduce) {
    return (
      <div
        aria-hidden
        className="relative grid place-items-center"
        style={{ width: size, height: size }}
      >
        <Coin px={size * 0.46} />
      </div>
    );
  }

  const coinPx = size * 0.46;

  return (
    <div
      aria-hidden
      className="relative grid place-items-center"
      style={{ width: size, height: size }}
    >
      {/* Soft mint bloom behind the coins — sets the stage, fades as they land. */}
      <motion.div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background: `radial-gradient(circle at 50% 52%, ${MINT}cc 0%, ${MINT}33 42%, transparent 70%)`,
          filter: "blur(8px)",
        }}
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: [0, 0.9, 0.5], scale: [0.6, 1.08, 1] }}
        transition={{ duration: 1.1, times: [0, 0.4, 1], ease: [0.22, 1, 0.36, 1] }}
      />

      {/* Coins — back of the pile first so the hero coin lands on top. */}
      {COINS.map((c, i) => (
        <motion.div
          key={i}
          className="absolute"
          style={{ width: coinPx, height: coinPx, willChange: "transform, opacity" }}
          initial={{ x: c.fromX, y: c.fromY, scale: c.scale * 1.18, rotate: c.rot + 18, opacity: 0 }}
          animate={{ x: c.x, y: c.y, scale: c.scale, rotate: c.rot, opacity: 1 }}
          transition={{
            ...settleSpring,
            delay: c.delay,
            opacity: { duration: 0.2, delay: c.delay },
          }}
        >
          <Coin px={coinPx} />
        </motion.div>
      ))}

      {/* Sparkles — a brief one-shot twinkle once the pile has mostly settled. */}
      {SPARKLES.map((s, i) => (
        <motion.div
          key={`s-${i}`}
          className="pointer-events-none absolute"
          style={{ x: s.x, y: s.y }}
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: [0, 1, 0], scale: [0, 1, 0.4], rotate: [0, 90] }}
          transition={{ duration: 0.66, delay: s.delay, ease: "easeOut" }}
        >
          <Sparkle size={s.size} />
        </motion.div>
      ))}
    </div>
  );
}

/**
 * A single gold coin face: radial gradient body, a forest rim, a mint
 * specular highlight, and an embossed "$" glyph. Drawn at a unit viewBox so it
 * scales cleanly with the `px` frame.
 */
function Coin({ px }: { px: number }) {
  const id = `coin-${Math.round(px)}`;
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 48 48"
      fill="none"
      style={{
        display: "block",
        filter: "drop-shadow(0 6px 10px rgba(35,78,20,0.22))",
      }}
    >
      <defs>
        <radialGradient id={`${id}-face`} cx="38%" cy="32%" r="72%">
          <stop offset="0%" stopColor={GOLD_LIGHT} />
          <stop offset="55%" stopColor={GOLD} />
          <stop offset="100%" stopColor={GOLD_DEEP} />
        </radialGradient>
      </defs>
      {/* Forest rim */}
      <circle cx="24" cy="24" r="23" fill={FOREST} opacity="0.9" />
      {/* Coin face */}
      <circle cx="24" cy="24" r="21" fill={`url(#${id}-face)`} />
      {/* Inner bevel ring */}
      <circle cx="24" cy="24" r="17.5" fill="none" stroke={GOLD_DEEP} strokeWidth="1.1" opacity="0.55" />
      {/* Mint specular highlight, upper-left */}
      <ellipse cx="17" cy="15" rx="7.5" ry="4.6" fill={MINT} opacity="0.5" transform="rotate(-28 17 15)" />
      {/* Embossed currency glyph */}
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

/** A tiny four-point sparkle (mint), drawn as two crossed diamonds. */
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

export default CoinBurst;
