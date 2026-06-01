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
      transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
      className="relative overflow-hidden rounded-2xl border border-[#e8e1cf] bg-[#fafaf7] p-6 md:p-8"
    >
      {/* Subtle warm halo in the top-right — gives the card a feeling of
          depth without competing with the numbers. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-20 h-60 w-60 rounded-full bg-[#c08a3e]/10 blur-3xl"
      />

      <div className="relative grid gap-8 md:grid-cols-[1.4fr,1fr] md:gap-10">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#8a8472]">
              Total balance
            </span>
            <span className="rounded-full border border-[#e8e1cf] bg-white px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-[#5a554a]">
              {currency}
            </span>
          </div>
          <div className="mt-2.5 text-[40px] font-medium leading-[1] tracking-[-0.035em] text-[#111] md:text-[52px]">
            {primary}
          </div>
          <div className="mt-2 font-mono text-[11px] text-[#8a8472]">
            ≈ {secondary}
          </div>
          {empty ? (
            <div className="mt-2.5 text-[13px] text-[#5a554a]">
              Add money to get started.
            </div>
          ) : (
            <div className="mt-2.5 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[#5a554a]">
              <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[#21A179]" />
              Available to spend
            </div>
          )}
        </div>

        <div className="grid gap-2.5 self-center">
          <AssetRow
            mark="$"
            name="Dollars"
            balance={formatLocal(usdsui, currency)}
            secondary={formatLocal(usdsui, "USD")}
          />
          {sui > 0 && (
            <AssetRow
              mark="◇"
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
  mark,
  name,
  balance,
  secondary,
}: {
  mark: string;
  name: string;
  balance: string;
  secondary: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-[#e8e1cf] bg-white px-4 py-3">
      <div className="flex items-center gap-3 leading-tight">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#fafaf7] text-[13px] font-medium text-[#c08a3e]">
          {mark}
        </span>
        <div>
          <div className="text-[13px] font-medium text-[#111]">{name}</div>
          <div className="font-mono text-[11px] text-[#8a8472]">{balance}</div>
        </div>
      </div>
      <div className="font-mono text-[12px] text-[#5a554a]">{secondary}</div>
    </div>
  );
}
