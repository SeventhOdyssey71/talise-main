"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { EarnSupplyForm } from "./EarnSupplyForm";
import { SpotLPForm } from "./SpotLPForm";

type Strategy = "spot" | "margin";

export function EarnStrategyPicker({
  initial,
  senderAddress,
  availableUsdsui,
  availableSui,
  marginSupplyApr,
  marginUtilization,
  existingBmId,
}: {
  initial: Strategy;
  senderAddress: string;
  availableUsdsui: number;
  availableSui: number;
  marginSupplyApr: number;
  marginUtilization: number;
  existingBmId: string | null;
}) {
  const [strategy, setStrategy] = useState<Strategy>(initial);

  return (
    <div>
      <div className="grid gap-4 md:grid-cols-2">
        <StrategyCard
          tag="DeepBook Spot"
          label="Maker liquidity"
          highlight="up to 8–15% est."
          headline="Provide liquidity as a market maker."
          body="Your USDsui sits in a non-custodial BalanceManager and is available to anchor maker orders on the SUI/USDsui pool. Earn fee yield + DEEP rewards when your orders fill."
          riskTag="variable · active"
          active={strategy === "spot"}
          onClick={() => setStrategy("spot")}
        />
        <StrategyCard
          tag="DeepBook Margin"
          label="Lending pool"
          highlight={`${(marginSupplyApr * 100).toFixed(2)}% live APR`}
          headline="Lend to leveraged traders."
          body="Your USDsui is borrowed by DeepBook margin traders and you earn a share of the interest. Lower risk, passive. Yield scales with pool utilization."
          riskTag={`${(marginUtilization * 100).toFixed(0)}% utilization · passive`}
          active={strategy === "margin"}
          onClick={() => setStrategy("margin")}
        />
      </div>

      <div className="mt-10">
        <AnimatePresence mode="wait">
          {strategy === "spot" ? (
            <motion.div
              key="spot"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
            >
              <SpotLPForm
                senderAddress={senderAddress}
                availableUsdsui={availableUsdsui}
                availableSui={availableSui}
                existingBmId={existingBmId}
              />
            </motion.div>
          ) : (
            <motion.div
              key="margin"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
            >
              <EarnSupplyForm
                senderAddress={senderAddress}
                availableUsdsui={availableUsdsui}
                availableSui={availableSui}
                supplyApr={marginSupplyApr}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function StrategyCard({
  tag,
  label,
  highlight,
  headline,
  body,
  riskTag,
  active,
  onClick,
}: {
  tag: string;
  label: string;
  highlight: string;
  headline: string;
  body: string;
  riskTag: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ y: -3 }}
      transition={{ duration: 0.2 }}
      className={`relative h-full rounded-2xl border p-6 text-left transition ${
        active
          ? "border-[var(--color-fg)] bg-[var(--color-fg)] text-[var(--color-bg)]"
          : "border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-fg)] hover:border-[var(--color-fg)]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div
            className={`text-[10px] uppercase tracking-[0.22em] ${
              active ? "text-[var(--color-bg)]/60" : "text-[var(--color-fg-dim)]"
            }`}
          >
            {tag}
          </div>
          <div
            className={`mt-1 text-[12px] ${
              active ? "text-[var(--color-bg)]/80" : "text-[var(--color-fg-muted)]"
            }`}
          >
            {label}
          </div>
        </div>
        <span
          className={`rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wider ${
            active
              ? "border-[var(--color-bg)]/30 text-[var(--color-bg)]"
              : "border-[var(--color-line)] text-[var(--color-fg-muted)]"
          }`}
        >
          {highlight}
        </span>
      </div>

      <div className="mt-5 font-display text-[22px] leading-[1.15] tracking-[-0.02em]">
        {headline}
      </div>
      <p
        className={`mt-3 text-[13px] leading-relaxed ${
          active ? "text-[var(--color-bg)]/75" : "text-[var(--color-fg-muted)]"
        }`}
      >
        {body}
      </p>

      <div
        className={`mt-5 text-[10px] uppercase tracking-[0.18em] ${
          active ? "text-[var(--color-bg)]/60" : "text-[var(--color-fg-dim)]"
        }`}
      >
        {riskTag}
      </div>
    </motion.button>
  );
}
