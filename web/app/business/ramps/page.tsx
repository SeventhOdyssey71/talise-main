"use client";

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { BankIcon, CreditCardIcon } from "@hugeicons/core-free-icons";
import { GlassCard, Eyebrow, StatusPill, PrimaryButton } from "@/components/app";
import { WithdrawToBankSheet } from "@/components/app/ramps/WithdrawToBankSheet";

/** /business/ramps — cash out USDsui to a bank (live), add money (soon). */
export default function BusinessRampsPage() {
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 pb-8">
      <header className="space-y-2 pt-1">
        <Eyebrow>Cash flow</Eyebrow>
        <h1 className="text-[26px] font-medium leading-tight tracking-[-0.03em] text-fg">
          Move money between USDsui and your bank
        </h1>
        <p className="text-[15px] leading-relaxed text-fg-muted">
          Cash out your balance to a Nigerian bank account at the live rate, paid
          out instantly via Paga.
        </p>
      </header>

      {/* Cash out — LIVE */}
      <GlassCard className="space-y-5 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              className="flex size-12 shrink-0 items-center justify-center rounded-2xl text-accent"
              style={{ background: "var(--color-accent-soft)" }}
            >
              <HugeiconsIcon icon={BankIcon} size={22} strokeWidth={1.8} />
            </span>
            <div>
              <Eyebrow>Cash out</Eyebrow>
              <h2 className="mt-1 text-[18px] font-medium tracking-[-0.02em] text-fg">
                Withdraw to your bank
              </h2>
            </div>
          </div>
          <StatusPill label="Live" tone="success" />
        </div>
        <p className="text-[14px] leading-relaxed text-fg-muted">
          USDsui → NGN, paid straight to your bank account. Quote the rate before
          you confirm — no padded spreads.
        </p>
        <PrimaryButton full onClick={() => setWithdrawOpen(true)}>
          Cash out to your bank
        </PrimaryButton>
      </GlassCard>

      {/* Add money — SOON */}
      <GlassCard className="space-y-4 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl text-fg-muted bg-surface-2">
              <HugeiconsIcon icon={CreditCardIcon} size={22} strokeWidth={1.8} />
            </span>
            <div>
              <Eyebrow>Add money</Eyebrow>
              <h2 className="mt-1 text-[18px] font-medium tracking-[-0.02em] text-fg">
                Top up with a card or bank
              </h2>
            </div>
          </div>
          <StatusPill label="Soon" tone="pending" />
        </div>
        <p className="text-[14px] leading-relaxed text-fg-muted">
          Fund your account from a card or bank transfer — landing soon. For now,
          get paid by clients via invoices and payment links.
        </p>
      </GlassCard>

      <WithdrawToBankSheet open={withdrawOpen} onClose={() => setWithdrawOpen(false)} />
    </div>
  );
}
