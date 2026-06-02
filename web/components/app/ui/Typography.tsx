import type { ReactNode } from "react";

export type EyebrowProps = { children: ReactNode; className?: string };

/** Mono 10px uppercase eyebrow, wide tracking, dim colour. */
export function Eyebrow({ children, className = "" }: EyebrowProps) {
  return (
    <span
      className={`font-mono text-[10px] font-medium uppercase text-fg-dim ${className}`}
      style={{ letterSpacing: "0.22em" }}
    >
      {children}
    </span>
  );
}

export type MicroLabelProps = { children: ReactNode; className?: string };

/** Small mono micro-label for addresses, timestamps, secondary metadata. */
export function MicroLabel({ children, className = "" }: MicroLabelProps) {
  return (
    <span
      className={`font-mono text-[11px] text-fg-muted ${className}`}
      style={{ letterSpacing: "0.01em" }}
    >
      {children}
    </span>
  );
}
