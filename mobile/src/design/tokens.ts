/**
 * THE TALISE DESIGN — mobile tokens.
 *
 * Ported VERBATIM from ios/Talise/DesignSystem/Tokens.swift so the RN app reads
 * as the exact same product. Dark-mode only (iOS forces .preferredColorScheme
 * (.dark)); there is deliberately no light theme. `Color(hex:)` on iOS is straight
 * sRGB with no gamma adjustment, so hex values map 1:1.
 */

export const colors = {
  // Surfaces
  bg: "#000000",
  surface: "#161616",
  surface2: "#242424",
  surfaceGlass: "#1C1C1C", // nav pill / flat card (glassmorphism retired → solid)
  surfaceGlassStrong: "#2C2C2C", // active nav pill
  usernameCard: "#161616",

  // Foreground
  fg: "#FFFFFF",
  fgSubtle: "#FAFAFA",
  fgMuted: "#B5B5B5",
  fgDim: "#636363",

  // Hairlines
  line: "rgba(255,255,255,0.08)", // Color.white.opacity(0.08)

  // Brand
  accent: "#79D96C",
  accentSoft: "#2A2A2A",
  greenMint: "#CAFFB8",
  greenDeep: "#4B8A37", // forest CTA fill
  live: "#79D96C",
  success: "#79D96C",
  warmGold: "#C08A3E",
  danger: "#A05A3E",

  // Activity badges (with the exact iOS opacities baked in)
  badgeSent: "rgba(108,58,56,0.5)", // #6C3A38 @ 0.5
  badgeReceived: "rgba(53,95,64,0.5)", // #355F40 @ 0.5
  badgeNeutral: "rgba(74,74,74,0.6)", // #4A4A4A @ 0.6

  // Button label inks
  inkOnAccent: "#0A140C", // LiquidGlassButton label on accent/mint fills
  primaryLabel: "#F2FFEC", // TaliseButton .primary label on greenDeep
} as const;

/**
 * PremiumListRow badge kinds (TopGlow.swift) — disc fill + glyph tint.
 */
export const badgeKind = {
  earn: { disc: "rgba(121,217,108,0.18)", glyph: colors.accent },
  moneyIn: { disc: "rgba(202,255,184,0.42)", glyph: "#2E5E1F" },
  moneyOut: { disc: "rgba(75,138,55,0.18)", glyph: colors.accent },
  neutral: { disc: colors.surface2, glyph: colors.fg },
  locked: { disc: colors.surface2, glyph: colors.fgDim },
} as const;

// TaliseSpacing — exact iOS names/values.
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

// TaliseRadius
export const radius = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 25, // big cards
  pill: 40, // bottom nav
} as const;

// TaliseHeight
export const buttonHeight = {
  sm: 32,
  md: 40,
  lg: 44,
} as const;

/**
 * TaliseButtonSize (TaliseButton.swift): height / horizontal padding / font size.
 */
export const buttonSize = {
  sm: { height: buttonHeight.sm, hPadding: 12, fontSize: 12 },
  md: { height: buttonHeight.md, hPadding: 16, fontSize: 13 },
  lg: { height: buttonHeight.lg, hPadding: 20, fontSize: 14 },
} as const;

export type ButtonSizeKey = keyof typeof buttonSize;
export type Colors = typeof colors;
