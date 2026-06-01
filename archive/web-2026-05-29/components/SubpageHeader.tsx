import { Logo } from "./Logo";

/**
 * Top bar for any focused single-task subpage (not a dashboard).
 * Use AppShell for dashboards instead.
 */
export function SubpageHeader({
  backHref,
  backLabel = "Back",
}: {
  backHref: string;
  backLabel?: string;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--color-line)] bg-[var(--color-surface)]/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4 md:px-8">
        <Logo size={26} href={backHref} />
        <a
          href={backHref}
          className="inline-flex items-center gap-2 rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[12px] text-[var(--color-fg-muted)] transition hover:border-[var(--color-fg)] hover:text-[var(--color-fg)]"
        >
          <span aria-hidden>←</span>
          {backLabel}
        </a>
      </div>
    </header>
  );
}
