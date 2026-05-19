"use client";

import { motion } from "framer-motion";
import { defaultCurrency, formatLocal } from "@/lib/fx";

export function PersonalBalanceCard({
  totalUsd,
  usdsui,
  sui,
  suiUsd,
}: {
  totalUsd: number;
  usdsui: number;
  sui: number;
  suiUsd: number;
}) {
  const currency = defaultCurrency();
  const primary = formatLocal(totalUsd, currency);
  const secondary = formatLocal(totalUsd, "USD");
  const empty = totalUsd === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
      className="overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-7 md:p-9"
    >
      <div className="grid gap-8 md:grid-cols-[1.4fr,1fr] md:gap-12">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-fg-dim)]">
            Total balance
          </div>
          <div className="mt-2 font-display text-[60px] font-medium leading-none tracking-[-0.04em] text-[var(--color-fg)] md:text-[76px]">
            {primary}
          </div>
          <div className="mt-3 text-[12px] text-[var(--color-fg-muted)]">
            ≈ {secondary}
          </div>
          {empty ? (
            <div className="mt-2 text-[13px] text-[var(--color-fg-muted)]">
              Add money to get started.
            </div>
          ) : (
            <div className="mt-2 text-[13px] text-[var(--color-fg-muted)]">
              Available to spend
            </div>
          )}
        </div>

        <div className="grid gap-3 self-center">
          <AssetRow
            name="Dollars"
            balance={formatLocal(usdsui, currency)}
            secondary={formatLocal(usdsui, "USD")}
          />
          {sui > 0 && (
            <AssetRow
              name="Gas"
              balance={`${sui.toFixed(4)} SUI`}
              secondary={formatLocal(suiUsd, "USD")}
            />
          )}
        </div>
      </div>
    </motion.div>
  );
}

function AssetRow({
  name,
  balance,
  secondary,
}: {
  name: string;
  balance: string;
  secondary: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3.5 py-2.5">
      <div className="leading-tight">
        <div className="text-[13px] text-[var(--color-fg)]">{name}</div>
        <div className="font-mono text-[10px] text-[var(--color-fg-dim)]">
          {balance}
        </div>
      </div>
      <div className="font-mono text-[12px] text-[var(--color-fg-muted)]">
        {secondary}
      </div>
    </div>
  );
}
