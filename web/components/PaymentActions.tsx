"use client";

import { motion } from "framer-motion";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowUpRight01FreeIcons,
  ArrowDownLeft01FreeIcons,
  QrCodeFreeIcons,
  CoinsDollarFreeIcons,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";

type Action = {
  label: string;
  sub: string;
  icon: IconSvgElement;
  href?: string;
  primary?: boolean;
  disabled?: boolean;
};

const ACTIONS: Action[] = [
  {
    label: "Send",
    sub: "Send money home — naira, cedis, shillings, rand.",
    icon: ArrowUpRight01FreeIcons,
    href: "/send",
    primary: true,
  },
  {
    label: "Receive",
    sub: "Get paid with a link or QR",
    icon: ArrowDownLeft01FreeIcons,
    href: "/receive",
  },
  {
    label: "Pay",
    sub: "Pay a business or invoice",
    icon: QrCodeFreeIcons,
    href: "/pay",
  },
  {
    label: "Earn",
    sub: "Grow your balance with yield",
    icon: CoinsDollarFreeIcons,
    href: "/earn",
  },
];

export function PaymentActions() {
  return (
    <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
      {ACTIONS.map((a, i) => (
        <motion.div
          key={a.label}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 + i * 0.05 }}
        >
          <ActionTile {...a} />
        </motion.div>
      ))}
    </div>
  );
}

function ActionTile(a: Action) {
  const base =
    "group relative flex h-full flex-col justify-between gap-5 rounded-xl border p-4 transition min-h-[124px]";

  if (a.disabled) {
    return (
      <div
        className={`${base} cursor-not-allowed border-[var(--color-line)] bg-[var(--color-surface-2)]`}
      >
        <IconBubble tone="disabled" icon={a.icon} />
        <div>
          <div className="text-[14px] font-medium text-[var(--color-fg-muted)]">
            {a.label}
          </div>
          <div className="mt-0.5 text-[11px] text-[var(--color-fg-dim)] line-clamp-2">
            {a.sub}
          </div>
          <div className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-dim)]">
            soon
          </div>
        </div>
      </div>
    );
  }

  return (
    <a
      href={a.href}
      className={`${base} ${
        a.primary
          ? "border-[#1a1a1a] bg-gradient-to-br from-[#1a1a1a] to-[#2a2620] text-white hover:from-[#2a2620] hover:to-[#1a1a1a]"
          : "border-[var(--color-line)] bg-[var(--color-surface)] hover:border-[var(--color-fg)] hover:shadow-[0_4px_24px_-12px_rgba(0,0,0,0.12)]"
      }`}
    >
      <IconBubble tone={a.primary ? "primary" : "default"} icon={a.icon} />
      <div>
        <div className="text-[14px] font-medium">{a.label}</div>
        <div
          className={`mt-0.5 text-[11px] leading-[1.45] line-clamp-2 ${
            a.primary ? "text-white/70" : "text-[var(--color-fg-muted)]"
          }`}
        >
          {a.sub}
        </div>
      </div>
    </a>
  );
}

function IconBubble({
  tone,
  icon,
}: {
  tone: "default" | "primary" | "disabled";
  icon: IconSvgElement;
}) {
  const cls =
    tone === "primary"
      ? "border-white/15 bg-white/5 text-white"
      : tone === "disabled"
        ? "border-[var(--color-line)] text-[var(--color-fg-dim)]"
        : "border-[var(--color-line)] bg-[#fafaf7] text-[var(--color-fg)]";
  return (
    <span
      className={`flex h-9 w-9 items-center justify-center rounded-full border ${cls}`}
    >
      <HugeiconsIcon
        icon={icon}
        size={16}
        strokeWidth={1.6}
        color="currentColor"
      />
    </span>
  );
}
