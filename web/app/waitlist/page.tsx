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
    <main className="landing-mint relative flex min-h-svh w-full flex-col overflow-x-hidden text-[var(--color-fg)]">
      {/* Premium mint horizon bloom — same language as the landing hero. */}
      <div aria-hidden className="talise-top-glow" />

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
          className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-2 text-[13px] font-medium text-[var(--color-fg)] shadow-[0_1px_3px_rgba(35,78,20,0.08)] transition hover:border-[var(--color-accent-deep)] hover:text-[var(--color-accent-deep)] hover:shadow-[0_3px_10px_rgba(35,78,20,0.14)] sm:px-5 sm:py-2.5 sm:text-[14px]"
        >
          Back to home
        </Link>
      </header>

      {/* Hero body. flex-1 + items/justify-center vertically centers
          the form between header and footer. A small upward translate
          biases the content above true-center so the headline sits in
          the visually-heavier upper third (true-center reads slightly
          low against a tall viewport — see screenshot 2026-05-29). */}
      {/* Width adapts to the state: the sign-in / claim form caps itself
          narrow (max-w-[440px], inside WaitlistForm), while the post-claim
          dashboard fans out to the full width for its side-by-side cards. So
          the section is generous and the children own their own max-width. */}
      <section className="mx-auto flex w-full max-w-[1040px] flex-1 flex-col items-center justify-center px-5 py-10 sm:px-6 sm:py-12">
        <div className="text-center">
          <h1 className="text-balance break-words text-[30px] font-medium leading-[1.08] tracking-[-0.025em] sm:text-[40px] lg:text-[44px]">
            Get an{" "}
            <span className="text-[var(--color-accent)]">@handle</span>{" "}
            <br className="hidden sm:block" />
            that holds dollars.
          </h1>

          <p className="mx-auto mt-4 max-w-[420px] text-[14px] leading-[1.55] text-[var(--color-fg-muted)] sm:text-[15px]">
            Hold dollars. Send home in seconds. Earn on idle balance.
          </p>
        </div>

        <div className="mt-7 w-full sm:mt-8">
          <WaitlistForm />
        </div>
      </section>

      {/* Minimal footer, matches landing. */}
      <footer className="mx-auto w-full max-w-[1200px] px-5 py-5 sm:px-10">
        <div className="flex flex-col items-start gap-3 text-[12px] text-[var(--color-fg-dim)] sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} Talise, Inc. · Built on Sui.</span>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <Link href="/litepaper" className="hover:text-[var(--color-fg)]">
              Litepaper
            </Link>
            <a
              href="https://x.com/taliseio"
              target="_blank"
              rel="noreferrer noopener"
              className="hover:text-[var(--color-fg)]"
            >
              X / Twitter
            </a>
            <a
              href="https://sui.io"
              target="_blank"
              rel="noreferrer noopener"
              className="hover:text-[var(--color-fg)]"
            >
              Sui
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}
