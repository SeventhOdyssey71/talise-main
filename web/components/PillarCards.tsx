"use client";

import { motion } from "framer-motion";
import { Reveal } from "./Reveal";

const PILLARS = [
  {
    tag: "01 / Currency",
    title: "Naira, cedis, shillings, rand.",
    sub: "Pay in the currency you earn in. Your family receives in the currency they spend in. We handle the middle.",
    accent: "₦  GH₵  KSh  R",
  },
  {
    tag: "02 / Last mile",
    title: "Direct to mobile money & bank.",
    sub: "Local partners deliver the final hop — M-Pesa in Kenya, Flutterwave and Paystack in Nigeria, Yellow Card across the continent, Kotani Pay for the rest.",
    accent: "Flutterwave · Yellow Card · M-Pesa · Kotani Pay",
  },
  {
    tag: "03 / Reach",
    title: "Send from any country, to any phone.",
    sub: "No IBAN. No SWIFT code. No agent visits. If your recipient has a phone number, they can receive.",
    accent: "UK · US · EU → NG · KE · GH · ZA",
  },
];

export function PillarCards() {
  return (
    <section id="how" className="py-32">
      <div className="mx-auto max-w-7xl px-6 md:px-8">
        <Reveal>
          <div className="text-[12px] uppercase tracking-[0.22em] text-[var(--color-accent)]">
            How it works
          </div>
        </Reveal>
        <Reveal delay={0.1}>
          <h2 className="mt-4 font-display text-[40px] leading-[1.05] tracking-[-0.02em] md:text-[56px]">
            One app.
            <br />
            Every corridor.
            <br />
            <em className="not-italic text-[var(--color-accent)]">
              Arrives in seconds.
            </em>
          </h2>
        </Reveal>

        <div className="mt-16 grid gap-5 md:grid-cols-3">
          {PILLARS.map((p, i) => (
            <Reveal key={i} delay={i * 0.1}>
              <motion.div
                whileHover={{ y: -4 }}
                transition={{ duration: 0.2 }}
                className="relative h-full overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-7"
              >
                <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-fg-dim)]">
                  {p.tag}
                </div>
                <div className="mt-6 font-display text-[36px] leading-[1.05] tracking-[-0.02em] text-[var(--color-fg)]">
                  {p.title}
                </div>
                <p className="mt-3 text-[15px] leading-relaxed text-[var(--color-fg-muted)]">
                  {p.sub}
                </p>
                <div className="mt-8 font-mono text-[11px] uppercase tracking-wider text-[var(--color-accent)]">
                  {p.accent}
                </div>
                <div
                  aria-hidden
                  className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-[var(--color-accent)] opacity-[0.06] blur-3xl"
                />
              </motion.div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
