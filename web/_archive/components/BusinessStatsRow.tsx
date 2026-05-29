"use client";

import { motion } from "framer-motion";

export function BusinessStatsRow({
  todayCount,
  customers,
  avgTicket,
}: {
  todayCount: number;
  customers: number;
  avgTicket: number;
}) {
  const items = [
    {
      label: "Payments today",
      value: todayCount.toString(),
      sub: todayCount === 0 ? "no activity" : `last in: just now`,
    },
    {
      label: "Unique customers",
      value: customers.toLocaleString(),
      sub: customers === 0 ? "none yet" : "all-time",
    },
    {
      label: "Avg. ticket",
      value: avgTicket === 0 ? "—" : `$${avgTicket.toFixed(2)}`,
      sub: avgTicket === 0 ? "no data" : "last 30 days",
    },
    {
      label: "Settlement",
      value: "~1s",
      sub: "fee < $0.01",
    },
  ];

  return (
    <div className="mt-5 grid gap-px overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-line)] sm:grid-cols-2 md:grid-cols-4">
      {items.map((it, i) => (
        <motion.div
          key={it.label}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: i * 0.04 }}
          className="bg-[var(--color-surface)] p-5"
        >
          <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--color-fg-dim)]">
            {it.label}
          </div>
          <div className="mt-2 font-display text-[26px] leading-none tracking-[-0.02em] text-[var(--color-fg)]">
            {it.value}
          </div>
          <div className="mt-2 text-[11px] text-[var(--color-fg-muted)]">{it.sub}</div>
        </motion.div>
      ))}
    </div>
  );
}
