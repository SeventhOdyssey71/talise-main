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
          className="inline-flex items-center rounded-full bg-[var(--color-surface-2)] px-5 py-2.5 text-[14px] text-[var(--color-fg)] transition hover:bg-[var(--color-surface)]"
        >
          Back to home
        </Link>
      </header>

      {/* Hero body. flex-1 + items/justify-center keeps the form
          vertically centered between header and footer regardless of
          viewport height. Symmetric `py-8` padding so the visual
          weight reads as centered (was `pt-6 pb-8` which biased the
          content downward on tall screens). */}
      <section className="mx-auto flex w-full max-w-[640px] flex-1 flex-col items-center justify-center px-6 py-8 text-center">
        <h1 className="text-[clamp(2rem,4.5vw,2.75rem)] font-medium leading-[1.04] tracking-[-0.025em]">
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

        <p className="mt-4 max-w-[420px] text-[15px] leading-[1.55] text-white/65">
          Hold dollars. Send home in seconds. Earn on idle balance.
        </p>

        <div className="mt-6 w-full max-w-[460px]">
          <WaitlistForm />
        </div>
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
