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

// Each tone → {fg text colour, faint matching background tint}. Tuned for the
// light-mint canvas: forest text on a soft-mint fill for positive states, a
// warm ochre for pending/paused, fg-muted on surface-2 for neutral/completed,
// and a deep terracotta on a soft-red wash for danger (all AA on light).
const TONES: Record<StatusTone, { color: string; bg: string }> = {
  funded: { color: "var(--color-accent)", bg: "var(--color-accent-soft)" },
  active: { color: "var(--color-accent)", bg: "var(--color-accent-soft)" },
  success: { color: "var(--color-accent)", bg: "var(--color-accent-soft)" },
  claimed: { color: "var(--color-accent)", bg: "var(--color-accent-soft)" },
  completed: { color: "var(--color-fg-muted)", bg: "var(--color-surface-2)" },
  paused: { color: "#8a6a16", bg: "color-mix(in srgb, #d9a52a 22%, #ffffff)" },
  pending: { color: "#8a6a16", bg: "color-mix(in srgb, #d9a52a 22%, #ffffff)" },
  danger: { color: "#b3473b", bg: "color-mix(in srgb, #c95a4a 16%, #ffffff)" },
  neutral: { color: "var(--color-fg-dim)", bg: "var(--color-surface-2)" },
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
