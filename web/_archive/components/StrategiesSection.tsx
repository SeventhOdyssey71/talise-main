"use client";

import { motion } from "framer-motion";
import type { MarginPoolInfo } from "@/lib/deepbook";

/**
 * Three pre-built yield strategies, each a blend of DeepBook primitives.
 * APRs are computed from live margin pool data we receive as props.
 */
export function StrategiesSection({
  marginUsdc,
  marginSui,
}: {
  marginUsdc: MarginPoolInfo | null;
  marginSui: MarginPoolInfo | null;
}) {
  const usdcSupplyApr = marginUsdc?.supplyApr ?? 0;
  const suiSupplyApr = marginSui?.supplyApr ?? 0;
  // Spot-LP placeholders. replace with real LP fee yield once we read pool fees.
  const spotLpEstApr = 0.087; // 8.7%

  const strategies = [
    {
      tier: "Conservative",
      tagline: "Just earn, no exposure",
      apr: usdcSupplyApr,
      mix: [
        { label: "USDsui → Margin lending", weight: 100 },
      ],
      risk: "Lowest",
    },
    {
      tier: "Balanced",
      tagline: "Yield with a SUI slice",
      apr: usdcSupplyApr * 0.7 + suiSupplyApr * 0.3,
      mix: [
        { label: "USDsui → Margin lending", weight: 70 },
        { label: "SUI → Margin lending", weight: 30 },
      ],
      risk: "Medium",
    },
    {
      tier: "Aggressive",
      tagline: "Fee yield + market exposure",
      apr: usdcSupplyApr * 0.4 + spotLpEstApr * 0.6,
      mix: [
        { label: "USDsui → Margin lending", weight: 40 },
        { label: "USDsui/SUI spot LP", weight: 60 },
      ],
      risk: "Higher",
    },
  ];

  return (
    <section className="mt-12">
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] uppercase tracking-[0.2em] text-[var(--color-fg-dim)]">
          Strategies · DeepBook
        </h2>
        <span className="text-[11px] uppercase tracking-wider text-[var(--color-fg-dim)]">
          three tiers · soon
        </span>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {strategies.map((s, i) => (
          <motion.div
            key={s.tier}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: i * 0.05 }}
            className="group relative overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-6 transition hover:border-[var(--color-fg)]"
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="font-display text-[18px] tracking-tight text-[var(--color-fg)]">
                  {s.tier}
                </div>
                <div className="mt-0.5 text-[11px] text-[var(--color-fg-muted)]">
                  {s.tagline}
                </div>
              </div>
              <span className="rounded-full border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--color-fg-dim)]">
                {s.risk}
              </span>
            </div>

            <div className="mt-6">
              <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--color-fg-dim)]">
                Est. APR
              </div>
              <div className="mt-1 font-display text-[36px] leading-none tracking-[-0.02em] text-[var(--color-fg)]">
                {(s.apr * 100).toFixed(2)}%
              </div>
            </div>

            <div className="mt-6 space-y-2.5">
              {s.mix.map((m) => (
                <div key={m.label}>
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-[var(--color-fg-muted)]">{m.label}</span>
                    <span className="font-mono text-[var(--color-fg)]">{m.weight}%</span>
                  </div>
                  <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                    <div
                      className="h-full rounded-full bg-[var(--color-fg)]"
                      style={{ width: `${m.weight}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 border-t border-[var(--color-line)] pt-4">
              <button
                disabled
                className="inline-flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2 text-[12px] text-[var(--color-fg-muted)]"
              >
                Deploy strategy · soon
              </button>
            </div>
          </motion.div>
        ))}
      </div>

      <p className="mt-3 text-[11px] text-[var(--color-fg-dim)]">
        APRs computed from live DeepBook margin-pool data. &ldquo;Deploy&rdquo; will
        run the underlying PTBs (supply, swap, supply-LP) in one signed transaction.
      </p>
    </section>
  );
}
