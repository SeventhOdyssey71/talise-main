"use client";

import { motion } from "framer-motion";

type Action = {
  label: string;
  sub: string;
  icon: React.ReactNode;
  href?: string;
  primary?: boolean;
  disabled?: boolean;
};

const ACTIONS: Action[] = [
  {
    label: "Send",
    sub: "Send money home — naira, cedis, shillings, rand.",
    icon: <ArrowUpRight />,
    href: "/send",
    primary: true,
  },
  {
    label: "Receive",
    sub: "Get paid with a link or QR",
    icon: <ArrowDownLeft />,
    href: "/receive",
  },
  {
    label: "Pay",
    sub: "Pay a business or invoice",
    icon: <Scan />,
    href: "/pay",
  },
  {
    label: "Earn",
    sub: "Grow your balance with yield",
    icon: <Spark />,
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
    "group relative flex h-full flex-col justify-between gap-5 rounded-xl border p-4 transition min-h-[120px]";

  if (a.disabled) {
    return (
      <div
        className={`${base} cursor-not-allowed border-[var(--color-line)] bg-[var(--color-surface-2)]`}
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--color-line)] text-[var(--color-fg-dim)]">
          {a.icon}
        </span>
        <div>
          <div className="text-[14px] font-medium text-[var(--color-fg-muted)]">{a.label}</div>
          <div className="mt-0.5 text-[11px] text-[var(--color-fg-dim)] line-clamp-2">
            {a.sub}
          </div>
          <div className="mt-1.5 text-[10px] uppercase tracking-wider text-[var(--color-fg-dim)]">
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
          ? "border-[var(--color-fg)] bg-[var(--color-fg)] text-[var(--color-bg)] hover:bg-[var(--color-accent-soft)]"
          : "border-[var(--color-line)] bg-[var(--color-surface)] hover:border-[var(--color-fg)]"
      }`}
    >
      <span
        className={`flex h-8 w-8 items-center justify-center rounded-full border ${
          a.primary
            ? "border-[var(--color-bg)]/30 text-[var(--color-bg)]"
            : "border-[var(--color-line)] text-[var(--color-fg)]"
        }`}
      >
        {a.icon}
      </span>
      <div>
        <div className="text-[14px] font-medium">{a.label}</div>
        <div
          className={`mt-0.5 text-[11px] line-clamp-2 ${
            a.primary ? "text-[var(--color-bg)]/70" : "text-[var(--color-fg-muted)]"
          }`}
        >
          {a.sub}
        </div>
      </div>
    </a>
  );
}

function ArrowUpRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 17L17 7M9 7h8v8" />
    </svg>
  );
}
function ArrowDownLeft() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 7L7 17M15 17H7V9" />
    </svg>
  );
}
function Scan() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10" />
    </svg>
  );
}
function Spark() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
    </svg>
  );
}
