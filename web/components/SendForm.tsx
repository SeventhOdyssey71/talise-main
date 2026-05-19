"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  signAndSubmit,
  hasEphemeralKey,
  triggerOauthSignIn,
} from "@/lib/zkclient";
import { transferIntent, type PaymentIntent } from "@/lib/intents";
import { FX, SYMBOL, localToUsdsui, formatLocal } from "@/lib/fx";
import { ErrorBox } from "@/components/ErrorBox";
import { IntentPreview } from "@/components/IntentPreview";
import { isHexAddress } from "@/lib/handle";
import { shortAddress } from "@/lib/format";

type Resolved = { address: string; displayName: string };
type ResolveState =
  | { status: "idle" }
  | { status: "resolving" }
  | { status: "ok"; resolved: Resolved }
  | { status: "miss" };

/**
 * Send money. One coin (USDsui), one signature, sponsored gas.
 *
 * The display currency (₦ NGN ↔ $ USD) toggles only the input format —
 * settlement is always USDsui on chain. Recipient also receives USDsui;
 * they see it in their own currency on the other end.
 */

type DisplayCcy = "NGN" | "USD";

export function SendForm({
  senderAddress,
  availableUsdsui,
  lockedRecipient,
  presetAmount,
  presetMemo,
  merchantLabel,
  invoiceSlug,
}: {
  senderAddress: string;
  /** USDsui balance in dollars (parity with USD). */
  availableUsdsui: number;
  lockedRecipient?: string;
  /** USDsui-denominated preset (e.g. an invoice line item). */
  presetAmount?: string;
  presetMemo?: string;
  merchantLabel?: string;
  invoiceSlug?: string;
}) {
  const [ccy, setCcy] = useState<DisplayCcy>("NGN");
  const [recipient, setRecipient] = useState(lockedRecipient ?? "");
  // The input string is in the SELECTED currency. We compute USDsui on demand.
  const [amount, setAmount] = useState<string>(() =>
    presetAmount ? formatBareLocal(Number(presetAmount), "NGN") : ""
  );
  const [memo, setMemo] = useState(presetMemo ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    digest: string;
    amountUsdsui: number;
  } | null>(null);

  // When the user toggles currency, reformat the typed amount so the displayed
  // value follows the new unit (₦162,000 ↔ $100). Keeps the intent constant.
  function switchCurrency(next: DisplayCcy) {
    if (next === ccy) return;
    const amt = Number(amount);
    if (amt > 0) {
      const usdsui = localToUsdsui(amt, ccy);
      setAmount(formatBareLocal(usdsui, next));
    }
    setCcy(next);
  }

  useEffect(() => {
    if (lockedRecipient) setRecipient(lockedRecipient);
  }, [lockedRecipient]);

  // Resolve handles and addresses through the backend. We keep the lookup
  // server-side so the username table stays private. Debounced 250ms.
  const [resolveState, setResolveState] = useState<ResolveState>(
    lockedRecipient
      ? {
          status: "ok",
          resolved: {
            address: lockedRecipient,
            displayName: shortAddress(lockedRecipient, 4, 4),
          },
        }
      : { status: "idle" }
  );
  const resolveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (lockedRecipient) return; // locked path uses the prop, never resolves
    if (resolveTimer.current) clearTimeout(resolveTimer.current);
    const q = recipient.trim();
    if (!q) {
      setResolveState({ status: "idle" });
      return;
    }
    // Skip the round-trip for obvious hex addresses — resolve locally.
    if (isHexAddress(q)) {
      setResolveState({
        status: "ok",
        resolved: { address: q, displayName: shortAddress(q, 4, 4) },
      });
      return;
    }
    setResolveState({ status: "resolving" });
    resolveTimer.current = setTimeout(async () => {
      try {
        const r = await fetch(
          `/api/recipient/resolve?q=${encodeURIComponent(q)}`,
          { cache: "no-store" }
        );
        if (r.ok) {
          const j = (await r.json()) as Resolved;
          setResolveState({ status: "ok", resolved: j });
        } else {
          setResolveState({ status: "miss" });
        }
      } catch {
        setResolveState({ status: "miss" });
      }
    }, 250);
    return () => {
      if (resolveTimer.current) clearTimeout(resolveTimer.current);
    };
  }, [recipient, lockedRecipient]);

  const resolved =
    resolveState.status === "ok" ? resolveState.resolved : null;
  const amtLocal = Number(amount);
  const amtUsdsui = amtLocal > 0 ? localToUsdsui(amtLocal, ccy) : 0;
  const validAmt = amtUsdsui > 0 && amtUsdsui <= availableUsdsui;
  const validSelf =
    !resolved ||
    resolved.address.toLowerCase() !== senderAddress.toLowerCase();
  const valid = resolved !== null && validAmt && validSelf;

  const intent: PaymentIntent | null = useMemo(() => {
    if (!resolved || !(amtUsdsui > 0)) return null;
    return transferIntent({
      asset: "USDsui",
      amount: amtUsdsui,
      recipient: resolved.address,
      senderAddress,
    });
  }, [resolved, amtUsdsui, senderAddress]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    try {
      if (!hasEphemeralKey()) {
        await triggerOauthSignIn({
          returnTo: window.location.pathname + window.location.search,
        });
        return;
      }
      if (!intent || !resolved) throw new Error("Fill in recipient and amount.");
      const { digest } = await signAndSubmit(intent.build!, { senderAddress });

      await fetch("/api/tx/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          digest,
          kind: invoiceSlug
            ? "pay-invoice"
            : lockedRecipient
              ? "pay-merchant"
              : "send",
          amount: amtUsdsui.toString(),
          asset: "USDsui",
          recipient: resolved.address,
          memo: memo || merchantLabel || null,
          invoiceSlug: invoiceSlug || null,
        }),
      }).catch(() => {});

      setSuccess({ digest, amountUsdsui: amtUsdsui });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    const net = process.env.NEXT_PUBLIC_SUI_NETWORK ?? "mainnet";
    const recipientDisplay =
      resolved?.displayName ??
      `${recipient.slice(0, 8)}…${recipient.slice(-6)}`;
    return (
      <SuccessReceipt
        amount={formatLocal(success.amountUsdsui, ccy)}
        amountUsdsui={success.amountUsdsui}
        recipient={recipientDisplay}
        memo={memo}
        digest={success.digest}
        explorerUrl={`https://suiscan.xyz/${net}/tx/${success.digest}`}
        onSendAnother={
          lockedRecipient
            ? undefined
            : () => {
                setSuccess(null);
                setAmount("");
                setRecipient("");
                setMemo("");
              }
        }
      />
    );
  }

  const spendableLocal = formatLocal(availableUsdsui, ccy);

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <CurrencyToggle ccy={ccy} onChange={switchCurrency} />

      {!lockedRecipient && (
        <Field label="Send to">
          <input
            value={recipient}
            onChange={(e) => setRecipient(e.target.value.trim())}
            placeholder="sele@talise or 0x..."
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-3 font-mono text-[13px] text-[var(--color-fg)] placeholder:text-[var(--color-fg-dim)] focus:border-[var(--color-fg)] focus:outline-none"
          />
          {recipient && resolveState.status === "resolving" && (
            <Hint subtle>resolving…</Hint>
          )}
          {recipient && resolveState.status === "miss" && (
            <Hint>No match. Try a `name@talise` handle or a 0x address.</Hint>
          )}
          {resolved && !validSelf && <Hint>That&apos;s your own account.</Hint>}
          {resolved && validSelf && (
            <div className="mt-2 inline-flex items-center gap-2 rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-[11px]">
              <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[var(--color-fg)]" />
              <span className="text-[var(--color-fg)]">
                Sending to {resolved.displayName}
              </span>
              {resolved.displayName !== shortAddress(resolved.address, 4, 4) && (
                <span className="font-mono text-[var(--color-fg-dim)]">
                  · {shortAddress(resolved.address, 4, 4)}
                </span>
              )}
            </div>
          )}
        </Field>
      )}

      {lockedRecipient && (
        <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-3">
          <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--color-fg-dim)]">
            Paying
          </div>
          <div className="mt-1 text-[14px] text-[var(--color-fg)]">{merchantLabel}</div>
          <div className="mt-0.5 font-mono text-[11px] text-[var(--color-fg-dim)] break-all">
            {lockedRecipient.slice(0, 10)}…{lockedRecipient.slice(-6)}
          </div>
        </div>
      )}

      <Field label="Amount">
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[16px] text-[var(--color-fg-muted)]">
            {SYMBOL[ccy].trim() || SYMBOL[ccy]}
          </span>
          <input
            type="number"
            step={ccy === "NGN" ? "1" : "0.01"}
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] py-3 pl-9 pr-16 text-[18px] text-[var(--color-fg)] placeholder:text-[var(--color-fg-dim)] focus:border-[var(--color-fg)] focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setAmount(formatBareLocal(availableUsdsui, ccy))}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] uppercase tracking-wider text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
          >
            max
          </button>
        </div>
        <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-2 text-[11px] text-[var(--color-fg-dim)]">
          <span>available {spendableLocal} · gas is on us</span>
          {amtUsdsui > 0 && (
            <span className="font-mono">
              ≈ ${amtUsdsui.toFixed(2)} USDsui
            </span>
          )}
        </div>
        {amount && !validAmt && (
          <Hint>
            {amtUsdsui > availableUsdsui
              ? `Only ${spendableLocal} available.`
              : "Amount must be greater than 0."}
          </Hint>
        )}
      </Field>

      <Field label="Note (optional)">
        <input
          value={memo}
          maxLength={80}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="for groceries"
          className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-3 text-[14px] text-[var(--color-fg)] placeholder:text-[var(--color-fg-dim)] focus:border-[var(--color-fg)] focus:outline-none"
        />
      </Field>

      {intent && <IntentPreview intent={intent} className="mt-1" />}

      <button
        type="submit"
        disabled={!valid || submitting}
        className="w-full rounded-md bg-[var(--color-fg)] px-5 py-3.5 text-[15px] font-medium text-[var(--color-bg)] transition hover:bg-[var(--color-accent-soft)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {submitting
          ? "Sending…"
          : valid
            ? `Send ${formatLocal(amtUsdsui, ccy)}`
            : "Fill in recipient and amount"}
      </button>

      {err && <div className="mt-3"><ErrorBox message={err} /></div>}
    </form>
  );
}

function CurrencyToggle({
  ccy,
  onChange,
}: {
  ccy: DisplayCcy;
  onChange: (c: DisplayCcy) => void;
}) {
  return (
    <div className="inline-flex rounded-full border border-[var(--color-line)] bg-[var(--color-surface-2)] p-1">
      <Pill active={ccy === "NGN"} onClick={() => onChange("NGN")} label="Naira ₦" />
      <Pill active={ccy === "USD"} onClick={() => onChange("USD")} label="USD $" />
    </div>
  );
}

function Pill({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-wider transition ${
        active
          ? "bg-[var(--color-fg)] text-[var(--color-bg)]"
          : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
      }`}
    >
      {label}
    </button>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1.5 text-[11px] uppercase tracking-[0.18em] text-[var(--color-fg-dim)]">
        {label}
      </div>
      {children}
    </label>
  );
}

/**
 * Reflect-style "Minted successfully" receipt. The slot at the top with the
 * tear line evokes a thermal-printer ticker; the body is a single column of
 * label · value pairs separated by dotted leaders. Pure black-and-white,
 * editorial typography (serif italic emphasis).
 */
function SuccessReceipt({
  amount,
  amountUsdsui,
  recipient,
  memo,
  digest,
  explorerUrl,
  onSendAnother,
}: {
  amount: string;
  amountUsdsui: number;
  recipient: string;
  memo: string;
  digest: string;
  explorerUrl: string;
  onSendAnother?: () => void;
}) {
  return (
    <div className="flex flex-col items-center">
      {/* check mark */}
      <div className="mb-5 inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--color-line)] bg-[var(--color-surface-2)]">
        <svg
          viewBox="0 0 24 24"
          aria-hidden
          className="h-4 w-4 fill-none stroke-[var(--color-fg)] stroke-[2.5]"
        >
          <path d="M5 12.5l4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="mb-6 font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-fg-muted)]">
        Sent successfully
      </div>

      {/* Receipt */}
      <div className="relative w-full max-w-lg">
        {/* Printer slot — a soft horizontal bar with a dark inside seam,
            evoking the slot the receipt prints out of. */}
        <div
          aria-hidden
          className="relative mx-auto h-3 w-[92%] rounded-t-md bg-[var(--color-surface-2)] shadow-[inset_0_-2px_3px_rgba(0,0,0,0.10)]"
        />
        <div
          aria-hidden
          className="mx-auto h-[2px] w-[92%] bg-[var(--color-fg)]/85"
        />

        {/* Receipt body */}
        <div className="relative rounded-b-md border border-[var(--color-line)] border-t-0 bg-[var(--color-surface)] px-7 pt-7 pb-7 shadow-[0_18px_40px_-20px_rgba(0,0,0,0.18)]">
          <div className="text-center">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-fg-dim)]">
              talise
            </div>
            <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-dim)]">
              Money home, in seconds
            </div>
          </div>

          <div className="mx-auto mt-6 h-px w-12 bg-[var(--color-fg)]/80" />

          <div className="mt-6 text-center">
            <div className="font-display text-[40px] leading-none tracking-[-0.025em] text-[var(--color-fg)]">
              {amount}
            </div>
            <div className="mt-1.5 font-serif text-[14px] italic text-[var(--color-fg-muted)]">
              sent · settled in one block
            </div>
            <div className="mt-1 font-mono text-[11px] text-[var(--color-fg-dim)]">
              ≈ ${amountUsdsui.toFixed(2)} USDsui
            </div>
          </div>

          <div className="mt-7 space-y-2.5 font-mono text-[11px]">
            <ReceiptRow label="To" value={recipient} />
            <ReceiptRow label="Network" value="Sui mainnet" />
            <ReceiptRow label="Settled" value="~1 sec · 1 block" />
            <ReceiptRow label="Fee you paid" value="$0.00" />
            {memo && <ReceiptRow label="Note" value={memo} />}
          </div>

          <div className="mt-6 border-t border-dashed border-[var(--color-line)] pt-4">
            <div className="text-[9px] uppercase tracking-[0.22em] text-[var(--color-fg-dim)]">
              receipt
            </div>
            <div className="mt-1 break-all font-mono text-[10px] text-[var(--color-fg-muted)]">
              {digest}
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3 text-[12px]">
            <a
              href={explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-1.5 text-[var(--color-fg)] transition hover:border-[var(--color-fg)]"
            >
              View on Suiscan ↗
            </a>
            {onSendAnother && (
              <button
                type="button"
                onClick={onSendAnother}
                className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-1.5 text-[var(--color-fg)] transition hover:border-[var(--color-fg)]"
              >
                Send another
              </button>
            )}
            <a
              href="/home"
              className="text-[var(--color-fg-muted)] underline-offset-4 hover:text-[var(--color-fg)] hover:underline"
            >
              Done
            </a>
          </div>
        </div>
      </div>

      <div className="mt-6 max-w-md text-center font-serif text-[14px] italic leading-relaxed text-[var(--color-fg-muted)]">
        Permanent. On chain. Your recipient&apos;s wallet picked it up the
        moment this block confirmed.
      </div>
    </div>
  );
}

function ReceiptRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[var(--color-fg-dim)]">{label}</span>
      <span className="mx-2 flex-1 border-b border-dotted border-[var(--color-line)]" />
      <span
        className="max-w-[60%] truncate text-right text-[var(--color-fg)]"
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

function Stat({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] p-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-dim)]">
        {label}
      </div>
      <div
        className={`mt-1 truncate text-[13px] text-[var(--color-fg)] ${
          mono ? "font-mono" : ""
        }`}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

function Hint({ children, subtle }: { children: React.ReactNode; subtle?: boolean }) {
  return (
    <div
      className={`mt-1.5 text-[11px] ${
        subtle ? "text-[var(--color-fg-dim)]" : "text-[var(--color-fg)]"
      }`}
    >
      {children}
    </div>
  );
}

/**
 * Format a USDsui amount as a bare number in the target currency, no symbol.
 * Used for the input field value when we toggle currencies.
 */
function formatBareLocal(amountUsdsui: number, currency: DisplayCcy): string {
  const local = amountUsdsui * FX[currency];
  if (currency === "USD") return local.toFixed(2);
  return Math.round(local).toString();
}
