import Link from "next/link";

/**
 * Light-mode marketing top bar. Logo on the left, two anchor links in
 * the middle (How it works / Who it's for), pill sign-in on the right.
 * Hairline bottom border instead of the dark page's transparent header.
 */
export function TopBar() {
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--landing-border)] bg-[var(--landing-bg)]/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1200px] items-center justify-between px-6 py-4 md:px-10 lg:px-16">
        <Link
          href="/"
          className="flex items-center gap-2 text-[16px] font-semibold tracking-tight text-[var(--landing-fg)]"
        >
          <Diamond />
          <span>talise</span>
        </Link>
        <nav className="hidden items-center gap-8 text-[14px] text-[var(--landing-fg-dim)] md:flex">
          <a href="#how" className="transition hover:text-[var(--landing-fg)]">
            How it works
          </a>
          <a href="#who" className="transition hover:text-[var(--landing-fg)]">
            Who it's for
          </a>
        </nav>
        <Link
          href="#cta"
          className="inline-flex h-10 items-center justify-center rounded-full bg-black px-5 text-[13px] font-medium text-white transition hover:bg-[#1a1a1a]"
        >
          Sign in
        </Link>
      </div>
    </header>
  );
}

function Diamond() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path d="M12 2 22 12 12 22 2 12z" fill="#0a0a0a" />
    </svg>
  );
}
