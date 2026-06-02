import type { ReactNode } from "react";
import Link from "next/link";
import { Spinner } from "./Spinner";

export type PrimaryButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  loading?: boolean;
  variant?: "primary" | "ghost" | "danger";
  full?: boolean;
  type?: "button" | "submit";
};

/**
 * The app's main action button. `primary` is a forest-green (#4B8A37) capsule
 * with white text; `ghost` is a glass capsule; `danger` is a tinted red
 * capsule. Shows a spinner while `loading`.
 */
export function PrimaryButton({
  children,
  onClick,
  href,
  disabled = false,
  loading = false,
  variant = "primary",
  full = false,
  type = "button",
}: PrimaryButtonProps) {
  const base =
    "relative inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-[15px] font-semibold transition-[transform,background,border-color,opacity] duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";
  const width = full ? "w-full" : "";

  const variantCls =
    variant === "primary"
      ? "bg-accent-deep text-white shadow-[0_6px_18px_-6px_rgba(35,78,20,0.45)] hover:bg-[color-mix(in_srgb,var(--color-accent-deep)_88%,white)]"
      : variant === "danger"
        ? "border border-[color-mix(in_srgb,var(--color-danger)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-danger)_14%,transparent)] text-[var(--color-danger)] hover:bg-[color-mix(in_srgb,var(--color-danger)_22%,transparent)]"
        : "border border-line bg-surface text-fg hover:border-[color-mix(in_srgb,var(--color-accent-deep)_40%,var(--color-line))]";

  const isDisabled = disabled || loading;
  const cls = `${base} ${variantCls} ${width}`;

  const content = (
    <>
      {loading && <Spinner size={16} />}
      <span className={loading ? "opacity-80" : ""}>{children}</span>
    </>
  );

  if (href && !isDisabled) {
    return (
      <Link href={href} className={cls}>
        {content}
      </Link>
    );
  }
  return (
    <button type={type} onClick={onClick} disabled={isDisabled} className={cls} aria-busy={loading}>
      {content}
    </button>
  );
}
