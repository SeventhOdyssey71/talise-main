"use client";

/**
 * PublicPay — the standalone, ungated /pay/<handle> page.
 *
 * This is the shareable target of a Talise payment link. It is NOT behind the
 * /app gate, so it can't read the recipient table (that endpoint is authed).
 * Instead it renders the handle + optional amount/memo straight from the URL
 * and offers a single "Pay with Talise" CTA that routes into the app's send
 * flow with the recipient and amount prefilled (`/app/pay?to=&amount=`). If the
 * visitor isn't signed in, the app's send pipeline triggers Google sign-in and
 * returns them to the prefilled review.
 *
 * Self-contained light-mint styling — it lives outside AppShell, so it carries
 * its own `.landing-mint` root (flips tokens + reskins `.talise-glass` to the
 * white lifted card) and can't rely on the shell's providers (no useCurrency
 * here). Amounts are shown in USD.
 */

import { useState } from "react";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon, CheckmarkBadge01Icon, Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { Diamond } from "@/components/Diamond";

export type PublicPayProps = {
  /** The raw handle or address slug from the URL path. */
  slug: string;
  /** Optional requested amount in USD. */
  amountUsd: number | null;
  /** Optional memo. */
  memo: string | null;
};

function isAddress(s: string): boolean {
  return /^0x[0-9a-fA-F]{6,}$/.test(s);
}

function displayName(slug: string): string {
  if (isAddress(slug)) return `${slug.slice(0, 8)}…${slug.slice(-6)}`;
  return `@${slug.replace(/^@/, "")}`;
}

export function PublicPay({ slug, amountUsd, memo }: PublicPayProps) {
  const [copied, setCopied] = useState(false);

  // Route into the in-app send flow with the recipient (+ amount) prefilled.
  const target = (() => {
    const qs = new URLSearchParams();
    qs.set("to", slug);
    if (amountUsd != null) qs.set("amount", amountUsd.toFixed(2));
    return `/app/pay?${qs.toString()}`;
  })();

  const amountLabel =
    amountUsd != null
      ? `$${amountUsd.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`
      : null;

  const copyLink = async () => {
    if (typeof window === "undefined") return;
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <main className="landing-mint relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-5 py-10 text-fg">
      <div className="talise-top-glow" aria-hidden />

      <div className="relative z-10 w-full max-w-sm">
        {/* Brand mark */}
        <div className="mb-8 flex justify-center">
          <Link href="/" className="inline-flex items-center gap-2">
            <Diamond />
            <span className="font-display text-[18px] font-semibold lowercase tracking-[-0.02em] text-fg">
              talise
            </span>
          </Link>
        </div>

        {/* Pay card */}
        <div className="talise-glass rounded-[28px] px-6 py-8 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-fg-dim">
            {amountLabel ? "Payment request" : "Pay"}
          </p>

          {amountLabel ? (
            <div
              className="mt-4 font-display font-semibold tabular-nums text-fg"
              style={{ fontSize: 52, letterSpacing: "-0.04em", lineHeight: 1 }}
            >
              {amountLabel}
            </div>
          ) : (
            <div
              className="mt-4 font-display text-[26px] font-semibold text-fg"
              style={{ letterSpacing: "-0.02em" }}
            >
              {displayName(slug)}
            </div>
          )}

          {amountLabel && (
            <p className="mt-3 text-[14px] text-fg-muted">
              to <span className="text-fg">{displayName(slug)}</span>
            </p>
          )}

          {memo && (
            <p className="mx-auto mt-2 max-w-[15rem] text-[13px] text-fg-dim">
              &ldquo;{memo}&rdquo;
            </p>
          )}

          {amountLabel && (
            <p className="mt-2 font-mono text-[11px] text-fg-dim">
              {amountUsd!.toFixed(2)} USDsui · digital dollars, 1:1
            </p>
          )}

          <div className="mt-8">
            <Link
              href={target}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-accent-deep px-6 py-3.5 text-[15px] font-semibold text-white shadow-[0_6px_18px_-6px_rgba(35,78,20,0.45)] transition-[transform,background-color] duration-150 hover:bg-[color-mix(in_srgb,var(--color-accent-deep)_88%,white)] active:scale-[0.98]"
            >
              Pay with Talise
              <HugeiconsIcon icon={ArrowRight01Icon} size={18} strokeWidth={2.4} color="#fff" />
            </Link>
          </div>

          <button
            type="button"
            onClick={copyLink}
            className="mt-3 inline-flex items-center justify-center gap-1.5 text-[13px] font-medium text-fg-dim transition-colors hover:text-fg"
          >
            <HugeiconsIcon
              icon={copied ? Tick02Icon : Copy01Icon}
              size={14}
              strokeWidth={2}
              color={copied ? "var(--color-accent)" : undefined}
            />
            {copied ? "Link copied" : "Copy link"}
          </button>
        </div>

        {/* Trust footnote */}
        <div className="mt-6 flex items-center justify-center gap-1.5">
          <HugeiconsIcon
            icon={CheckmarkBadge01Icon}
            size={13}
            color="var(--color-accent)"
            strokeWidth={2}
          />
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-dim">
            Gasless · settles on Sui in seconds
          </span>
        </div>

        <p className="mt-5 text-center text-[12px] text-fg-dim">
          New to Talise?{" "}
          <Link href="/" className="text-fg-muted underline-offset-2 hover:underline">
            See how it works
          </Link>
        </p>
      </div>
    </main>
  );
}

export default PublicPay;
