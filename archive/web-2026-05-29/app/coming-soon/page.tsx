import type { Metadata } from "next";
import Image from "next/image";

export const metadata: Metadata = {
  title: "Talise — Coming soon",
  description:
    "Talise is a borderless money app for the African corridor. Send money home in seconds. Coming soon.",
};

/**
 * Static coming-soon page. One viewport, no JS interactivity, no links.
 * Built so the apex domain can be parked here while the product is in
 * private testing. Light mode, brand-consistent typography (DM Sans body
 * + Instrument Serif italic emphasis), and the cosmic hero centered.
 */
export default function ComingSoon() {
  return (
    <main className="flex h-svh w-full flex-col items-center justify-between bg-[#fafaf7] px-6 py-10 text-[#111]">
      {/* Top: wordmark */}
      <header className="flex items-center gap-1.5">
        <Image
          src="/logo.png"
          alt="Talise"
          width={48}
          height={48}
          priority
          className="h-10 w-10"
        />
        <span className="text-[26px] font-normal tracking-[-0.02em]">
          talise
        </span>
      </header>

      {/* Middle: hero image + motto */}
      <section className="flex flex-col items-center text-center">
        <div className="relative aspect-square w-[min(78vw,360px)] overflow-hidden rounded-2xl">
          <Image
            src="/coming-soon-hero.png"
            alt=""
            fill
            priority
            sizes="(max-width: 480px) 78vw, 360px"
            className="object-cover"
          />
        </div>

        <h1 className="mt-9 max-w-[640px] text-[34px] font-medium leading-[1.08] tracking-[-0.03em] md:text-[44px]">
          Send money across the globe.
          <br />
          <span className="font-serif italic font-normal text-[#5a554a]">
            For free.
          </span>
        </h1>

        <p className="mt-5 max-w-[420px] text-[15px] leading-[1.55] text-[#6b6457] md:text-[16px]">
          A borderless money app, powered by the Sui Dollar.
        </p>
      </section>

      {/* Bottom: status pill */}
      <footer className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[#8a8472]">
        <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[#c08a3e]" />
        Coming soon · 2026
      </footer>
    </main>
  );
}
