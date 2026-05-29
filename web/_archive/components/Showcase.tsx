"use client";

import { motion } from "framer-motion";
import { Reveal } from "./Reveal";
import { SignInButton } from "./SignInButton";

export function Showcase() {
  return (
    <section
      id="showcase"
      className="relative w-full overflow-hidden border-y border-[var(--color-line)] bg-[var(--color-surface-2)] py-24 md:py-32"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(900px circle at 50% 0%, rgba(0,0,0,0.05), transparent 60%)",
        }}
      />

      <div className="relative mx-auto max-w-7xl px-6 md:px-8">
        <div className="grid items-center gap-14 md:grid-cols-[1fr,1.1fr]">
          <Reveal>
            <div>
              <div className="text-[12px] uppercase tracking-[0.22em] text-[var(--color-accent)]">
                The product
              </div>
              <h2 className="mt-4 font-display text-[44px] leading-[1.04] tracking-[-0.025em] md:text-[64px]">
                One account.
                <br />
                Many assets.
                <br />
                <em className="not-italic text-[var(--color-fg-muted)]">
                  All earning.
                </em>
              </h2>
              <p className="mt-6 max-w-md text-[16px] leading-[1.6] text-[var(--color-fg-muted)] md:text-[17px]">
                Hold USDsui for stability and SUI for utility. Receive payments
                with a link or QR. Send to anyone. Supply idle balance to
                DeepBook to earn yield. Every action settles in under a second
                on Sui mainnet.
              </p>
              <div id="open-account" className="mt-8 flex flex-wrap items-center gap-4">
                <SignInButton variant="full" label="Open an account" />
                <a
                  href="#how"
                  className="text-[13px] text-[var(--color-fg-muted)] underline-offset-4 hover:text-[var(--color-fg)] hover:underline"
                >
                  Read how it works
                </a>
              </div>
            </div>
          </Reveal>

          <Reveal delay={0.1}>
            <motion.div
              initial={{ rotate: -1 }}
              whileHover={{ y: -4, rotate: 0 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            >
              <ProductPreview />
            </motion.div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function ProductPreview() {
  return (
    <div className="relative">
      <div
        aria-hidden
        className="absolute inset-x-12 -bottom-6 h-12 rounded-full bg-black/15 blur-2xl"
      />
      <div className="relative overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-7 shadow-[0_30px_70px_-25px_rgba(0,0,0,0.22)]">
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-display tracking-tight text-[var(--color-fg)]">
            talise
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--color-fg-dim)]">
            <span className="h-1 w-1 rounded-full bg-[#21A179]" />
            mainnet
          </span>
        </div>

        <div className="mt-8">
          <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-dim)]">
            Total balance
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-display text-[14px] text-[var(--color-fg-muted)]">
              $
            </span>
            <span className="font-display text-[52px] leading-none tracking-[-0.025em] text-[var(--color-fg)]">
              1,247
            </span>
            <span className="font-display text-[24px] leading-none text-[var(--color-fg-muted)]">
              .50
            </span>
          </div>
          <div className="mt-3 flex items-center gap-2 text-[12px]">
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[var(--color-live)]" />
            <span className="text-[var(--color-fg)]">+ $0.18 today</span>
            <span className="text-[var(--color-fg-dim)]">·</span>
            <span className="text-[var(--color-fg-muted)]">earning at 6.4%</span>
          </div>
        </div>

        <div className="mt-8 space-y-2">
          {[
            { sym: "USDsui", name: "Dollar", bal: "640.10", usd: "640.10" },
            { sym: "SUI", name: "Sui", bal: "120.4521", usd: "607.46" },
          ].map((a) => (
            <div
              key={a.sym}
              className="flex items-center justify-between rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3.5 py-3"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-fg)] font-mono text-[10px] text-[var(--color-bg)]">
                  {a.sym.slice(0, 3)}
                </div>
                <div className="leading-tight">
                  <div className="text-[13px] text-[var(--color-fg)]">{a.name}</div>
                  <div className="font-mono text-[10px] text-[var(--color-fg-dim)]">
                    {a.bal} {a.sym}
                  </div>
                </div>
              </div>
              <div className="text-[13px] text-[var(--color-fg)]">${a.usd}</div>
            </div>
          ))}
        </div>

        <div className="mt-6 grid grid-cols-4 gap-2">
          {["Send", "Receive", "Pay", "Earn"].map((label) => (
            <div
              key={label}
              className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] py-2 text-center text-[11px] text-[var(--color-fg)]"
            >
              {label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
