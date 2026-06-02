import type { CSSProperties, ReactNode } from "react";

export type GlassCardProps = {
  children: ReactNode;
  className?: string;
  /** Corner radius in px (continuous-feel rounded). Default 24. */
  radius?: number;
  /** Optional tint colour layered faintly over the glass fill. */
  tint?: string;
  /** Adds hover lift + pressable affordance. */
  interactive?: boolean;
  onClick?: () => void;
  as?: "div" | "button";
};

/**
 * The base liquid-glass surface: white-tint over a blurred backdrop, a 1px
 * hairline with a brighter top edge, soft black shadow, continuous rounded
 * corners. Mirrors the iOS `taliseGlass()` modifier.
 */
export function GlassCard({
  children,
  className = "",
  radius = 24,
  tint,
  interactive = false,
  onClick,
  as,
}: GlassCardProps) {
  const Tag = (as ?? (onClick ? "button" : "div")) as "div" | "button";
  const style: CSSProperties = { borderRadius: radius };
  if (tint) {
    // Light-mint tint: a faint wash of the tint colour over a near-white card
    // (matches the .landing-mint .talise-glass fill), so tinted cards stay
    // airy and legible rather than turning dark/glassy.
    style.background = `linear-gradient(to bottom, color-mix(in srgb, ${tint} 12%, #ffffff) 0%, color-mix(in srgb, ${tint} 5%, #f3faea) 100%)`;
  }
  const interactiveCls =
    interactive || onClick
      ? "transition-[transform,border-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:border-[color-mix(in_srgb,var(--color-accent-deep)_40%,var(--color-line))] active:translate-y-0 active:scale-[0.995] cursor-pointer"
      : "";
  return (
    <Tag
      onClick={onClick}
      style={style}
      className={`talise-glass relative ${Tag === "button" ? "block w-full text-left" : ""} ${interactiveCls} ${className}`}
      {...(Tag === "button" ? { type: "button" as const } : {})}
    >
      {children}
    </Tag>
  );
}
