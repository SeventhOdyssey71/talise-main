import type { ButtonHTMLAttributes, ReactNode, AnchorHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-[var(--color-fg)] text-[var(--color-bg)] border border-[var(--color-fg)] hover:bg-[var(--color-accent-soft)] hover:border-[var(--color-accent-soft)]",
  secondary:
    "bg-[var(--color-surface)] text-[var(--color-fg)] border border-[var(--color-line)] hover:border-[var(--color-fg)]",
  ghost:
    "bg-transparent text-[var(--color-fg-muted)] border border-transparent hover:text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]",
  danger:
    "bg-[#a05a3e] text-white border border-[#a05a3e] hover:bg-[#8a4a30]",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-[12px] gap-1.5",
  md: "h-10 px-4 text-[13px] gap-2",
  lg: "h-11 px-5 text-[14px] gap-2",
};

const BASE =
  "inline-flex items-center justify-center rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-fg)]/30";

/**
 * Single Button primitive used everywhere a tap-target lives. Variants
 * follow the brand's visual scale (primary = inverted, secondary = bordered,
 * ghost = transparent, danger = warm red). Sizes follow the heightful
 * 8/10/11 rhythm so buttons line up against inputs, badges, and chips.
 *
 * Supports `as="a"` for link buttons so we don't need to wrap an <a> in
 * an extra <button> just for the styling.
 */
export function Button({
  variant = "primary",
  size = "md",
  className = "",
  leading,
  trailing,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  leading?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <button
      className={`${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {leading}
      {children}
      {trailing}
    </button>
  );
}

export function LinkButton({
  variant = "primary",
  size = "md",
  className = "",
  leading,
  trailing,
  children,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: Variant;
  size?: Size;
  leading?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <a
      className={`${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {leading}
      {children}
      {trailing}
    </a>
  );
}
