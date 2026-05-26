import Image from "next/image";
import { SignInButton } from "@/components/SignInButton";
import { Eyebrow, SectionShell } from "./primitives";

/**
 * Light-mode hero. Big centered headline, sub-copy, dual CTAs (Google
 * sign-in + App Store), and the phone collage sitting on a soft gray
 * radial wash. The phone image itself stays dark — that IS the iOS app
 * — but the section background is light, like Xend.
 */
export function Hero({ err }: { err?: string }) {
  return (
    <SectionShell className="pt-20 pb-16 text-center md:pt-28 md:pb-24">
      <div className="mx-auto inline-flex items-center justify-center gap-2">
        <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[var(--landing-brand)]" />
        <Eyebrow>new, live on Sui mainnet</Eyebrow>
      </div>

      <h1 className="mx-auto mt-7 max-w-[1100px] text-[clamp(2.75rem,7vw,5.5rem)] font-semibold leading-[1.02] tracking-[-0.025em] text-[var(--landing-fg)]">
        Send money across the globe.{" "}
        <span
          className="text-[var(--landing-accent)]"
          style={{ fontFamily: "var(--font-serif)", fontStyle: "italic" }}
        >
          For free.
        </span>
      </h1>

      <p className="mx-auto mt-6 max-w-[640px] text-[17px] leading-relaxed text-[var(--landing-fg-dim)]">
        Talise moves naira, shillings, cedis, and rand across borders with
        sub-second finality, at a fraction of what Wise, Western Union, or
        Remitly charge. Sign in on the web or grab the iOS app. No agent,
        no queue.
      </p>

      {/* Dual CTAs */}
      <div
        id="cta"
        className="mx-auto mt-10 flex w-full max-w-[520px] flex-col items-stretch gap-3 sm:flex-row sm:justify-center"
      >
        <div className="flex flex-1">
          <SignInButton variant="primary" label="Sign Up with Google" />
        </div>
        <AppStoreButton />
      </div>
      <div className="mt-5 flex items-center justify-center gap-3 text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--landing-fg-muted)]">
        <span>web + iOS</span>
        <span>·</span>
        <span>finality under 1 second</span>
      </div>

      {err && <ErrorBanner err={err} />}

      <PhoneCollage />
    </SectionShell>
  );
}

function AppStoreButton() {
  return (
    <a
      href="#"
      className="group inline-flex h-[54px] flex-1 items-center justify-center gap-3 rounded-2xl bg-black px-5 text-white transition hover:bg-[#1a1a1a]"
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

function PhoneCollage() {
  return (
    <div className="relative mx-auto mt-16 w-full max-w-[1100px] md:mt-24">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-1/4 -z-10 mx-auto h-[80%] max-w-[900px] blur-3xl"
        style={{
          background:
            "radial-gradient(60% 55% at 50% 50%, rgba(121,217,108,0.18), transparent 70%)",
        }}
      />
      <Image
        src="/talise-app-collage.png"
        alt="Talise iOS app: Earn and Home screens shown side by side"
        width={2208}
        height={1242}
        priority
        sizes="(max-width: 768px) 100vw, 1100px"
        className="mx-auto h-auto w-full"
      />
    </div>
  );
}

function ErrorBanner({ err }: { err: string }) {
  return (
    <div
      role="status"
      className="mx-auto mt-6 max-w-[460px] rounded-xl border border-[#c95a4a33] bg-[#fee7e3] px-4 py-3 text-[12px] text-[#9a3623]"
    >
      <span className="font-mono uppercase tracking-[0.18em] opacity-70">
        sign-in error ·{" "}
      </span>
      {err}
    </div>
  );
}
