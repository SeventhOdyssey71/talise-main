import { Reveal } from "./Reveal";
import { HeroCTA } from "./HeroCTA";

export function FinalCTA() {
  return (
    <section className="relative overflow-hidden border-t border-[var(--color-line)] py-32">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(70% 50% at 50% 50%, rgba(0,0,0,0.06) 0%, rgba(255,255,255,0) 70%)",
        }}
      />
      <div className="relative mx-auto max-w-3xl px-6 text-center md:px-8">
        <Reveal>
          <div className="text-[12px] uppercase tracking-[0.22em] text-[var(--color-accent)]">
            Your first send is on us
          </div>
        </Reveal>
        <Reveal delay={0.1}>
          <h2 className="mt-4 font-display text-[48px] leading-[1.02] tracking-[-0.02em] md:text-[72px]">
            Send your first
            <br />
            <em className="not-italic text-[var(--color-accent)]">
              £100 home
            </em>
            .
            <br />
            We&apos;ll cover the fees.
          </h2>
        </Reveal>
        <Reveal delay={0.15}>
          <p className="mt-6 text-[17px] leading-[1.6] text-[var(--color-fg-muted)]">
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
          <p className="mt-6 text-[11px] uppercase tracking-[0.18em] text-[var(--color-fg-dim)]">
            No app to install · Arrives in seconds · ~1% on future sends
          </p>
        </Reveal>
      </div>
    </section>
  );
}
