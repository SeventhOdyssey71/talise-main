import { Reveal } from "./Reveal";

export function ProblemSection() {
  return (
    <section className="py-32">
      <div className="mx-auto max-w-4xl px-6 md:px-8">
        <Reveal>
          <div className="text-[12px] uppercase tracking-[0.22em] text-[var(--color-accent)]">
            The problem
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <h2 className="mt-4 font-display text-[44px] leading-[1.05] tracking-[-0.02em] text-[var(--color-fg)] md:text-[64px]">
            Sending money home
            <br />
            is still broken.
          </h2>
        </Reveal>

        <div className="mt-10 grid gap-10 md:grid-cols-2">
          <Reveal delay={0.2}>
            <p className="text-[14px] leading-[1.6] text-[var(--color-fg-muted)] md:text-[15px]">
              Western Union takes{" "}
              <span className="text-[var(--color-fg)]">6.4%</span> of every
              transfer, takes up to{" "}
              <span className="text-[var(--color-fg)]">3 days</span> to arrive,
              and still asks the recipient to walk into an agent. Bank wires
              take <span className="text-[var(--color-fg)]">5 days</span>, cost
              around <span className="text-[var(--color-fg)]">$50</span>, and
              get stuck in compliance more often than they should.
            </p>
          </Reveal>
          <Reveal delay={0.3}>
            <p className="text-[14px] leading-[1.6] text-[var(--color-fg-muted)] md:text-[15px]">
              Talise replaces all of it with a Google sign-in and a{" "}
              <span className="text-[var(--color-fg)]">2-second</span>{" "}
              settlement. No agent, no SWIFT, no waiting. You send pounds, your
              mum sees naira in her mobile money before you&apos;ve put the
              phone down.
            </p>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
