import { Reveal } from "./Reveal";

const PARTNERS = [
  "Yellow Card",
  "Flutterwave",
  "Onafriq",
  "Kotani Pay",
  "M-Pesa",
  "Paystack",
];

export function PartnerStrip() {
  return (
    <section className="border-y border-[var(--color-line)] bg-[var(--color-surface-2)] py-16">
      <div className="mx-auto max-w-6xl px-6 md:px-8">
        <Reveal>
          <div className="text-center text-[11px] font-medium uppercase tracking-[0.22em] text-[var(--color-fg-dim)]">
            Local last-mile partners across Africa
          </div>
        </Reveal>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {PARTNERS.map((p, i) => (
            <Reveal key={p} delay={i * 0.04}>
              <span className="inline-flex items-center rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-fg-dim)]">
                {p}
              </span>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
