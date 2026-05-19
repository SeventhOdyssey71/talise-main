"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import { Reveal } from "./Reveal";

const CALLS = [
  {
    target: "margin::withdraw_quote",
    note: "pull USDsui from your earning balance",
  },
  {
    target: "deepbook::pool::swap_exact_quote_for_base",
    note: "swap USDsui → SUI on the on-chain order book",
  },
  {
    target: "talise::send::send",
    note: "transfer SUI to recipient + mint receipt NFT",
  },
];

export function PTBDemo() {
  const ref = useRef<HTMLDivElement | null>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section className="border-y border-[var(--color-line)] bg-[var(--color-surface-2)]/60 py-32">
      <div className="mx-auto max-w-7xl px-6 md:px-8">
        <Reveal>
          <div className="text-[12px] uppercase tracking-[0.22em] text-[var(--color-accent)]">
            The killer transaction
          </div>
        </Reveal>
        <Reveal delay={0.1}>
          <h2 className="mt-4 font-display text-[40px] leading-[1.05] tracking-[-0.02em] md:text-[56px]">
            One signature.
            <br />
            One block.
            <br />
            <em className="not-italic text-[var(--color-accent)]">
              Three Move calls.
            </em>
          </h2>
        </Reveal>
        <Reveal delay={0.2}>
          <p className="mt-6 max-w-2xl text-[17px] leading-[1.6] text-[var(--color-fg-muted)]">
            On every other chain, &ldquo;send Bob $50 as SUI&rdquo; takes four
            apps and three days. On Sui, Talise runs it as one Programmable
            Transaction Block. If anything fails, the whole thing reverts.
          </p>
        </Reveal>

        <div
          ref={ref}
          className="mt-16 grid items-center gap-12 md:grid-cols-[1fr,auto]"
        >
          <div className="relative">
            <div className="absolute left-[14px] top-2 bottom-2 w-px bg-[var(--color-line)]" />
            <div className="space-y-5">
              {CALLS.map((c, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -16 }}
                  animate={inView ? { opacity: 1, x: 0 } : {}}
                  transition={{
                    duration: 0.5,
                    delay: 0.3 + i * 0.25,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                  className="relative flex items-start gap-5"
                >
                  <motion.div
                    initial={{ scale: 0.4, opacity: 0 }}
                    animate={inView ? { scale: 1, opacity: 1 } : {}}
                    transition={{
                      duration: 0.4,
                      delay: 0.3 + i * 0.25,
                    }}
                    className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--color-accent)] bg-[var(--color-surface)] text-[11px] font-medium text-[var(--color-accent)]"
                  >
                    {i + 1}
                  </motion.div>
                  <div className="flex-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
                    <div className="font-mono text-[12px] text-[var(--color-fg)] md:text-[13px]">
                      {c.target}
                    </div>
                    <div className="mt-1.5 text-[13px] text-[var(--color-fg-muted)]">
                      {c.note}
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{
                duration: 0.5,
                delay: 0.3 + CALLS.length * 0.25 + 0.1,
              }}
              className="mt-8 flex items-center gap-3 pl-12"
            >
              <span className="inline-flex items-center gap-2 rounded-full border border-[var(--color-accent)] bg-[var(--color-accent)]/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
                <span className="relative inline-flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-accent)] opacity-60" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
                </span>
                atomic
              </span>
              <span className="text-[12px] text-[var(--color-fg-dim)]">
                any failure reverts the whole transaction
              </span>
            </motion.div>
          </div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={inView ? { opacity: 1 } : {}}
            transition={{ duration: 0.6, delay: 0.6 }}
            className="hidden md:block"
          >
            <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-6">
              <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--color-fg-dim)]">
                Receipt minted on chain
              </div>
              <div className="mt-3 font-display text-[18px] tracking-tight">
                $50 USDsui → 12.34 SUI
              </div>
              <div className="mt-2 font-mono text-[11px] text-[var(--color-fg-muted)]">
                conversion @ $4.055/SUI
              </div>
              <div className="mt-5 border-t border-[var(--color-line)] pt-4 text-[11px] text-[var(--color-fg-dim)]">
                from 0x12ab…ef89
                <br />
                to&nbsp;&nbsp;&nbsp;0x88cc…7700
              </div>
              <div className="mt-4 text-[11px] text-[var(--color-accent)]">
                talise.io/r/0x9c3a…2f1d ↗
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
