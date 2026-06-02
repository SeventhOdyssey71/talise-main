"use client";

/**
 * RequestPanel — the Receive / Request experience for /app/pay/request.
 *
 * Two modes selected by a glass segmented control:
 *
 *   Receive  →  a plain receive QR encoding `sui:<address>` + copy address.
 *               External Sui wallets understand this format too.
 *   Request  →  enter an amount (+ optional memo) and we build a shareable
 *               PAYMENT LINK to `<origin>/pay/<handle>?amount=&memo=` with a QR,
 *               copy, and native share. Falls back to the address when the user
 *               hasn't claimed a Talise handle yet.
 *
 * Mirrors the iOS ReceiveView: handle-first identity, USD-denominated request
 * amount, white-panel QR.
 */

import { useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Copy01Icon,
  Tick02Icon,
  Share08Icon,
  QrCode01Icon,
  Wallet01Icon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons";
import {
  GlassCard,
  Eyebrow,
  MicroLabel,
  QrImage,
  Field,
  PrimaryButton,
  useMe,
  useToast,
  useCurrency,
} from "@/components/app";

type Mode = "receive" | "request";

function shortAddr(a: string): string {
  if (!a || a.length <= 16) return a;
  return `${a.slice(0, 10)}…${a.slice(-8)}`;
}

export function RequestPanel() {
  const { me, loading } = useMe();
  const { toast } = useToast();
  const { symbol, toLocal } = useCurrency();

  const [mode, setMode] = useState<Mode>("receive");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [copied, setCopied] = useState<"addr" | "link" | null>(null);

  const address = me?.suiAddress ?? "";
  const handle = me?.taliseHandle ?? null;

  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://www.talise.io";

  // Parsed request amount in USD (USDsui is 1:1 USD). The field is entered in
  // USD to match the on-chain settlement currency and the public pay link.
  const amountUsd = useMemo(() => {
    const v = parseFloat(amount);
    return Number.isFinite(v) && v > 0 ? v : null;
  }, [amount]);

  // The shareable payment link. Handle-first so the payer sees the @handle;
  // we fall back to the raw address path when no handle is claimed.
  const paymentLink = useMemo(() => {
    const slug = handle ?? address;
    if (!slug) return "";
    const url = new URL(`${origin}/pay/${encodeURIComponent(slug)}`);
    if (amountUsd != null) url.searchParams.set("amount", amountUsd.toFixed(2));
    if (memo.trim()) url.searchParams.set("memo", memo.trim());
    return url.toString();
  }, [handle, address, origin, amountUsd, memo]);

  // What the QR encodes per mode.
  const qrValue = mode === "receive" ? (address ? `sui:${address}` : "") : paymentLink;

  const copy = async (text: string, which: "addr" | "link") => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      toast(which === "addr" ? "Address copied" : "Payment link copied", "success");
      setTimeout(() => setCopied(null), 1600);
    } catch {
      toast("Couldn't copy — try selecting manually", "danger");
    }
  };

  const share = async () => {
    const text = mode === "receive" ? address : paymentLink;
    if (!text) return;
    // Web Share API where available (mobile); otherwise fall back to copy.
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: "Pay me on Talise",
          text: mode === "request" && amountUsd != null
            ? `Pay ${symbol}${amountUsd.toFixed(2)} on Talise`
            : "Pay me on Talise",
          url: mode === "receive" ? undefined : paymentLink,
        });
        return;
      } catch {
        /* user cancelled or unsupported — fall through to copy */
      }
    }
    await copy(text, mode === "receive" ? "addr" : "link");
  };

  const identity = handle ? `@${handle}` : address ? shortAddr(address) : "your wallet";

  return (
    <div className="mx-auto w-full max-w-md">
      {/* Heading */}
      <div className="mb-6">
        <Eyebrow>Receive</Eyebrow>
        <h1
          className="mt-1.5 font-display text-[28px] font-semibold text-fg"
          style={{ letterSpacing: "-0.03em" }}
        >
          Get paid
        </h1>
      </div>

      {/* Mode segmented control */}
      <div className="talise-glass mb-6 flex gap-1 rounded-full p-1">
        <SegButton active={mode === "receive"} onClick={() => setMode("receive")} icon={QrCode01Icon}>
          Receive
        </SegButton>
        <SegButton active={mode === "request"} onClick={() => setMode("request")} icon={Wallet01Icon}>
          Request
        </SegButton>
      </div>

      {/* Request inputs */}
      {mode === "request" && (
        <div className="mb-6 space-y-4">
          <Field label="Amount (optional)" hint="Leave blank for an open request.">
            <div className="talise-glass flex items-center gap-2 rounded-2xl px-4 py-3">
              <span className="font-display text-[18px] text-fg-muted">$</span>
              <input
                value={amount}
                onChange={(e) => {
                  const v = e.target.value;
                  if (/^\d*\.?\d{0,2}$/.test(v)) setAmount(v);
                }}
                inputMode="decimal"
                placeholder="0.00"
                className="w-full bg-transparent text-[18px] tabular-nums text-fg outline-none placeholder:text-fg-dim"
              />
              {amount && (
                <button
                  type="button"
                  onClick={() => setAmount("")}
                  aria-label="Clear amount"
                  className="flex size-6 items-center justify-center rounded-full text-fg-dim hover:text-fg"
                >
                  <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={2} />
                </button>
              )}
            </div>
          </Field>

          <Field label="Memo (optional)">
            <div className="talise-glass rounded-2xl px-4 py-3">
              <input
                value={memo}
                onChange={(e) => setMemo(e.target.value.slice(0, 80))}
                placeholder="What's it for?"
                className="w-full bg-transparent text-[15px] text-fg outline-none placeholder:text-fg-dim"
              />
            </div>
          </Field>
        </div>
      )}

      {/* QR card */}
      <GlassCard radius={26} className="flex flex-col items-center px-6 py-8 text-center">
        <span
          className="font-display text-[18px] font-semibold text-fg"
          style={{ letterSpacing: "-0.02em" }}
        >
          {loading ? "—" : identity}
        </span>

        {mode === "request" && amountUsd != null && (
          <span className="mt-1.5 font-display text-[15px] font-medium text-accent">
            Requesting {symbol}
            {toLocal(amountUsd).toLocaleString("en-US", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
        )}
        {mode === "request" && memo.trim() && (
          <span className="mt-1 max-w-[16rem] truncate text-[13px] text-fg-dim">
            &ldquo;{memo.trim()}&rdquo;
          </span>
        )}

        <div className="mt-6">
          {qrValue ? (
            <QrImage value={qrValue} size={216} />
          ) : (
            <div className="size-[240px] animate-pulse rounded-[20px] bg-surface-2" />
          )}
        </div>

        <MicroLabel className="mt-5 block max-w-full truncate">{shortAddr(address)}</MicroLabel>
      </GlassCard>

      {/* Actions */}
      <div className="mt-5 flex gap-2.5">
        <button
          type="button"
          onClick={() =>
            mode === "receive" ? copy(address, "addr") : copy(paymentLink, "link")
          }
          className="talise-glass inline-flex flex-1 items-center justify-center gap-2 rounded-full px-5 py-3 text-[14px] font-medium text-fg transition-colors hover:border-[color-mix(in_srgb,var(--color-accent-deep)_40%,var(--color-line))]"
        >
          <HugeiconsIcon
            icon={copied ? Tick02Icon : Copy01Icon}
            size={16}
            strokeWidth={2}
            color={copied ? "var(--color-accent)" : undefined}
          />
          {copied
            ? "Copied"
            : mode === "receive"
              ? "Copy address"
              : "Copy link"}
        </button>
        <div className="flex-1">
          <PrimaryButton full onClick={share}>
            <HugeiconsIcon icon={Share08Icon} size={15} strokeWidth={2} color="#fff" />
            {mode === "receive" ? "Share" : "Share request"}
          </PrimaryButton>
        </div>
      </div>

      {!handle && mode === "request" && (
        <p className="mt-4 text-center text-[12px] text-fg-dim">
          Claim a Talise handle in Settings for a cleaner link like{" "}
          <span className="text-fg-muted">talise.io/pay/you</span>.
        </p>
      )}
    </div>
  );
}

// ── Segmented control button ────────────────────────────────────────────────────

function SegButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: Parameters<typeof HugeiconsIcon>[0]["icon"];
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex flex-1 items-center justify-center gap-2 rounded-full py-2 text-[13px] font-medium transition-colors ${
        active ? "bg-accent-soft text-accent" : "text-fg-dim hover:text-fg-muted"
      }`}
    >
      <HugeiconsIcon
        icon={icon}
        size={16}
        strokeWidth={1.9}
        color={active ? "var(--color-accent)" : undefined}
      />
      {children}
    </button>
  );
}

export default RequestPanel;
