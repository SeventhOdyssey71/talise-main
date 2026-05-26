import Link from "next/link";

/**
 * Minimal Xend-style footer. Logomark + © on the left, three links on
 * the right, single thin top border, generous padding. The big-wordmark
 * watermark and 4-column link grid from the previous dark footer have
 * been intentionally dropped in favor of restraint.
 */
export function LandingFooter() {
  return (
    <footer className="border-t border-[var(--landing-border)] bg-[var(--landing-bg)]">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col items-start gap-6 px-6 py-12 md:flex-row md:items-center md:justify-between md:px-10 md:py-16 lg:px-16">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="flex items-center gap-2 text-[16px] font-semibold tracking-tight text-[var(--landing-fg)]"
          >
            <Diamond />
            <span>talise</span>
          </Link>
          <span className="text-[13px] text-[var(--landing-fg-muted)]">
            © {new Date().getFullYear()} Talise, Inc.
          </span>
        </div>

        <nav className="flex items-center gap-7 text-[13px]">
          <a
            href="#"
            className="text-[var(--landing-fg-dim)] transition hover:text-[var(--landing-fg)]"
          >
            Litepaper
          </a>
          <a
            href="https://x.com/talise_io"
            target="_blank"
            rel="noreferrer noopener"
            className="text-[var(--landing-fg-dim)] transition hover:text-[var(--landing-fg)]"
          >
            X / Twitter
          </a>
          <a
            href="#cta"
            className="text-[var(--landing-fg)] underline-offset-4 hover:underline"
          >
            Get started
          </a>
        </nav>
      </div>
    </footer>
  );
}

function Diamond() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path d="M12 2 22 12 12 22 2 12z" fill="#0a0a0a" />
    </svg>
  );
}
