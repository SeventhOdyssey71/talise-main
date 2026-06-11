/**
 * HeraldicAvatar — a deterministic, medieval-heraldry-style crest for a
 * counterparty. Hashes the seed (address or handle) with FNV-1a and maps it
 * onto three independent axes:
 *
 *   division (9) — how the shield field is split: plain, per-pale, per-fess,
 *                  per-bend, chevron, quarterly, pale stripe, fess band,
 *                  bordure
 *   charge  (10) — the central motif: rampant lion, fleur-de-lis, tower,
 *                  crown, crossed swords, mullet (star), crescent, bird,
 *                  oak tree, key, cross
 *   palette (10) — a curated tincture triple (two field tones + one charge
 *                  tone) tuned to the light-mint theme; pairs are explicit so
 *                  every combination reads intentional, never random-muddy
 *
 * 9 × 10 × 10 = 900 distinct crests. Same seed → same crest everywhere
 * (seeds are normalised to lowercase first, so 0xAB… and 0xab… match).
 *
 * The crest renders as a small enamel-badge shield centred inside the
 * existing circular chip footprint, with a subtle 1px darker outline. Bold,
 * few-path silhouettes only — designed to stay crisp at 36–40px. Decorative:
 * the SVG is aria-hidden; the row text carries the counterparty name.
 */

import { useId } from "react";

/** FNV-1a 32-bit — tiny, deterministic, no deps. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Tincture triples — { bg: chip disc, a: field, b: division overlay,
 * c: charge + outline tone, line: shield outline }. Light fields carry a deep
 * charge; the three dark-field palettes invert (parchment/gold charge).
 */
type Palette = { bg: string; a: string; b: string; c: string; line: string };

const PALETTES: Palette[] = [
  // Deep pine on mint
  { bg: "#eef6ea", a: "#e7f4e1", b: "#c6deba", c: "#1f4d1a", line: "#1f4d1a" },
  // Burgundy on parchment
  { bg: "#f5f2e9", a: "#f3f0e4", b: "#e6d8c2", c: "#7d2f3c", line: "#7d2f3c" },
  // Slate blue on mist
  { bg: "#eff3f1", a: "#edf2f5", b: "#cfdde8", c: "#3c5a7d", line: "#3c5a7d" },
  // Warm umber on cream
  { bg: "#f6f2e8", a: "#f6f1e2", b: "#e9d9bd", c: "#8a5a2f", line: "#8a5a2f" },
  // Moss on soft sage
  { bg: "#f1f5ee", a: "#f1f5ee", b: "#d8e3c7", c: "#56743c", line: "#56743c" },
  // Ink on pale mint
  { bg: "#ecf3e8", a: "#e9f3e3", b: "#d2e6c8", c: "#14250e", line: "#14250e" },
  // Forest on gold-cream
  { bg: "#f6f1df", a: "#f5edd4", b: "#e8d595", c: "#2f7d31", line: "#2f7d31" },
  // Gold on deep pine (inverted)
  { bg: "#eef4ea", a: "#2f5d2a", b: "#234a1f", c: "#d9b545", line: "#1a3a16" },
  // Parchment on burgundy (inverted)
  { bg: "#f5efe9", a: "#7d2f3c", b: "#692731", c: "#f3ead8", line: "#4f1d26" },
  // Parchment on slate (inverted)
  { bg: "#eef2f4", a: "#3c5a7d", b: "#324c6a", c: "#eef2e7", line: "#273b53" },
];

/**
 * Heater-shield outline in a 40×40 viewBox: flat chief at y≈10, sides curving
 * to a point at (20, 30.5) — leaves badge-like breathing room in the circle.
 */
const SHIELD =
  "M11.5 10 H28.5 V18.5 C28.5 24.8 25 28.6 20 30.5 C15 28.6 11.5 24.8 11.5 18.5 Z";

/**
 * Field divisions — overlay shapes in tincture `b`, clipped to the shield.
 * Index 0 (plain) renders nothing; 8 (bordure) strokes the shield edge.
 */
function Division({ index, b }: { index: number; b: string }) {
  switch (index) {
    case 1: // per-pale — vertical split, sinister half tinted
      return <rect x={20} y={9} width={10} height={23} fill={b} />;
    case 2: // per-fess — horizontal split, base tinted
      return <rect x={11} y={19} width={19} height={13} fill={b} />;
    case 3: // per-bend — diagonal from dexter chief to sinister base
      return <path d="M11.5 9.8 H29 V31 Z" fill={b} />;
    case 4: // chevron — inverted-V band across the centre
      return (
        <path d="M11.5 22.5 L20 16 L28.5 22.5 V26.8 L20 20.3 L11.5 26.8 Z" fill={b} />
      );
    case 5: // quarterly — dexter-chief + sinister-base quarters tinted
      return (
        <g fill={b}>
          <rect x={11} y={9} width={9} height={10} />
          <rect x={20} y={19} width={9} height={13} />
        </g>
      );
    case 6: // pale — central vertical stripe
      return <rect x={17} y={9} width={6} height={23} fill={b} />;
    case 7: // fess — central horizontal band
      return <rect x={11} y={16.2} width={19} height={5.6} fill={b} />;
    case 8: // bordure — border band around the shield edge
      return <path d={SHIELD} fill="none" stroke={b} strokeWidth={3.6} />;
    default: // plain field
      return null;
  }
}

/**
 * Charges — bold few-path silhouettes centred on the shield (~20, 19).
 * Strokes/fills all take the single charge tincture `c`; `field` is the base
 * field tone, used for knockouts (the tower doorway).
 */
function Charge({ index, c, field }: { index: number; c: string; field: string }) {
  switch (index) {
    case 0: // rampant lion — rearing beast built from capsule strokes
      return (
        <g stroke={c} fill={c} strokeLinecap="round">
          {/* head + muzzle */}
          <circle cx={16.6} cy={14.6} r={2.1} stroke="none" />
          <path d="M14.9 15.4 L13.6 16.2" strokeWidth={1.5} fill="none" />
          {/* arched body, shoulder → haunch */}
          <path d="M17.6 16.4 L22.6 22.6" strokeWidth={4.4} fill="none" />
          {/* raised forelegs */}
          <path d="M18.4 17.6 L14.6 16.6" strokeWidth={1.7} fill="none" />
          <path d="M19.6 19.2 L15.6 19.0" strokeWidth={1.7} fill="none" />
          {/* hind legs */}
          <path d="M21.6 22.4 L20.2 26.2" strokeWidth={1.8} fill="none" />
          <path d="M23.2 23.2 L23.6 26.2" strokeWidth={1.8} fill="none" />
          {/* tail, swept up over the back */}
          <path d="M23.8 21 C26.2 19.4 26.4 16.6 24.6 14.8" strokeWidth={1.4} fill="none" />
        </g>
      );
    case 1: // fleur-de-lis
      return (
        <g fill={c}>
          {/* central petal */}
          <path d="M20 11.6 C18.7 13.6 18.3 15.6 18.7 17.9 L19 19.6 H21 L21.3 17.9 C21.7 15.6 21.3 13.6 20 11.6 Z" />
          {/* side petals */}
          <path d="M18.2 15.6 C15.6 14.6 13.8 15.8 14 17.8 C14.2 19.4 15.9 20.1 17.8 19.7 L18.6 19.5 Z" />
          <path d="M21.8 15.6 C24.4 14.6 26.2 15.8 26 17.8 C25.8 19.4 24.1 20.1 22.2 19.7 L21.4 19.5 Z" />
          {/* band + lower tail */}
          <rect x={16.4} y={20} width={7.2} height={1.8} rx={0.9} />
          <path d="M20 22.4 L22.2 26 H17.8 Z" />
        </g>
      );
    case 2: // castle tower
      return (
        <g fill={c}>
          <path d="M14.6 25.6 V14.2 H17.2 V16.4 H18.8 V14.2 H21.2 V16.4 H22.8 V14.2 H25.4 V25.6 Z" />
          {/* doorway, knocked back to the field tone */}
          <path d="M18.7 25.6 V22.4 C18.7 21.4 21.3 21.4 21.3 22.4 V25.6 Z" fill={field} />
        </g>
      );
    case 3: // crown
      return (
        <g fill={c}>
          <path d="M13.8 22.6 L13 15.6 L17 18.8 L20 14 L23 18.8 L27 15.6 L26.2 22.6 Z" />
          <rect x={13.8} y={23.6} width={12.4} height={2.2} rx={1.1} />
        </g>
      );
    case 4: // crossed swords
      return (
        <g stroke={c} strokeLinecap="round" fill={c}>
          <path d="M15 13.4 L24.8 23.6" strokeWidth={2} fill="none" />
          <path d="M25 13.4 L15.2 23.6" strokeWidth={2} fill="none" />
          {/* crossguards */}
          <path d="M22.8 24 L26 22.6" strokeWidth={1.5} fill="none" />
          <path d="M17.2 24 L14 22.6" strokeWidth={1.5} fill="none" />
          {/* pommels */}
          <circle cx={25.6} cy={25.4} r={1.2} stroke="none" />
          <circle cx={14.4} cy={25.4} r={1.2} stroke="none" />
        </g>
      );
    case 5: // mullet — five-point star
      return (
        <polygon
          fill={c}
          points="20,12.5 21.5,16.9 26.2,17 22.5,19.8 23.8,24.3 20,21.6 16.2,24.3 17.5,19.8 13.8,17 18.5,16.9"
        />
      );
    case 6: // crescent
      return (
        <path
          fill={c}
          d="M21.6 12.6 A6.6 6.6 0 1 0 21.6 25.4 A8.4 8.4 0 0 1 21.6 12.6 Z"
        />
      );
    case 7: // bird — perched dove-like silhouette
      return (
        <g fill={c}>
          <ellipse cx={19.4} cy={20} rx={4.6} ry={3.4} />
          <circle cx={23.9} cy={16.2} r={2} />
          <path d="M25.6 15.5 L27.5 16.3 L25.6 17.2 Z" />
          {/* raised wing */}
          <path d="M16.4 18.6 C14.2 14.8 18 12.6 21.4 14.8 C20 16.6 18.4 17.9 16.4 18.6 Z" />
          {/* tail */}
          <path d="M15.6 21 L11.8 22.8 L15.9 23.6 Z" />
        </g>
      );
    case 8: // oak tree
      return (
        <g fill={c}>
          <circle cx={16.9} cy={16.6} r={3.3} />
          <circle cx={23.1} cy={16.6} r={3.3} />
          <circle cx={20} cy={13.9} r={3.4} />
          <circle cx={20} cy={17.6} r={3.6} />
          <path d="M19.1 19.5 H20.9 V25 L22.6 26.2 H17.4 L19.1 25 Z" />
        </g>
      );
    case 9: // key
      return (
        <g stroke={c} fill={c}>
          <circle cx={20} cy={14.8} r={2.5} strokeWidth={1.8} fill="none" />
          <rect x={19.2} y={17.2} width={1.6} height={8.6} rx={0.8} stroke="none" />
          <rect x={20.6} y={22.6} width={2.8} height={1.5} rx={0.6} stroke="none" />
          <rect x={20.6} y={24.7} width={2.2} height={1.4} rx={0.6} stroke="none" />
        </g>
      );
    default: // cross couped — bold heraldic cross
      return (
        <g fill={c}>
          <rect x={18.5} y={12.4} width={3} height={13.4} rx={1} />
          <rect x={13.4} y={17.4} width={13.2} height={3} rx={1} />
        </g>
      );
  }
}

export type HeraldicAvatarProps = {
  /** Counterparty address or handle. Same seed → same crest, always. */
  seed: string;
  /** Rendered diameter in px (the chip footprint). Defaults to 36 (size-9). */
  size?: number;
  className?: string;
};

export function HeraldicAvatar({ seed, size = 36, className }: HeraldicAvatarProps) {
  // useId keeps the clipPath id unique when the same crest appears twice on a
  // page (e.g. Home Recent + Insights both showing one counterparty).
  const uid = useId();
  const clipId = `crest${uid.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const h = fnv1a(seed.trim().toLowerCase());
  // 9 divisions × 10 charges × 10 palettes = 900 crests; mod-then-split keeps
  // the three axes independent of one another.
  const idx = h % 900;
  const division = idx % 9;
  const charge = Math.floor(idx / 9) % 10;
  const palette = PALETTES[Math.floor(idx / 90) % 10];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className ?? ""}`}
      style={{ borderRadius: "9999px", display: "block" }}
    >
      <defs>
        <clipPath id={clipId}>
          <path d={SHIELD} />
        </clipPath>
      </defs>
      {/* chip disc */}
      <circle cx={20} cy={20} r={20} fill={palette.bg} />
      {/* shield field + division, clipped to the heater outline */}
      <path d={SHIELD} fill={palette.a} />
      <g clipPath={`url(#${clipId})`}>
        <Division index={division} b={palette.b} />
        <Charge index={charge} c={palette.c} field={palette.a} />
      </g>
      {/* subtle 1px darker outline so the badge reads as enamel */}
      <path d={SHIELD} fill="none" stroke={palette.line} strokeOpacity={0.45} strokeWidth={1} />
    </svg>
  );
}
