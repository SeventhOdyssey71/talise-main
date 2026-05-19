"use client";

import { motion } from "framer-motion";
import { Reveal } from "./Reveal";

const PEOPLE = [
  {
    name: "Chiamaka",
    where: "London → Lagos",
    age: 32,
    role: "NHS nurse, sending home",
    pain: "Sends £500 home every month. Western Union takes around £32 in fees plus a poor exchange rate — roughly £45 lost per transfer.",
    win: "With Talise, the fee on £500 is around £5. She saves about £40 a month — £480 a year — and her mum gets the cash in under 5 seconds.",
    initials: "C",
    glyph: "£500 → ₦1,050,000",
  },
  {
    name: "Mama Adaeze",
    where: "Lagos · receives",
    age: 61,
    role: "The family back home",
    pain: "Used to spend a half-day on the bus to collect cash from a Western Union agent. Sometimes the agent was out of naira and she'd come back the next day.",
    win: "Now the naira lands in her mobile money in seconds. She buys yams from the market on the same phone. No queue, no agent, no \"come back tomorrow.\"",
    initials: "A",
    glyph: "₦1,050,000 received",
  },
];

export function PersonaCards() {
  return (
    <section id="personas" className="py-32">
      <div className="mx-auto max-w-7xl px-6 md:px-8">
        <Reveal>
          <div className="text-[12px] uppercase tracking-[0.22em] text-[var(--color-accent)]">
            Who it&apos;s for
          </div>
        </Reveal>
        <Reveal delay={0.1}>
          <h2 className="mt-4 font-display text-[40px] leading-[1.05] tracking-[-0.02em] md:text-[56px]">
            Built for the
            <br />
            <em className="not-italic text-[var(--color-accent)]">
              diaspora
            </em>
            .
          </h2>
        </Reveal>
        <Reveal delay={0.15}>
          <p className="mt-6 max-w-2xl text-[17px] leading-[1.6] text-[var(--color-fg-muted)]">
            Every month, millions of Africans abroad send a piece of their
            salary home. Talise is for the person sending it — and the family
            waiting on it.
          </p>
        </Reveal>

        <div className="mt-16 grid gap-5 md:grid-cols-2">
          {PEOPLE.map((p, i) => (
            <Reveal key={i} delay={i * 0.1}>
              <motion.div
                whileHover={{ y: -4 }}
                transition={{ duration: 0.2 }}
                className="h-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-7"
              >
                <div className="flex items-center gap-4">
                  <div
                    className="flex h-12 w-12 items-center justify-center rounded-full font-display text-[20px] text-[var(--color-bg)]"
                    style={{
                      background:
                        "linear-gradient(135deg, var(--color-accent), var(--color-accent-soft))",
                    }}
                  >
                    {p.initials}
                  </div>
                  <div>
                    <div className="font-display text-[20px] tracking-tight text-[var(--color-fg)]">
                      {p.name}, {p.age}
                    </div>
                    <div className="text-[12px] text-[var(--color-fg-muted)]">
                      {p.where} · {p.role}
                    </div>
                  </div>
                </div>

                <div className="mt-5 inline-flex items-center rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-1.5 font-mono text-[12px] tracking-tight text-[var(--color-fg)]">
                  {p.glyph}
                </div>

                <div className="mt-6 space-y-4">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-dim)]">
                      Before
                    </div>
                    <p className="mt-1 text-[14px] leading-relaxed text-[var(--color-fg-muted)]">
                      {p.pain}
                    </p>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
                      With Talise
                    </div>
                    <p className="mt-1 text-[14px] leading-relaxed text-[var(--color-fg)]">
                      {p.win}
                    </p>
                  </div>
                </div>
              </motion.div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
