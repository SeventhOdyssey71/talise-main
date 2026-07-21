/**
 * THE TALISE DESIGN — mobile tokens.
 *
 * Ported 1:1 from the iOS app's DesignSystem/Tokens.swift so the React Native
 * app reads as the same product. Dark-mode only (the iOS app forces
 * .preferredColorScheme(.dark)); there is deliberately no light theme.
 */

export const colors = {
  // Surfaces
  bg: "#000000",
  surface: "#161616",
  surface2: "#242424",
  surfaceGlass: "#1C1C1C",
  surfaceGlassStrong: "#2C2C2C",

  // Foreground
  fg: "#FFFFFF",
  fgSubtle: "#FAFAFA",
  fgMuted: "#B5B5B5",
  fgDim: "#636363",

  // Hairlines (white @ 8%)
  line: "rgba(255,255,255,0.08)",
  lineStrong: "rgba(255,255,255,0.14)",

  // Brand
  accent: "#79D96C", // live / success / primary green
  greenMint: "#CAFFB8",
  greenDeep: "#4B8A37",
  warmGold: "#C08A3E",
  danger: "#A05A3E",

  // Activity badges
  badgeSent: "rgba(108,58,56,0.5)",
  badgeReceived: "rgba(53,95,64,0.5)",
  badgeNeutral: "rgba(74,74,74,0.6)",

  // On-accent text
  onAccent: "#0A1F06",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 25,
  pill: 40,
} as const;

export const buttonHeight = {
  sm: 32,
  md: 40,
  lg: 44,
} as const;

/**
 * Type ramp. iOS uses system SF Pro + SF Mono; on Android the platform default
 * (Roboto) stands in for SF Pro and a monospace family for SF Mono. Sizes match
 * the iOS Typography scale.
 */
export const font = {
  // families resolved per-platform in design/typography.ts
  size: {
    micro: 11,
    caption: 13,
    body: 15,
    callout: 16,
    title: 20,
    heading: 26,
    display: 34,
    hero: 48,
  },
  weight: {
    regular: "400",
    medium: "500",
    semibold: "600",
    bold: "700",
  },
  tracking: {
    tight: -0.4,
    label: 1.6, // uppercase mono micro-labels
  },
} as const;

export type Colors = typeof colors;
