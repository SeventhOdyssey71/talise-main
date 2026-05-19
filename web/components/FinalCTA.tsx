import Image from "next/image";
import { Reveal } from "./Reveal";
import { HeroCTA } from "./HeroCTA";

export function FinalCTA() {
  return (
    <section className="relative overflow-hidden bg-[#fafaf7] py-32 md:py-40">
      {/* Distant galaxy echo — reuses the hero image, heavily faded, anchored
          off-canvas behind the headline. Gives the section a quiet visual
          tie-back to the hero without competing with the copy. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-32 mx-auto h-[600px] w-[110%] max-w-[1600px] opacity-50"
      >
        <Image
          src="/landing-hero.png"
          alt=""
          fill
          sizes="100vw"
          className="object-cover object-center"
        />
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-b from-transparent to-[#fafaf7]"
        />
      </div>

      <div className="relative z-10 mx-auto max-w-3xl px-6 text-center md:px-8">
        <Reveal>
          <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#c08a3e]">
            Your first send is on us
          </div>
        </Reveal>
        <Reveal delay={0.1}>
          <h2 className="mt-5 text-[44px] leading-[1.02] tracking-[-0.03em] md:text-[72px]">
            Send your first{" "}
            <span className="font-serif italic font-normal text-[#5a554a]">
              £100 home.
            </span>
            <br />
            We&apos;ll cover the fees.
          </h2>
        </Reveal>
        <Reveal delay={0.15}>
          <p className="mt-6 text-[16px] leading-[1.6] text-[#5a554a] md:text-[18px]">
            Sign in with Google. Pick who you&apos;re sending to. We&apos;ll
            handle the rest — including the cost of the first transfer.
          </p>
        </Reveal>
        <Reveal delay={0.25}>
          <div className="mx-auto mt-10 max-w-sm">
            <HeroCTA />
          </div>
        </Reveal>
        <Reveal delay={0.3}>
          <p className="mt-7 font-mono text-[11px] uppercase tracking-[0.22em] text-[#8a8472]">
            No app to install · Arrives in seconds · &lt;1% on future sends
          </p>
        </Reveal>
      </div>
    </section>
  );
}
