"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import QRCode from "qrcode";

/**
 * Standalone QR card. Renders the QR + a short caption underneath. Made
 * to sit side-by-side with the UsernameCard on /receive, so the user sees
 * "scan me" and "share me" at a glance without scrolling.
 */
export function ReceiveQR({
  address,
  displayName,
  handle,
}: {
  address: string;
  displayName: string;
  handle: string | null;
}) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const baseUrl =
    typeof window !== "undefined" ? window.location.origin : "https://talise.io";
  const handleUrl = handle ? `${baseUrl}/p/${handle}` : null;
  const qrValue = handleUrl ?? `sui:${address}`;

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(qrValue, {
      margin: 1,
      width: 280,
      color: { dark: "#0a0a0a", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [qrValue]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
      className="flex h-full flex-col items-center rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-6 text-center"
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-fg-dim)]">
        Scan to pay
      </div>
      <div className="mt-4 flex aspect-square w-full max-w-[280px] flex-1 items-center justify-center rounded-xl border border-[var(--color-line)] bg-white">
        {qrDataUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={qrDataUrl}
            alt="QR code"
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="text-[12px] text-[var(--color-fg-dim)]">
            generating…
          </div>
        )}
      </div>
      <div className="mt-4 text-[13px] text-[var(--color-fg)]">
        {displayName}
      </div>
      {handle && (
        <div className="mt-1 font-mono text-[11px] text-[var(--color-fg-muted)]">
          talise.io/p/{handle}
        </div>
      )}
    </motion.div>
  );
}

/**
 * Share controls: payment-link panel (when there's a handle) + raw
 * Sui-address panel. Sits full-width under the hero row.
 */
export function ReceiveShare({
  address,
  suiscanUrl,
  handle,
}: {
  address: string;
  suiscanUrl: string;
  handle: string | null;
}) {
  const [copied, setCopied] = useState<"address" | "link" | null>(null);

  const baseUrl =
    typeof window !== "undefined" ? window.location.origin : "https://talise.io";
  const handleUrl = handle ? `${baseUrl}/p/${handle}` : null;

  async function copy(text: string, kind: "address" | "link") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1500);
    } catch {}
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.05, ease: [0.2, 0.8, 0.2, 1] }}
      className={`grid gap-4 ${handleUrl ? "md:grid-cols-2" : ""}`}
    >
      {handleUrl && (
        <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-fg-dim)]">
            Payment link
          </div>
          <div className="mt-3 rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] p-3 font-mono text-[13px] text-[var(--color-fg)] break-all">
            {handleUrl}
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => copy(handleUrl, "link")}
              className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-[12px] text-[var(--color-fg)] transition hover:border-[var(--color-fg)]"
            >
              {copied === "link" ? "Copied ✓" : "Copy link"}
            </button>
            <a
              href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(
                `Send me money on Talise →`
              )}&url=${encodeURIComponent(handleUrl)}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-[12px] text-[var(--color-fg)] transition hover:border-[var(--color-fg)]"
            >
              Share on X ↗
            </a>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-fg-dim)]">
          Sui address
        </div>
        <div
          className="mt-3 rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] p-3 font-mono text-[13px] text-[var(--color-fg)]"
          title={address}
        >
          {`${address.slice(0, 10)}…${address.slice(-6)}`}
        </div>
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => copy(address, "address")}
            className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-[12px] text-[var(--color-fg)] transition hover:border-[var(--color-fg)]"
          >
            {copied === "address" ? "Copied ✓" : "Copy address"}
          </button>
          <a
            href={suiscanUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-[12px] text-[var(--color-fg-muted)] transition hover:border-[var(--color-fg)] hover:text-[var(--color-fg)]"
          >
            Suiscan ↗
          </a>
        </div>
      </div>
    </motion.div>
  );
}

/**
 * Back-compat wrapper. Existing pages calling <ReceiveCard/> still get the
 * stacked QR-on-left + share-on-right layout via the two sub-components.
 * /receive itself uses ReceiveQR + ReceiveShare directly so it can pair
 * the QR with the UsernameCard side by side.
 */
export function ReceiveCard(props: {
  address: string;
  suiscanUrl: string;
  displayName: string;
  handle: string | null;
}) {
  return (
    <div className="grid gap-6 md:grid-cols-[1fr,1.4fr]">
      <ReceiveQR
        address={props.address}
        displayName={props.displayName}
        handle={props.handle}
      />
      <ReceiveShare
        address={props.address}
        suiscanUrl={props.suiscanUrl}
        handle={props.handle}
      />
    </div>
  );
}
