"use client";

import { motion } from "framer-motion";
import { useState } from "react";

export function PaymentLinkCard({
  handle,
  businessName,
}: {
  handle: string;
  businessName: string;
}) {
  const [copied, setCopied] = useState(false);
  // Local dev resolves to the live preview path; in prod this becomes the
  // talise.io payment URL. Either way it routes through /p/[handle].
  const baseUrl =
    typeof window !== "undefined" ? window.location.origin : "https://talise.io";
  const link = `${baseUrl}/p/${handle}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.05, ease: [0.2, 0.8, 0.2, 1] }}
      className="flex h-full flex-col rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-6"
    >
      <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-fg-dim)]">
        Payment link
      </div>

      <div className="mt-3 text-[13px] text-[var(--color-fg-muted)]">
        Share with customers and they pay you in USDsui, instantly.
      </div>

      <div className="mt-5 flex-1">
        <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] p-3">
          <div className="font-mono text-[12px] text-[var(--color-fg)] break-all">
            {link}
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2">
        <button
          onClick={copy}
          className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-[12px] text-[var(--color-fg)] transition hover:border-[var(--color-fg)]"
        >
          {copied ? "Copied ✓" : "Copy link"}
        </button>
        <button
          disabled
          className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2 text-[12px] text-[var(--color-fg-dim)]"
          title="Coming soon"
        >
          QR code · soon
        </button>
      </div>

      <p className="mt-3 text-[10px] uppercase tracking-wider text-[var(--color-fg-dim)]">
        Pay {businessName.toLowerCase()} · USDsui · sub-cent fee
      </p>
    </motion.div>
  );
}
