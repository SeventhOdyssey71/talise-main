"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CheckmarkCircle02Icon,
  Cancel01Icon,
  ArrowRight02Icon,
  Copy01Icon,
} from "@hugeicons/core-free-icons";
import { GlassCard, PrimaryButton, StatusPill, Eyebrow, MicroLabel } from "@/components/app";
import { Diamond } from "@/components/Diamond";
import type { WorkInvoiceLineItem } from "@/lib/invoices";

type PublicInvoice = {
  id: string;
  amountUsd: number;
  currency: string;
  customerName: string | null;
  lineItems: WorkInvoiceLineItem[];
  memo: string | null;
  status: "open" | "paid" | "void";
  dueMs: number | null;
  createdAt: number;
  payDigest?: string | null;
  paidAt?: number | null;
};

type Issuer = { handle: string; address: string; name: string | null };

export type InvoicePayViewProps = {
  invoice: PublicInvoice;
  issuer: Issuer;
  origin: string;
};

/**
 * The public invoice page body. Renders the invoice like a real bill — issuer,
 * line items, totals — then a single "Pay this invoice" CTA that deep-links
 * into /app/pay with the amount + recipient prefilled. Standalone (no AppShell
 * / CurrencyProvider) so it formats its own currency locally.
 */
export function InvoicePayView({ invoice, issuer, origin }: InvoicePayViewProps) {
  const [copied, setCopied] = useState(false);

  // The invoice is stored in USD (USDsui); display it in its denominated
  // currency by applying the live FX rate. This page is public (no
  // CurrencyProvider), so it fetches the open /api/fx feed itself.
  const [rate, setRate] = useState(1);
  useEffect(() => {
    if (invoice.currency === "USD") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/fx");
        if (!res.ok) return;
        const data = (await res.json()) as { rates?: Record<string, number> };
        const r = data?.rates?.[invoice.currency];
        if (!cancelled && typeof r === "number" && r > 0) setRate(r);
      } catch {
        /* keep 1:1 — better than a broken figure */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [invoice.currency]);

  const fmt = useMemo(() => {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: invoice.currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    } catch {
      return new Intl.NumberFormat(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }
  }, [invoice.currency]);

  // `money` takes a USD figure and renders it in the invoice's currency.
  const money = (usd: number) => fmt.format(usd * rate);

  // The pay link carries the USD amount (SendFlow re-displays it in the payer's
  // currency); keep full precision so sub-dollar invoices don't round away.
  const payHref = `/app/pay?to=${encodeURIComponent(issuer.address)}&amount=${encodeURIComponent(
    invoice.amountUsd.toFixed(6)
  )}&invoice=${encodeURIComponent(invoice.id)}`;

  const statusTone =
    invoice.status === "paid" ? "completed" : invoice.status === "void" ? "danger" : "pending";
  const statusLabel =
    invoice.status === "paid" ? "Paid" : invoice.status === "void" ? "Voided" : "Awaiting payment";

  const createdLabel = new Date(invoice.createdAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const dueLabel =
    invoice.dueMs != null
      ? new Date(invoice.dueMs).toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : null;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${origin}/i/${invoice.id}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — silently ignore */
    }
  };

  return (
    <main className="landing-mint talise-appshell relative min-h-dvh overflow-hidden bg-bg px-5 py-10 text-fg sm:py-16">
      {/* Background glow lives in its own absolutely-positioned layer — putting
          talise-top-glow on <main> applied its filter: blur() to the whole page. */}
      <div className="talise-top-glow" aria-hidden />
      <div className="relative z-10 mx-auto w-full max-w-xl">
        {/* Brand row */}
        <div className="mb-7 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-fg">
            <Diamond />
            <span className="font-display text-[18px] font-semibold lowercase tracking-[-0.02em]">talise</span>
          </Link>
          <StatusPill label={statusLabel} tone={statusTone} />
        </div>

        <GlassCard className="overflow-hidden p-0">
          {/* Header */}
          <div className="border-b border-line px-6 pb-6 pt-6">
            <Eyebrow>Invoice from</Eyebrow>
            <h1 className="mt-1.5 text-[22px] font-semibold tracking-tight text-fg">
              {issuer.name || issuer.handle}
            </h1>
            <p className="mt-0.5 font-mono text-[12px] text-fg-dim">{issuer.handle}</p>

            <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <MicroLabel>Amount due</MicroLabel>
                <div
                  className="mt-1 text-[40px] font-semibold leading-none text-fg"
                  style={{ letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" }}
                >
                  {money(invoice.amountUsd)}
                </div>
                {invoice.currency !== "USD" && (
                  <p className="mt-1.5 font-mono text-[11px] text-fg-dim">
                    Settles as {invoice.amountUsd.toFixed(2)} USDsui · 1:1 USD
                  </p>
                )}
              </div>
              <div className="text-right text-[12px] text-fg-dim">
                <p>Issued {createdLabel}</p>
                {dueLabel && <p className="mt-0.5">Due {dueLabel}</p>}
              </div>
            </div>
          </div>

          {/* Bill-to + line items */}
          <div className="px-6 py-5">
            {invoice.customerName && (
              <div className="mb-4">
                <MicroLabel>Billed to</MicroLabel>
                <p className="mt-1 text-[15px] text-fg">{invoice.customerName}</p>
              </div>
            )}

            {invoice.lineItems.length > 0 ? (
              <div className="overflow-hidden rounded-xl border border-line">
                <table className="w-full text-left text-[14px]">
                  <thead>
                    <tr className="border-b border-line bg-[var(--color-surface-2)]">
                      <th className="px-4 py-2.5 font-mono text-[10px] font-medium uppercase tracking-wider text-fg-dim">
                        Description
                      </th>
                      <th className="px-3 py-2.5 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-fg-dim">
                        Qty
                      </th>
                      <th className="px-3 py-2.5 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-fg-dim">
                        Unit
                      </th>
                      <th className="px-4 py-2.5 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-fg-dim">
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.lineItems.map((li, i) => (
                      <tr key={i} className="border-b border-line last:border-0">
                        <td className="px-4 py-3 text-fg">{li.description}</td>
                        <td
                          className="px-3 py-3 text-right text-fg-muted"
                          style={{ fontVariantNumeric: "tabular-nums" }}
                        >
                          {li.qty}
                        </td>
                        <td
                          className="px-3 py-3 text-right text-fg-muted"
                          style={{ fontVariantNumeric: "tabular-nums" }}
                        >
                          {money(li.unitUsd)}
                        </td>
                        <td
                          className="px-4 py-3 text-right font-medium text-fg"
                          style={{ fontVariantNumeric: "tabular-nums" }}
                        >
                          {money(Math.round(li.qty * li.unitUsd * 100) / 100)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              invoice.memo && (
                <div className="rounded-xl border border-line px-4 py-3.5">
                  <MicroLabel>For</MicroLabel>
                  <p className="mt-1 text-[14px] text-fg">{invoice.memo}</p>
                </div>
              )
            )}

            {invoice.lineItems.length > 0 && (
              <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
                <span className="text-[14px] font-medium text-fg-muted">Total</span>
                <span
                  className="text-[18px] font-semibold text-fg"
                  style={{ fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em" }}
                >
                  {money(invoice.amountUsd)}
                </span>
              </div>
            )}

            {invoice.lineItems.length > 0 && invoice.memo && (
              <p className="mt-3 text-[13px] text-fg-dim">{invoice.memo}</p>
            )}
          </div>

          {/* Pay CTA */}
          <div className="border-t border-line px-6 py-5">
            {invoice.status === "open" ? (
              <>
                <PrimaryButton href={payHref} full>
                  <HugeiconsIcon icon={ArrowRight02Icon} size={18} strokeWidth={2} />
                  Pay this invoice
                </PrimaryButton>
                <p className="mt-3 text-center text-[12px] text-fg-dim">
                  Sign in with Google to pay — no gas, no wallet setup. Money moves as USDsui.
                </p>
              </>
            ) : invoice.status === "paid" ? (
              <div className="space-y-3">
                <div className="flex items-center justify-center gap-2 rounded-xl bg-[var(--color-accent-soft)] py-3 text-[14px] text-accent">
                  <HugeiconsIcon icon={CheckmarkCircle02Icon} size={18} strokeWidth={2} />
                  Paid
                  {invoice.paidAt
                    ? ` · ${new Date(invoice.paidAt).toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}`
                    : ""}
                  . Thank you.
                </div>
                {invoice.payDigest && (
                  <div className="rounded-xl border border-line px-4 py-3">
                    <MicroLabel>On-chain receipt</MicroLabel>
                    <a
                      href={`https://suiscan.xyz/mainnet/tx/${invoice.payDigest}`}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="mt-1 block break-all font-mono text-[12px] text-accent underline-offset-2 hover:underline"
                    >
                      {invoice.payDigest}
                    </a>
                    <p className="mt-1 text-[11px] text-fg-dim">
                      Settled on Sui — verify this payment on-chain.
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 rounded-full bg-[var(--color-surface-2)] py-3 text-[14px] text-fg-dim">
                <HugeiconsIcon icon={Cancel01Icon} size={18} strokeWidth={2} />
                This invoice was voided by the issuer.
              </div>
            )}
          </div>
        </GlassCard>

        {/* Share / footer */}
        <div className="mt-5 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={copyLink}
            className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[12px] text-fg-dim transition-colors hover:text-fg"
          >
            <HugeiconsIcon icon={Copy01Icon} size={14} strokeWidth={2} />
            {copied ? "Link copied" : "Copy invoice link"}
          </button>
        </div>
        <p className="mt-6 text-center text-[12px] text-fg-dim">
          Powered by{" "}
          <Link href="/" className="text-fg-muted underline-offset-2 hover:underline">
            Talise
          </Link>{" "}
          — money that moves like a message.
        </p>
      </div>
    </main>
  );
}
