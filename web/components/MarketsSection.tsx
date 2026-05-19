"use client";

import { motion } from "framer-motion";
import type { MarketRow } from "@/lib/deepbook";

export function MarketsSection({ markets }: { markets: MarketRow[] }) {
  return (
    <section className="mt-12">
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] uppercase tracking-[0.2em] text-[var(--color-fg-dim)]">
          Markets · DeepBook spot
        </h2>
        <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-[var(--color-fg-dim)]">
          <span className="inline-flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-1.5 w-1.5 animate-ping rounded-full bg-[var(--color-accent)] opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
          </span>
          live · mainnet
        </span>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)]">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[var(--color-line)] bg-[var(--color-surface-2)] text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-dim)]">
              <th className="px-5 py-2.5 text-left font-normal">Pair</th>
              <th className="px-5 py-2.5 text-right font-normal">Price</th>
              <th className="hidden px-5 py-2.5 text-right font-normal sm:table-cell">
                Quote
              </th>
              <th className="px-5 py-2.5 text-right font-normal">Status</th>
            </tr>
          </thead>
          <tbody>
            {markets.map((m, i) => (
              <motion.tr
                key={m.pair}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3, delay: i * 0.04 }}
                className={`border-t border-[var(--color-line)] transition hover:bg-[var(--color-surface-2)] ${
                  i === 0 ? "border-t-0" : ""
                }`}
              >
                <td className="px-5 py-3.5">
                  <div className="flex items-center gap-3">
                    <PairGlyph base={m.base} />
                    <div>
                      <div className="text-[var(--color-fg)]">{m.pair}</div>
                      <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-dim)]">
                        {m.base} → {m.quote}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-5 py-3.5 text-right font-mono text-[var(--color-fg)]">
                  {m.price > 0 ? formatPrice(m.price, m.quote) : "—"}
                </td>
                <td className="hidden px-5 py-3.5 text-right font-mono text-[var(--color-fg-muted)] sm:table-cell">
                  {m.quote}
                </td>
                <td className="px-5 py-3.5 text-right">
                  {m.price > 0 ? (
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--color-fg-muted)]">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#21A179]" />
                      live
                    </span>
                  ) : (
                    <span className="text-[11px] text-[var(--color-fg-dim)]">
                      illiquid
                    </span>
                  )}
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[11px] text-[var(--color-fg-dim)]">
        Prices from on-chain DeepBook V3 mid-quote simulation. Swap routing across
        these pools lands when the signing layer ships.
      </p>
    </section>
  );
}

function PairGlyph({ base }: { base: string }) {
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-fg)] font-mono text-[9px] text-[var(--color-bg)]">
      {base.slice(0, 3)}
    </div>
  );
}

function formatPrice(p: number, quote: string): string {
  if (quote === "USDC" || quote === "AUSD") {
    if (p < 0.01) return `$${p.toPrecision(3)}`;
    if (p < 1) return `$${p.toFixed(4)}`;
    if (p < 100) return `$${p.toFixed(3)}`;
    return `$${p.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  }
  if (p < 1) return p.toFixed(6);
  return p.toFixed(4);
}
