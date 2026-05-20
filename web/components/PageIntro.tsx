import type { ReactNode } from "react";

/**
 * Consistent intro blurb that sits between the page header (rendered by
 * AppShell) and the page's main content.
 *
 * Every sidebar-routed page should use this so the rhythm (font size,
 * width, top margin) is identical across the app. If a page doesn't
 * need a blurb, just skip it — content starts directly under the header.
 */
export function PageIntro({ children }: { children: ReactNode }) {
  return (
    <p className="max-w-2xl text-[13px] leading-[1.6] text-[var(--color-fg-muted)] md:text-[14px]">
      {children}
    </p>
  );
}

/**
 * Section header used inside a page (e.g. "Activity", "Your identity").
 * Mirrors the SectionRow in /home but exports a single primitive for
 * every page to share.
 */
export function SectionHeader({
  title,
  right,
}: {
  title: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="font-mono text-[10px] font-medium uppercase tracking-[0.22em] text-[var(--color-fg-dim)]">
        {title}
      </h2>
      {right}
    </div>
  );
}
