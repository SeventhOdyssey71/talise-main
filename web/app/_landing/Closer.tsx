import { SignInButton } from "@/components/SignInButton";
import { SectionShell } from "./primitives";

/**
 * Closing CTA section. Preserves the original "Send. Save. Earn. Always
 * free." headline and sub-copy verbatim, restyled in light mode. Dual
 * CTAs match the hero.
 */
export function Closer() {
  return (
    <SectionShell className="border-t border-[var(--landing-border)] py-28 text-center md:py-36">
      <h2 className="mx-auto max-w-[840px] text-[clamp(2.25rem,5.5vw,4.25rem)] font-semibold leading-[1.05] tracking-[-0.02em] text-[var(--landing-fg)]">
        Send. Save. Earn.{" "}
        <span
          className="text-[var(--landing-accent)]"
          style={{ fontFamily: "var(--font-serif)", fontStyle: "italic" }}
        >
          Always free.
        </span>
      </h2>
      <p className="mx-auto mt-6 max-w-[560px] text-[17px] leading-relaxed text-[var(--landing-fg-dim)]">
        Talise covers the network fee on every transfer. No first-transfer
        gimmick. No fine print. Free, every single time.
      </p>
      <div className="mx-auto mt-10 flex w-full max-w-[520px] flex-col items-stretch gap-3 sm:flex-row sm:justify-center">
        <div className="flex flex-1">
          <SignInButton variant="primary" label="Sign Up with Google" />
        </div>
        <AppStoreButton />
      </div>
    </SectionShell>
  );
}

function AppStoreButton() {
  return (
    <a
      href="#"
      className="inline-flex h-[54px] flex-1 items-center justify-center gap-3 rounded-2xl bg-black px-5 text-white transition hover:bg-[#1a1a1a]"
      aria-label="Download Talise on the App Store"
    >
      <AppleGlyph />
      <span className="flex flex-col items-start leading-[1.05]">
        <span className="text-[8px] uppercase tracking-[0.18em] text-white/60">
          Download on the
        </span>
        <span className="text-[14px] font-medium text-white">App Store</span>
      </span>
    </a>
  );
}

function AppleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.53 4.08zM12 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  );
}
