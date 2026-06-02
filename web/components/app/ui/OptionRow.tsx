import type { ReactNode } from "react";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";

export type OptionRowProps = {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  badge?: string;
  onClick?: () => void;
  href?: string;
  dimmed?: boolean;
};

/**
 * A glass list row: a 40px accent-tinted icon disc, title + optional
 * subtitle, optional badge, and a trailing chevron. Renders as a link when
 * `href` is set, a button when `onClick` is set, else a static row.
 */
export function OptionRow({
  icon,
  title,
  subtitle,
  badge,
  onClick,
  href,
  dimmed = false,
}: OptionRowProps) {
  const interactive = !!(href || onClick) && !dimmed;
  const cls = `talise-history-row flex w-full items-center gap-3.5 px-3.5 py-3 text-left ${
    interactive ? "cursor-pointer hover:-translate-y-px" : ""
  } ${dimmed ? "opacity-55" : ""}`;

  const inner = (
    <>
      <span
        className="flex size-10 shrink-0 items-center justify-center rounded-full text-accent"
        style={{ background: "var(--color-accent-soft)" }}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium text-fg">{title}</span>
        {subtitle && <span className="block truncate text-[13px] text-fg-dim">{subtitle}</span>}
      </span>
      {badge && (
        <span
          className="shrink-0 rounded-full border border-line px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-fg-dim"
          style={{ background: "var(--color-surface-2)" }}
        >
          {badge}
        </span>
      )}
      {interactive && (
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          size={18}
          className="shrink-0 text-fg-dim"
          strokeWidth={2}
        />
      )}
    </>
  );

  if (href && !dimmed) {
    return (
      <Link href={href} className={cls}>
        {inner}
      </Link>
    );
  }
  if (onClick && !dimmed) {
    return (
      <button type="button" onClick={onClick} className={cls}>
        {inner}
      </button>
    );
  }
  return <div className={cls}>{inner}</div>;
}
