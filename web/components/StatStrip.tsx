import { AnimatedNumber } from "./AnimatedNumber";
import { Reveal } from "./Reveal";

const STATS = [
  {
    value: 700,
    prefix: "$",
    suffix: "B",
    decimals: 0,
    label: "sent across borders every year",
    sub: "Migrants, families, students — money moving home.",
  },
  {
    value: 6.4,
    suffix: "%",
    decimals: 1,
    label: "what Africa loses to fees",
    sub: "Western Union, MoneyGram, and bank wires skim the top off every transfer.",
  },
  {
    value: 1,
    prefix: "<",
    suffix: "%",
    decimals: 0,
    label: "what Talise charges",
    sub: "Around 1% per transfer. Zero on your first send.",
  },
];

export function StatStrip() {
  return (
    <section className="border-y border-[var(--color-line)] bg-[var(--color-surface)]/40 py-20">
      <div className="mx-auto max-w-7xl px-6 md:px-8">
        <Reveal>
          <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-fg-dim)]">
            The remittance market in three numbers
          </div>
        </Reveal>
        <div className="mt-10 grid gap-12 md:grid-cols-3">
          {STATS.map((s, i) => (
            <Reveal key={i} delay={i * 0.1}>
              <div>
                <div className="font-display text-[56px] leading-none tracking-[-0.03em] text-[var(--color-fg)] md:text-[64px]">
                  <AnimatedNumber
                    to={s.value}
                    prefix={s.prefix}
                    suffix={s.suffix}
                    decimals={s.decimals}
                  />
                </div>
                <div className="mt-4 text-[13px] uppercase tracking-[0.12em] text-[var(--color-accent)]">
                  {s.label}
                </div>
                <p className="mt-2 text-[14px] leading-relaxed text-[var(--color-fg-muted)]">
                  {s.sub}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
