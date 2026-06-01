"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { Reveal } from "./Reveal";

type Pillar = {
  image: string;
  /** Render the image as a small icon-style mark vs a full background tile. */
  iconLike?: boolean;
  tag: string;
  title: string;
  sub: string;
  accent: string;
};

const PILLARS: Pillar[] = [
  {
    image: "/pillar-send.png",
    tag: "01 / Send",
    title: "Across borders, in seconds.",
    sub: "Send to a phone, a username, or a wallet. Naira, cedis, shillings, rand — we settle in USDsui and land in the receiver's local currency, faster than any traditional rail.",
    accent: "₦ · GH₵ · KSh · R",
  },
  {
    image: "/pillar-earn.png",
    tag: "02 / Earn",
    title: "Idle money should compound.",
    sub: "Move USDsui into NAVI lending in one tap. Watch real-time yield. Withdraw anytime. No lockups, no jargon — just a balance that quietly grows.",
    accent: "Real APY · No lockup · One tap",
  },
  {
    image: "/usdsui-logo.png",
    iconLike: true,
    tag: "03 / Stable",
    title: "Built on the Sui Dollar.",
    sub: "USDsui is the canonical Sui-native dollar. No bridge risk, no wrapped tokens, no off-chain custody. The same dollar your savings, payments, and yield all share.",
    accent: "USDSUI · 1:1 · ON-CHAIN",
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

        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {PILLARS.map((p, i) => (
            <Reveal key={i} delay={i * 0.08}>
              <motion.div
                whileHover={{ y: -3 }}
                transition={{ duration: 0.2 }}
                className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-[#e8e1cf] bg-white p-7"
              >
                {/* Inline icon-style mark — feels like a product card, not a
                    moodboard tile. Larger square frame keeps a generous
                    presence without dominating the copy. */}
                <div className="flex items-center justify-between">
                  <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#8a8472]">
                    {p.tag}
                  </div>
                  <div
                    className={`relative h-14 w-14 overflow-hidden rounded-2xl ${
                      p.iconLike ? "" : "border border-[#f0e8d6]"
                    }`}
                  >
                    <Image
                      src={p.image}
                      alt=""
                      fill
                      sizes="56px"
                      className={
                        p.iconLike ? "object-contain p-1" : "object-cover"
                      }
                    />
                  </div>
                </div>

                <div className="mt-7 text-[24px] font-medium leading-[1.12] tracking-[-0.02em] text-[#111] md:text-[26px]">
                  {p.title}
                </div>
                <p className="mt-3 flex-1 text-[14px] leading-[1.55] text-[#5a554a]">
                  {p.sub}
                </p>
                <div className="mt-6 font-mono text-[11px] uppercase tracking-[0.18em] text-[#c08a3e]">
                  {p.accent}
                </div>
              </motion.div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
