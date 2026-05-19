"use client";

import { motion } from "framer-motion";
import type { MarginPoolInfo } from "@/lib/deepbook";

export function EarnSection({
  marginUsdc,
  marginSui,
}: {
  marginUsdc: MarginPoolInfo | null;
  marginSui: MarginPoolInfo | null;
}) {
  const pools = [
    { sym: "USDsui", name: "Dollar", info: marginUsdc },
    { sym: "SUI", name: "Sui", info: marginSui },
  ];

  return (
    <section className="mt-12">
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] uppercase tracking-[0.2em] text-[var(--color-fg-dim)]">
          Earn · DeepBook Margin
        </h2>
        <span className="text-[11px] uppercase tracking-wider text-[var(--color-fg-dim)]">
          live · mainnet
        </span>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {pools.map((p, i) => (
          <motion.div
            key={p.sym}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: i * 0.05 }}
            className="relative overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-6"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-full font-mono text-[10px] text-white"
                  style={{
                    background:
                      "linear-gradient(135deg, var(--color-accent), var(--color-accent-soft))",
                  }}
                >
                  {p.sym.slice(0, 3)}
                </div>
                <div className="leading-tight">
                  <div className="text-[14px] font-medium text-[var(--color-fg)]">
                    Supply {p.name}
                  </div>
                  <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-dim)]">
                    {p.sym} · Margin lending
                  </div>
                </div>
              </div>
              <span className="rounded-full border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--color-fg-dim)]">
                supply · soon
              </span>
            </div>

            {p.info ? (
              <div className="mt-6 grid grid-cols-3 gap-3">
                <Stat
                  label="Supply APR"
                  value={`${(p.info.supplyApr * 100).toFixed(2)}%`}
                  accent
                />
                <Stat
                  label="Borrow APR"
                  value={`${(p.info.borrowApr * 100).toFixed(2)}%`}
                />
                <Stat
                  label="Utilization"
                  value={`${(p.info.utilization * 100).toFixed(0)}%`}
                />
              </div>
            ) : (
              <p className="mt-6 text-[13px] text-[var(--color-fg-dim)]">
                Pool data unavailable. Try again in a moment.
              </p>
            )}

            {p.info && (
              <>
                <div className="mt-5">
                  <Bar pct={p.info.utilization * 100} />
                </div>
                <div className="mt-3 flex justify-between text-[11px] text-[var(--color-fg-dim)]">
                  <span>
                    Borrowed{" "}
                    <span className="text-[var(--color-fg-muted)]">
                      {formatCompact(p.info.totalBorrow)} {p.sym}
                    </span>
                  </span>
                  <span>
                    Supplied{" "}
                    <span className="text-[var(--color-fg-muted)]">
                      {formatCompact(p.info.totalSupply)} {p.sym}
                    </span>
                  </span>
                </div>
              </>
            )}
          </motion.div>
        ))}
      </div>

      <p className="mt-3 text-[11px] text-[var(--color-fg-dim)]">
        Supply APR is approximated as borrow rate × utilization. Real-rate
        deposits arrive in the next release. &ldquo;Supply&rdquo; will let you
        deposit and start earning in one transaction.
      </p>
    </section>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--color-fg-dim)]">
        {label}
      </div>
      <div
        className={`mt-1 font-display text-[20px] tracking-[-0.02em] ${
          accent ? "text-[var(--color-accent)]" : "text-[var(--color-fg)]"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function Bar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]">
      <div
        className="h-full rounded-full bg-[var(--color-accent)]"
        style={{ width: `${clamped}%`, transition: "width 600ms ease" }}
      />
    </div>
  );
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return n.toFixed(2);
}
