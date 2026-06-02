"use client";

/**
 * Receive sheet — shows the user's wallet QR (encoded as `sui:<address>`) plus
 * the @handle / short address and a copy-to-clipboard control. Opened by the
 * "Receive" and "Scan/QR" quick actions on Home. Pure display: no money moves.
 */

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { Sheet, QrImage, useToast, type Me } from "@/components/app";

export function ReceiveSheet({
  open,
  onClose,
  me,
}: {
  open: boolean;
  onClose: () => void;
  me: Me | null;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const address = me?.suiAddress ?? "";
  const qrValue = address ? `sui:${address}` : "sui:";
  const short = address ? `${address.slice(0, 8)}…${address.slice(-6)}` : "—";

  async function copyAddress() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      toast("Address copied", "success");
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast("Couldn't copy address", "danger");
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Receive" size="sm">
      <div className="flex flex-col items-center pb-2 text-center">
        <p className="max-w-[18rem] text-[14px] leading-relaxed text-fg-muted">
          {me?.taliseHandle ? (
            <>
              Friends can send you USDsui at{" "}
              <span className="font-medium text-fg">@{me.taliseHandle}</span> — or scan this code.
            </>
          ) : (
            "Show this code or share your address to get paid in USDsui. $0.00 fee, lands instantly."
          )}
        </p>

        <div className="mt-5">
          <QrImage value={qrValue} size={208} />
        </div>

        <button
          type="button"
          onClick={copyAddress}
          disabled={!address}
          className="talise-glass mt-5 inline-flex max-w-full items-center gap-2.5 rounded-full px-4 py-2.5 transition-colors hover:border-white/15 active:scale-[0.98] disabled:opacity-50"
        >
          <span className="truncate font-mono text-[12px] text-fg-muted">{short}</span>
          <HugeiconsIcon
            icon={copied ? Tick02Icon : Copy01Icon}
            size={16}
            strokeWidth={2}
            color={copied ? "var(--color-accent)" : undefined}
            className={copied ? "" : "text-fg-dim"}
          />
        </button>

        <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-fg-dim">
          USDsui on Sui · $0.00 fee
        </p>
      </div>
    </Sheet>
  );
}
