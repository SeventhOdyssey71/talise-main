import { Reveal } from "./Reveal";

const POINTS = [
  {
    h: "Sub-second finality",
    p: "Sends settle in under a second. No waiting, no pending screens.",
  },
  {
    h: "Sub-cent fees",
    p: "Gas costs fractions of a penny. Sui has zero-fee stablecoin transfers coming.",
  },
  {
    h: "zkLogin Google sign-in",
    p: "Native to the chain. No seed phrase, no wallet install, no extension to learn.",
  },
  {
    h: "Move type safety",
    p: "Assets are typed objects, not balances. Composable, type-checked, atomic.",
  },
];

export function WhySuiStrip() {
  return (
    <section id="why-sui" className="py-32">
      <div className="mx-auto max-w-7xl px-6 md:px-8">
        <Reveal>
          <div className="text-[12px] uppercase tracking-[0.22em] text-[var(--color-accent)]">
            Why Sui
          </div>
        </Reveal>
        <Reveal delay={0.1}>
          <h2 className="mt-4 font-display text-[40px] leading-[1.05] tracking-[-0.02em] md:text-[56px]">
            The only chain
            <br />
            this works on.
          </h2>
        </Reveal>
        <Reveal delay={0.15}>
          <p className="mt-6 max-w-2xl text-[17px] leading-[1.6] text-[var(--color-fg-muted)]">
            Talise needs four things: atomic multi-call transactions,
            consumer-grade onboarding, a native order book for routing, and
            negligible fees. Sui ships all four out of the box.
          </p>
        </Reveal>

        <div className="mt-16 grid gap-px overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-line)] md:grid-cols-2">
          {POINTS.map((point, i) => (
            <Reveal key={i} delay={i * 0.08}>
              <div className="h-full bg-[var(--color-bg)] p-7">
                <div className="font-display text-[20px] tracking-tight text-[var(--color-fg)]">
                  {point.h}
                </div>
                <p className="mt-2 text-[14px] leading-relaxed text-[var(--color-fg-muted)]">
                  {point.p}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
