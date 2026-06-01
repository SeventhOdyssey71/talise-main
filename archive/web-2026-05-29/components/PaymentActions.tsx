"use client";

import { motion } from "framer-motion";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  MoneySendFreeIcons,
  MoneyReceiveFreeIcons,
  QrCodeFreeIcons,
  CoinsDollarFreeIcons,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";

type Action = {
  label: string;
  icon: IconSvgElement;
  href?: string;
  primary?: boolean;
  disabled?: boolean;
};

const ACTIONS: Action[] = [
  { label: "Send", icon: MoneySendFreeIcons, href: "/send", primary: true },
  { label: "Receive", icon: MoneyReceiveFreeIcons, href: "/receive" },
  { label: "Pay", icon: QrCodeFreeIcons, href: "/pay" },
  { label: "Earn", icon: CoinsDollarFreeIcons, href: "/earn" },
];

/**
 * Compact action row. Four tiles with just an icon + label — the verbs
 * are self-explanatory, so the previous one-line descriptions were
 * doing more harm than good (they crowded the layout and forced
 * smaller balance numbers above).
 */
export function PaymentActions() {
  return (
    <div className="grid grid-cols-4 gap-2.5 md:gap-3">
      {ACTIONS.map((a, i) => (
        <motion.div
          key={a.label}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.08 + i * 0.04 }}
        >
          <ActionTile {...a} />
        </motion.div>
      ))}
    </div>
  );
}

function ActionTile(a: Action) {
  const base =
    "group flex h-full items-center justify-center gap-2.5 rounded-2xl border px-3 py-3.5 text-[13px] font-medium transition";

  if (a.disabled) {
    return (
      <div
        className={`${base} cursor-not-allowed border-[var(--color-line)] bg-[var(--color-surface-2)] text-[var(--color-fg-dim)]`}
      >
        <HugeiconsIcon
          icon={a.icon}
          size={16}
          strokeWidth={1.6}
          color="currentColor"
        />
        {a.label}
      </div>
    );
  }

  return (
    <a
      href={a.href}
      className={`${base} ${
        a.primary
          ? "border-[#1a1a1a] bg-gradient-to-br from-[#1a1a1a] to-[#2a2620] text-white hover:from-[#2a2620] hover:to-[#1a1a1a]"
          : "border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-fg)] hover:border-[var(--color-fg)] hover:shadow-[0_4px_24px_-16px_rgba(0,0,0,0.12)]"
      }`}
    >
      <HugeiconsIcon
        icon={a.icon}
        size={16}
        strokeWidth={1.6}
        color="currentColor"
      />
      {a.label}
    </a>
  );
}
