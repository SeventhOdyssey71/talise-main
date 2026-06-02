"use client";

/**
 * One-time opt-in disclosure shown before the user's FIRST supply. Regulatory
 * + framing hygiene: make it unmistakable that Earn is a SEPARATE, opt-in
 * lending service routed through a third-party DeFi protocol (NAVI) — not a
 * property of the Talise balance — and that returns vary and aren't
 * guaranteed. The supply only runs after the user taps "I understand". We
 * never auto-supply.
 */

import { HugeiconsIcon } from "@hugeicons/react";
import {
  BankIcon,
  Wallet02Icon,
  ChartIncreaseIcon,
} from "@hugeicons/core-free-icons";
import { Sheet, PrimaryButton } from "@/components/app";

type Point = { icon: typeof BankIcon; title: string; body: string };

const POINTS: Point[] = [
  {
    icon: BankIcon,
    title: "A separate lending service",
    body: "Earn is optional and runs through a third-party lending protocol. It's not a banking or savings product offered by Talise.",
  },
  {
    icon: Wallet02Icon,
    title: "Not part of your balance",
    body: "Money you put into Earn moves into the lending service, separate from your spendable balance. You choose what to add — nothing moves automatically.",
  },
  {
    icon: ChartIncreaseIcon,
    title: "Returns aren't guaranteed",
    body: "Rates vary and can change. Earnings are not guaranteed, and your money is not insured or protected against loss.",
  },
];

export function EarnDisclosureSheet({
  open,
  apy,
  moneyWord,
  onAccept,
  onClose,
}: {
  open: boolean;
  apy: number;
  moneyWord: string;
  onAccept: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Before you start" size="md">
      <div className="space-y-5 pb-1">
        <div className="space-y-1.5">
          <h2 className="text-[22px] font-medium tracking-[-0.02em] text-fg">
            {apy > 0
              ? `Earn around ${(apy * 100).toFixed(2)}% on your ${moneyWord}`
              : `Earn on your ${moneyWord}`}
          </h2>
          <p className="text-[13px] text-fg-muted">A few things to know first.</p>
        </div>

        <div className="talise-glass overflow-hidden" style={{ borderRadius: 18 }}>
          {POINTS.map((p, i) => (
            <div key={p.title}>
              {i > 0 && <div className="mx-4 h-px bg-line" />}
              <div className="flex items-start gap-3.5 px-4 py-4">
                <span
                  className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full text-accent"
                  style={{
                    background: "color-mix(in srgb, var(--color-accent) 12%, transparent)",
                  }}
                >
                  <HugeiconsIcon icon={p.icon} size={18} strokeWidth={1.8} />
                </span>
                <div className="min-w-0">
                  <p className="text-[15px] font-medium tracking-[-0.01em] text-fg">
                    {p.title}
                  </p>
                  <p className="mt-1 text-[13px] leading-snug text-fg-muted">{p.body}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <p className="text-[12px] leading-snug text-fg-dim">
          By continuing you&apos;re choosing to use this optional service. You can
          withdraw your money at any time. This is not financial advice.
        </p>

        <div className="space-y-2.5 pt-1">
          <PrimaryButton full onClick={onAccept}>
            I understand — continue
          </PrimaryButton>
          <PrimaryButton full variant="ghost" onClick={onClose}>
            Not now
          </PrimaryButton>
        </div>
      </div>
    </Sheet>
  );
}
