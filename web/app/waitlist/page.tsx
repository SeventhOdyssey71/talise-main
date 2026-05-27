import Link from "next/link";
import type { Metadata } from "next";
import { Diamond } from "@/components/Diamond";
import { WaitlistForm } from "./WaitlistForm";

export const metadata: Metadata = {
  title: "Talise. Join the waitlist.",
  description:
    "Talise is in private beta. Drop your email and we'll let you in as the doors open.",
};

/**
 * Talise waitlist page. Mirrors the landing's dark visual language
 * (near-black bg, soft green TopGlow, accent-green pulse). Reachable
 * from every "Get started" CTA on the landing while the product is
 * gated. Tuned to fit a 1280x800 / 1440x900 viewport in a single
 * screen, so a desktop visitor sees the headline, form, and trust
 * tiles without scrolling.
 */
export default function WaitlistPage() {
  return (
    <main className="flex min-h-svh w-full flex-col overflow-hidden bg-[var(--color-bg)] text-[var(--color-fg)]">
      {/* Same soft green wash as the landing hero, scoped so it
          doesn't fight the form's contrast. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[60vh] bg-gradient-to-b from-[var(--color-accent)]/[0.08] to-transparent blur-3xl"
      />

      {/* Header matches the landing TopBar pattern exactly so the
          two pages feel like one product, not two designs. */}
      <header className="relative z-10 mx-auto flex w-full max-w-[1440px] items-center justify-between px-6 py-5 md:px-12 lg:px-16">
        <Link
          href="/"
          className="flex items-center gap-2.5 text-[17px] tracking-tight text-[var(--color-fg)]"
        >
          <Diamond />
          <span>talise</span>
        </Link>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-surface-2)] px-5 py-2.5 text-[14px] text-[var(--color-fg)] transition hover:bg-[var(--color-surface)]"
        >
          <span aria-hidden>←</span>
          Back to home
        </Link>
      </header>

      {/* Hero body. flex-1 lets the section grow to fill the viewport
          between header and footer so vertical centering looks balanced
          on tall laptop screens. */}
      <section className="mx-auto flex w-full max-w-[640px] flex-1 flex-col items-center justify-center px-6 pb-8 pt-6 text-center sm:pt-10">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5">
          <span className="relative inline-flex h-1.5 w-1.5">
            <span className="absolute inset-0 animate-ping rounded-full bg-[var(--color-accent)]/60" />
            <span className="relative h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/70">
            Private beta. Joining is by invite.
          </span>
        </div>

        <h1 className="text-[clamp(2rem,4.5vw,2.75rem)] font-medium leading-[1.04] tracking-[-0.025em]">
          Get an{" "}
          <span className="italic" style={{ fontFamily: "var(--font-serif)" }}>
            @handle
          </span>
          <br className="hidden sm:block" />
          that holds dollars.
        </h1>

        <p className="mt-4 max-w-[480px] text-[15px] leading-[1.55] text-white/65">
          Talise turns <span className="text-white">@yourname</span> into a Sui
          address that auto-converts every inbound coin to USDsui. Hold
          dollars, send home in seconds, earn on idle balance.
        </p>

        <div className="mt-6 w-full max-w-[460px]">
          <WaitlistForm />
        </div>

        {/* Compressed reassurance line. Three trust signals on a
            single row so the page still fits in 1280x800. */}
        <div className="mt-6 flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.18em] text-white/45">
          <span>Early access</span>
          <span aria-hidden className="text-white/20">·</span>
          <span>No spam</span>
          <span aria-hidden className="text-white/20">·</span>
          <span>Easy out</span>
        </div>

        <Link
          href="/litepaper"
          className="mt-5 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-white/55 hover:text-white"
        >
          Read the litepaper while you wait
          <span aria-hidden>→</span>
        </Link>
      </section>

      {/* Minimal footer, matches landing. */}
      <footer className="mx-auto w-full max-w-[1200px] px-6 py-5 sm:px-10">
        <div className="flex flex-col items-start gap-3 text-[12px] text-white/45 sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} Talise, Inc. · Built on Sui.</span>
          <div className="flex items-center gap-5">
            <Link href="/litepaper" className="hover:text-white">
              Litepaper
            </Link>
            <a
              href="https://x.com/talisemoney"
              target="_blank"
              rel="noreferrer noopener"
              className="hover:text-white"
            >
              X / Twitter
            </a>
            <a
              href="https://sui.io"
              target="_blank"
              rel="noreferrer noopener"
              className="hover:text-white"
            >
              Sui
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}
