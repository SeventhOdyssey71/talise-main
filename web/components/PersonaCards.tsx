"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { Reveal } from "./Reveal";

const PEOPLE = [
  {
    name: "Chiamaka",
    where: "London → Lagos",
    role: "NHS nurse, sending home",
    pain: "Sends £500 home every month. Western Union takes around £32 in fees plus a poor exchange rate — roughly £45 lost per transfer.",
    win: "With Talise, the fee on £500 is near zero. She saves about £40 a month — £480 a year — and her mum gets the cash in under 5 seconds.",
    glyph: "£500 → ₦1,050,000",
  },
  {
    name: "Mama Adaeze",
    where: "Lagos · receives",
    role: "The family back home",
    pain: "Used to spend a half-day on the bus to collect cash from an agent. Sometimes the agent was out of naira and she'd come back the next day.",
    win: "Now the naira lands in her mobile money in seconds. She buys yams from the market on the same phone. No queue, no agent, no \"come back tomorrow.\"",
    glyph: "₦1,050,000 received",
  },
];

export function PersonaCards() {
  return (
    <section id="personas" className="bg-[#f5f1e6] py-28 md:py-36">
      <div className="mx-auto max-w-7xl px-6 md:px-8">
        <div className="grid items-start gap-12 md:grid-cols-[1.05fr_1fr] md:gap-16">
          <div>
            <Reveal>
              <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#8a8472]">
                Who it&apos;s for
              </div>
            </Reveal>
            <Reveal delay={0.1}>
              <h2 className="mt-5 text-[40px] leading-[1.04] tracking-[-0.03em] md:text-[58px]">
                Built for the
                <br />
                <span className="font-serif italic font-normal text-[#5a554a]">
                  diaspora.
                </span>
              </h2>
            </Reveal>
            <Reveal delay={0.15}>
              <p className="mt-6 max-w-md text-[16px] leading-[1.6] text-[#5a554a] md:text-[17px]">
                Every month, millions of Africans abroad send a piece of their
                salary home. Talise is for the person sending it — and the
                family waiting on it.
              </p>
            </Reveal>

            <Reveal delay={0.2}>
              <div className="relative mt-10 aspect-[3/2] w-full max-w-md overflow-hidden rounded-2xl border border-[#e8e1cf]">
                <Image
                  src="/persona-halo.png"
                  alt=""
                  fill
                  sizes="(max-width: 768px) 100vw, 500px"
                  className="object-cover"
                />
              </div>
            </Reveal>
          </div>

          <div className="grid gap-5">
            {PEOPLE.map((p, i) => (
              <Reveal key={i} delay={i * 0.1}>
                <motion.div
                  whileHover={{ y: -3 }}
                  transition={{ duration: 0.2 }}
                  className="rounded-2xl border border-[#e8e1cf] bg-white p-7"
                >
                  <div className="flex items-baseline justify-between gap-4">
                    <div>
                      <div className="text-[20px] font-medium tracking-[-0.02em] text-[#111]">
                        {p.name}
                      </div>
                      <div className="mt-0.5 font-mono text-[11px] uppercase tracking-[0.16em] text-[#8a8472]">
                        {p.where} · {p.role}
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 inline-flex items-center rounded-md border border-[#e8e1cf] bg-[#fafaf7] px-3 py-1.5 font-mono text-[12px] tracking-tight text-[#111]">
                    {p.glyph}
                  </div>

                  <div className="mt-6 space-y-4">
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#a09a8a]">
                        Before
                      </div>
                      <p className="mt-1.5 text-[14px] leading-[1.55] text-[#5a554a]">
                        {p.pain}
                      </p>
                    </div>
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#c08a3e]">
                        With Talise
                      </div>
                      <p className="mt-1.5 text-[14px] leading-[1.55] text-[#111]">
                        {p.win}
                      </p>
                    </div>
                  </div>
                </motion.div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
