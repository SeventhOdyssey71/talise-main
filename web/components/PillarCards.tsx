"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { Reveal } from "./Reveal";

const PILLARS = [
  {
    image: "/pillar-send.png",
    tag: "01 / Send",
    title: "Across borders, in seconds.",
    sub: "Send to a phone, a username, or a wallet. Naira, cedis, shillings, rand — we settle in USDsui and land in the receiver's local currency, faster than any traditional rail.",
    accent: "₦  GH₵  KSh  R",
  },
  {
    image: "/pillar-earn.png",
    tag: "02 / Earn",
    title: "Idle money should compound.",
    sub: "Move USDsui into NAVI lending in one tap. Watch real-time yield. Withdraw anytime. No lockups, no jargon — just a balance that quietly grows.",
    accent: "Real APY · No lockup · One tap",
  },
  {
    image: "/pillar-stable.png",
    tag: "03 / Stable",
    title: "Built on the Sui Dollar.",
    sub: "USDsui is the canonical Sui-native dollar. No bridge risk, no wrapped tokens, no off-chain custody. The same dollar your savings, payments, and yield all share.",
    accent: "USDsui · 1:1 · On-chain",
  },
];

export function PillarCards() {
  return (
    <section id="how" className="bg-[#fafaf7] py-28 md:py-36">
      <div className="mx-auto max-w-7xl px-6 md:px-8">
        <Reveal>
          <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#8a8472]">
            How it works
          </div>
        </Reveal>
        <Reveal delay={0.1}>
          <h2 className="mt-5 max-w-3xl text-[40px] leading-[1.04] tracking-[-0.03em] md:text-[58px]">
            One app.
            <br />
            Every corridor.
            <br />
            <span className="font-serif italic font-normal text-[#5a554a]">
              Arrives in seconds.
            </span>
          </h2>
        </Reveal>

        <div className="mt-16 grid gap-5 md:grid-cols-3">
          {PILLARS.map((p, i) => (
            <Reveal key={i} delay={i * 0.1}>
              <motion.div
                whileHover={{ y: -4 }}
                transition={{ duration: 0.2 }}
                className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-[#e8e1cf] bg-white"
              >
                <div className="relative aspect-[3/2] w-full overflow-hidden">
                  <Image
                    src={p.image}
                    alt=""
                    fill
                    sizes="(max-width: 768px) 100vw, 33vw"
                    className="object-cover transition duration-700 group-hover:scale-[1.03]"
                  />
                </div>
                <div className="flex flex-1 flex-col p-7">
                  <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#8a8472]">
                    {p.tag}
                  </div>
                  <div className="mt-5 text-[26px] font-medium leading-[1.1] tracking-[-0.02em] text-[#111] md:text-[28px]">
                    {p.title}
                  </div>
                  <p className="mt-3 text-[15px] leading-[1.55] text-[#5a554a]">
                    {p.sub}
                  </p>
                  <div className="mt-7 font-mono text-[11px] uppercase tracking-[0.18em] text-[#c08a3e]">
                    {p.accent}
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
