"use client";

import { motion } from "framer-motion";

type Action = {
  href?: string;
  label: string;
  icon: React.ReactNode;
  primary?: boolean;
  disabled?: boolean;
};

const ACTIONS: Action[] = [
  {
    label: "Send",
    href: "/send",
    primary: true,
    icon: <ArrowUpRight />,
  },
  {
    label: "Receive",
    icon: <ArrowDownLeft />,
    disabled: true,
  },
  {
    label: "Earn",
    icon: <SparkIcon />,
    disabled: true,
  },
];

export function QuickActions() {
  return (
    <div className="grid grid-cols-3 gap-3">
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
    "group relative flex h-full flex-col items-start justify-between gap-6 rounded-xl border p-4 transition";

  if (a.disabled) {
    return (
      <div
        className={`${base} cursor-not-allowed border-[var(--color-line)] bg-[var(--color-surface)]/40`}
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--color-line)] text-[var(--color-fg-dim)]">
          {a.icon}
        </span>
        <div>
          <div className="text-[14px] text-[var(--color-fg-muted)]">{a.label}</div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--color-fg-dim)]">
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
          ? "border-[var(--color-accent)] bg-[var(--color-fg)] text-[var(--color-bg)] hover:bg-[var(--color-accent-soft)]"
          : "border-[var(--color-line)] bg-[var(--color-surface)] hover:border-[var(--color-accent)]"
      }`}
    >
      <span
        className={`flex h-8 w-8 items-center justify-center rounded-full border ${
          a.primary
            ? "border-[var(--color-bg)]/20 bg-[var(--color-bg)]/10 text-[var(--color-bg)]"
            : "border-[var(--color-line)] text-[var(--color-fg)]"
        }`}
      >
        {a.icon}
      </span>
      <div className="text-[14px] font-medium">{a.label}</div>
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
function SparkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
    </svg>
  );
}
