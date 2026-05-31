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
    <main className="flex min-h-svh w-full flex-col overflow-x-hidden bg-[var(--color-bg)] text-[var(--color-fg)]">
      {/* Same soft green wash as the landing hero, scoped so it
          doesn't fight the form's contrast. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[60vh] bg-gradient-to-b from-[var(--color-accent)]/[0.08] to-transparent blur-3xl"
      />

      {/* Header matches the landing TopBar pattern exactly so the
          two pages feel like one product, not two designs. */}
      <header className="relative z-10 mx-auto flex w-full max-w-[1440px] items-center justify-between gap-3 px-5 py-5 sm:px-6 md:px-12 lg:px-16">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2.5 text-[17px] tracking-tight text-[var(--color-fg)]"
        >
          <Diamond />
          <span>talise</span>
        </Link>
        <Link
          href="/"
          className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-[var(--color-surface-2)] px-4 py-2 text-[13px] text-[var(--color-fg)] transition hover:bg-[var(--color-surface)] sm:px-5 sm:py-2.5 sm:text-[14px]"
        >
          Back to home
        </Link>
      </header>

      {/* Hero body. flex-1 + items/justify-center vertically centers
          the form between header and footer. A small upward translate
          biases the content above true-center so the headline sits in
          the visually-heavier upper third (true-center reads slightly
          low against a tall viewport — see screenshot 2026-05-29). */}
      <section className="mx-auto flex w-full max-w-[640px] flex-1 flex-col items-center justify-center px-5 py-10 text-center sm:px-6 sm:py-12 sm:-translate-y-8 lg:-translate-y-12">
        <h1 className="text-balance break-words text-[30px] font-medium leading-[1.08] tracking-[-0.025em] sm:text-[40px] lg:text-[44px]">
          Get an{" "}
          <span
            className="italic text-[var(--color-accent)]"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            @handle
          </span>{" "}
          <br className="hidden sm:block" />
          that holds dollars.
        </h1>

        <p className="mt-4 max-w-[420px] text-[14px] leading-[1.55] text-white/65 sm:text-[15px]">
          Hold dollars. Send home in seconds. Earn on idle balance.
        </p>

        <div className="mt-7 w-full max-w-[440px] sm:mt-8">
          <WaitlistForm />
        </div>
      </section>

      {/* Minimal footer, matches landing. */}
      <footer className="mx-auto w-full max-w-[1200px] px-5 py-5 sm:px-10">
        <div className="flex flex-col items-start gap-3 text-[12px] text-white/45 sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} Talise, Inc. · Built on Sui.</span>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
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
