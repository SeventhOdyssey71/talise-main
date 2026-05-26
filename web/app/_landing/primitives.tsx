import type { ReactNode } from "react";

/**
 * Shared atoms for the light-mode marketing landing. Centralizing the
 * eyebrow / headline / sub typography here keeps every section in tight
 * visual lockstep with the Xend-style hierarchy we're matching.
 *
 *   eyebrow  — small uppercase tracking, very dim
 *   headline — big bold, tight tracking, near-black
 *   sub      — relaxed body, dim
 */

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--landing-fg-muted)]">
      {children}
    </div>
  );
}

export function Headline({
  children,
  size = "lg",
  className = "",
}: {
  children: ReactNode;
  size?: "lg" | "md";
  className?: string;
}) {
  const scale =
    size === "lg"
      ? "text-[clamp(2.5rem,5vw,4rem)]"
      : "text-[clamp(2rem,4vw,3rem)]";
  return (
    <h2
      className={`${scale} font-semibold leading-[1.05] tracking-tight text-[var(--landing-fg)] ${className}`}
    >
      {children}
    </h2>
  );
}

export function Sub({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={`text-[17px] leading-relaxed text-[var(--landing-fg-dim)] ${className}`}
    >
      {children}
    </p>
  );
}

/** Primary CTA: solid black pill. Xend's signature button style. */
export function PrimaryCTA({
  href,
  children,
  className = "",
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      href={href}
      className={`inline-flex h-12 items-center justify-center rounded-full bg-black px-6 text-[15px] font-medium text-white transition hover:bg-[#1a1a1a] ${className}`}
    >
      {children}
    </a>
  );
}

/** Secondary CTA: underlined text link. */
export function SecondaryCTA({
  href,
  children,
  className = "",
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      href={href}
      className={`inline-flex items-center text-[15px] font-medium text-[var(--landing-fg)] underline-offset-4 hover:underline ${className}`}
    >
      {children}
    </a>
  );
}

/** Wraps a section with the standard side padding + max width. */
export function SectionShell({
  id,
  children,
  className = "",
}: {
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={`mx-auto w-full max-w-[1200px] px-6 md:px-10 lg:px-16 ${className}`}
    >
      {children}
    </section>
  );
}
