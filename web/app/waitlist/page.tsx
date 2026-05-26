import Link from "next/link";
import type { Metadata } from "next";
import { WaitlistForm } from "./WaitlistForm";

export const metadata: Metadata = {
  title: "Talise — Join the waitlist",
  description:
    "Talise is in private beta. Drop your email and we'll let you in as the doors open.",
};

/**
 * Talise waitlist page — mirrors the landing's dark visual language
 * (near-black bg, soft green TopGlow, accent-green pulse). Reachable
 * from every "Get started" CTA on the landing while the product is
 * gated. The form is the only interactive surface; everything else
 * is static, server-rendered.
 *
 * Copy is Talise-specific, not generic-checking-account:
 *   - @handle.talise.sui SuiNS routing
 *   - Auto-swap any inbound coin to USDsui
 *   - Sui mainnet, Cetus, Navi
 *   - African corridor ("home in seconds")
 */
export default function WaitlistPage() {
  return (
    <main className="min-h-svh w-full overflow-hidden bg-[#0A0A0A] text-white">
      {/* Top glow — same soft green wash as the landing hero, scoped so
          it doesn't fight the form's contrast. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[60vh] bg-gradient-to-b from-[#79D96C]/[0.08] to-transparent blur-3xl"
      />

      {/* Header — Talise wordmark on the left, "Back to home" on the right.
          Mirrors Xend's waitlist header pattern. */}
      <header className="flex items-center justify-between px-6 py-6 sm:px-10">
        <Link
          href="/"
          className="flex items-center gap-1.5 text-[20px] font-medium tracking-[-0.02em]"
        >
          <TaliseGlyph />
          <span>talise</span>
        </Link>
        <Link
          href="/"
          className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/55 hover:text-white"
        >
          ← Back to home
        </Link>
      </header>

      {/* Hero body — eyebrow, headline, sub, form, reassurance tiles. */}
      <section className="mx-auto flex w-full max-w-[640px] flex-col items-center px-6 pb-24 pt-12 text-center sm:pt-20">
        <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5">
          <span className="relative inline-flex h-1.5 w-1.5">
            <span className="absolute inset-0 animate-ping rounded-full bg-[#79D96C]/60" />
            <span className="relative h-1.5 w-1.5 rounded-full bg-[#79D96C]" />
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/70">
            Private beta — joining is by invite
          </span>
        </div>

        <h1 className="text-[clamp(2.25rem,5.5vw,3.5rem)] font-medium leading-[1.04] tracking-[-0.025em]">
          Get an <span className="italic" style={{ fontFamily: "var(--font-serif)" }}>@handle</span><br className="hidden sm:block" />
          that holds dollars.
        </h1>

        <p className="mt-5 max-w-[480px] text-[17px] leading-[1.55] text-white/65">
          Talise turns <span className="text-white">@yourname</span> into a Sui
          address that auto-converts every inbound coin to USDsui. Send money
          home in seconds, hold dollars on your phone, earn yield on idle
          balance — no wires, no swift codes, no three-day waits.
        </p>

        <div className="mt-9 w-full max-w-[460px]">
          <WaitlistForm />
        </div>

        {/* Reassurance tiles — three columns, same shape as Xend. */}
        <div className="mt-12 grid w-full max-w-[560px] grid-cols-1 gap-3 sm:grid-cols-3">
          <ReassuranceTile
            title="Early access"
            body="Invites go out in small batches. Waitlist members go through first."
          />
          <ReassuranceTile
            title="No spam"
            body="One email when it's your turn. Nothing in between."
          />
          <ReassuranceTile
            title="Easy out"
            body="Unsubscribe any time. We won't take it personally."
          />
        </div>

        <Link
          href="/litepaper"
          className="mt-10 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-white/55 hover:text-white"
        >
          Read the litepaper while you wait
          <span aria-hidden>→</span>
        </Link>
      </section>

      {/* Footer — minimal, matches landing. */}
      <footer className="mx-auto w-full max-w-[1200px] border-t border-white/[0.06] px-6 py-8 sm:px-10">
        <div className="flex flex-col items-start gap-3 text-[12px] text-white/45 sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} Talise, Inc. · Built on Sui.</span>
          <div className="flex items-center gap-5">
            <Link href="/litepaper" className="hover:text-white">Litepaper</Link>
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

function TaliseGlyph() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M12 2L22 12L12 22L2 12L12 2Z"
        fill="#79D96C"
        fillOpacity="0.15"
        stroke="#79D96C"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function ReassuranceTile({ title, body }: { title: string; body: string }) {
  return (
    // h-full keeps the 3 tiles equal height even when one body wraps to
    // a different line count. Slight padding bump + lighter border so
    // the tiles read at parity with the input pill above.
    <div className="flex h-full flex-col rounded-2xl border border-white/[0.08] bg-white/[0.025] px-4 py-4 text-left">
      <div className="text-[13px] font-medium text-white">{title}</div>
      <div className="mt-1.5 text-[12px] leading-[1.5] text-white/60">{body}</div>
    </div>
  );
}
