"use client";

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { Sheet, PrimaryButton } from "@/components/app";

/**
 * Concierge cash-out sheet (closed-alpha off-ramp).
 *
 * Captures a payout request — amount + Nigerian bank coordinates — and posts it
 * to /api/offramp/request, which records it for manual fulfilment and pings the
 * team. The automated Paga flow (WithdrawToBankSheet) replaces this once it's
 * live. Deliberately simple: amount, bank, account, name → "request received".
 */

// Inline so this client component never pulls server-only paga code. bankCode
// is the 3-digit NIBSS code; the server resolves it via resolveBank().
const BANKS: { code: string; name: string }[] = [
  { code: "044", name: "Access Bank" },
  { code: "023", name: "Citibank" },
  { code: "050", name: "Ecobank" },
  { code: "070", name: "Fidelity Bank" },
  { code: "011", name: "First Bank of Nigeria" },
  { code: "214", name: "First City Monument Bank" },
  { code: "058", name: "Guaranty Trust Bank" },
  { code: "221", name: "Stanbic IBTC Bank" },
  { code: "232", name: "Sterling Bank" },
  { code: "033", name: "United Bank For Africa" },
  { code: "035", name: "Wema Bank" },
  { code: "057", name: "Zenith Bank" },
];

const inputCls =
  "w-full rounded-xl border border-line bg-surface px-3.5 py-3 text-[15px] text-fg outline-none transition-colors focus:border-[color-mix(in_srgb,var(--color-accent-deep)_45%,var(--color-line))]";

export function RequestCashoutSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [bankCode, setBankCode] = useState("");
  const [acct, setAcct] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const amt = parseFloat(amount);
  const valid =
    Number.isFinite(amt) && amt > 0 && !!bankCode && /^\d{6,12}$/.test(acct);

  function close() {
    onClose();
    // reset after the close animation so a reopen is fresh
    setTimeout(() => {
      setAmount("");
      setBankCode("");
      setAcct("");
      setName("");
      setDone(null);
      setErr(null);
      setBusy(false);
    }, 200);
  }

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/offramp/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amountUsdsui: amt,
          bankCode,
          accountNumber: acct,
          accountName: name.trim() || undefined,
        }),
      });
      const data = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) setErr(data.error || "Could not submit your request.");
      else setDone(data.message || "Cash-out request received.");
    } catch {
      setErr("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={close} title="Cash out">
      {done ? (
        <div className="flex flex-col items-center py-4 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-accent-soft text-accent">
            <HugeiconsIcon icon={CheckmarkCircle02Icon} size={30} strokeWidth={2} />
          </span>
          <p className="mt-4 text-[15px] leading-relaxed text-fg">{done}</p>
          <div className="mt-6 w-full">
            <PrimaryButton full onClick={close}>
              Done
            </PrimaryButton>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-fg-muted">
              Amount (USDsui)
            </label>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="0.00"
              className={inputCls}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-fg-muted">
              Bank
            </label>
            <select
              value={bankCode}
              onChange={(e) => setBankCode(e.target.value)}
              className={inputCls}
            >
              <option value="">Select your bank</option>
              {BANKS.map((b) => (
                <option key={b.code} value={b.code}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-fg-muted">
              Account number
            </label>
            <input
              inputMode="numeric"
              value={acct}
              onChange={(e) => setAcct(e.target.value.replace(/\D/g, "").slice(0, 12))}
              placeholder="0123456789"
              className={inputCls}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-fg-muted">
              Account name <span className="text-fg-dim">(optional)</span>
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="As it appears on your account"
              className={inputCls}
            />
          </div>

          {err && <p className="text-[13px] text-[var(--color-danger)]">{err}</p>}

          <PrimaryButton full onClick={submit} loading={busy} disabled={!valid}>
            Request cash-out
          </PrimaryButton>

          <p className="text-[12px] leading-relaxed text-fg-dim">
            During the beta, cash-outs are processed by hand within a few hours,
            at the live rate. We&apos;ll confirm once your naira is on the way.
          </p>
        </div>
      )}
    </Sheet>
  );
}
