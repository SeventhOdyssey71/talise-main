import type { ReactNode } from "react";

export type StatusTone =
  | "funded"
  | "claimed"
  | "active"
  | "paused"
  | "completed"
  | "pending"
  | "neutral"
  | "success"
  | "danger";

export type StatusPillProps = { label: string; tone?: StatusTone };

// Each tone → {fg text colour, faint matching background tint}.
const TONES: Record<StatusTone, { color: string; bg: string }> = {
  funded: { color: "var(--color-accent)", bg: "color-mix(in srgb, var(--color-accent) 12%, transparent)" },
  active: { color: "var(--color-accent)", bg: "color-mix(in srgb, var(--color-accent) 12%, transparent)" },
  success: { color: "var(--color-accent)", bg: "color-mix(in srgb, var(--color-accent) 12%, transparent)" },
  claimed: { color: "#9fe6a8", bg: "color-mix(in srgb, #9fe6a8 12%, transparent)" },
  completed: { color: "var(--color-fg-muted)", bg: "rgba(255,255,255,0.06)" },
  paused: { color: "#e6c46b", bg: "color-mix(in srgb, #e6c46b 14%, transparent)" },
  pending: { color: "#e6c46b", bg: "color-mix(in srgb, #e6c46b 14%, transparent)" },
  danger: { color: "var(--color-danger)", bg: "color-mix(in srgb, var(--color-danger) 14%, transparent)" },
  neutral: { color: "var(--color-fg-dim)", bg: "rgba(255,255,255,0.05)" },
};

/** Small capsule status badge, mono uppercase label, tone-tinted. */
export function StatusPill({ label, tone = "neutral" }: StatusPillProps) {
  const t = TONES[tone];
  const dot: ReactNode =
    tone === "active" || tone === "funded" || tone === "pending" || tone === "paused" ? (
      <span
        className="inline-block size-1.5 rounded-full"
        style={{ background: t.color }}
        aria-hidden
      />
    ) : null;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] font-medium uppercase"
      style={{ color: t.color, background: t.bg, letterSpacing: "0.1em" }}
    >
      {dot}
      {label}
    </span>
  );
}
