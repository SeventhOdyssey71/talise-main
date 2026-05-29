"use client";

import { useState } from "react";
import { ErrorBox } from "@/components/ErrorBox";

export function InvoiceForm({ handle }: { handle: string }) {
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [created, setCreated] = useState<{
    slug: string;
    amount: string;
    reference: string | null;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const amt = Number(amount);
  const valid = amt > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    try {
      const r = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: amt,
          reference: reference || null,
          customerEmail: customerEmail || null,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "failed");
      setCreated({
        slug: j.invoice.slug,
        amount: j.invoice.amount_usdc,
        reference: j.invoice.reference,
      });
      setAmount("");
      setReference("");
      setCustomerEmail("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const link = created
    ? `${typeof window !== "undefined" ? window.location.origin : "https://talise.io"}/p/${handle}?amount=${created.amount}&invoice=${created.slug}${created.reference ? `&memo=${encodeURIComponent(created.reference)}` : ""}`
    : "";

  return (
    <div>
      <form onSubmit={submit} className="space-y-4 rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-6">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-fg-dim)]">
          New invoice
        </div>

        <Field label="Amount (USDsui)">
          <input
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="125.00"
            autoFocus
            className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-3 text-[16px] text-[var(--color-fg)] placeholder:text-[var(--color-fg-dim)] focus:border-[var(--color-fg)] focus:outline-none"
          />
        </Field>

        <Field label="Reference / memo">
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="May retainer · Invoice #042"
            maxLength={80}
            className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2.5 text-[14px] text-[var(--color-fg)] placeholder:text-[var(--color-fg-dim)] focus:border-[var(--color-fg)] focus:outline-none"
          />
        </Field>

        <Field label="Customer email (optional)">
          <input
            type="email"
            value={customerEmail}
            onChange={(e) => setCustomerEmail(e.target.value)}
            placeholder="them@company.com"
            className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2.5 text-[14px] text-[var(--color-fg)] placeholder:text-[var(--color-fg-dim)] focus:border-[var(--color-fg)] focus:outline-none"
          />
          <p className="mt-1 text-[11px] text-[var(--color-fg-dim)]">
            Stored for your records. We don&apos;t send email automatically yet.
          </p>
        </Field>

        <button
          type="submit"
          disabled={!valid || submitting}
          className="w-full rounded-md bg-[var(--color-fg)] px-5 py-3 text-[14px] font-medium text-[var(--color-bg)] transition hover:bg-[var(--color-accent-soft)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? "Creating…" : "Create invoice"}
        </button>

        {err && <div className="mt-3"><ErrorBox message={err} /></div>}
      </form>

      {created && (
        <div className="mt-6 rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface-2)] p-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-fg-dim)]">
            Invoice link
          </div>
          <div className="mt-3 break-all rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] p-3 font-mono text-[12px] text-[var(--color-fg)]">
            {link}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(link).catch(() => {});
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[12px] text-[var(--color-fg)] transition hover:border-[var(--color-fg)]"
            >
              {copied ? "Copied ✓" : "Copy link"}
            </button>
            <a
              href={`/p/${handle}?amount=${created.amount}&invoice=${created.slug}${created.reference ? `&memo=${encodeURIComponent(created.reference)}` : ""}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[12px] text-[var(--color-fg-muted)] transition hover:border-[var(--color-fg)] hover:text-[var(--color-fg)]"
            >
              Preview ↗
            </a>
            <a
              href={`mailto:${customerEmail || ""}?subject=Invoice%20%E2%80%94%20${encodeURIComponent(created.reference ?? "")}&body=${encodeURIComponent(`Hi. please pay ${created.amount} USDsui at: ${link}`)}`}
              className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[12px] text-[var(--color-fg-muted)] transition hover:border-[var(--color-fg)] hover:text-[var(--color-fg)]"
            >
              Email customer ↗
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 text-[11px] uppercase tracking-[0.16em] text-[var(--color-fg-dim)]">
        {label}
      </div>
      {children}
    </label>
  );
}
