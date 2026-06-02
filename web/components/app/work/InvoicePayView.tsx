"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Invoice01Icon,
  CheckmarkCircle02Icon,
  Cancel01Icon,
  ArrowRight02Icon,
  Copy01Icon,
} from "@hugeicons/core-free-icons";
import { GlassCard, PrimaryButton, StatusPill, Eyebrow, MicroLabel } from "@/components/app";
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

  const fmt = useMemo(() => {
    // Display the invoice in its denominated currency. USDsui is 1:1 USD, so
    // for non-USD invoices the figure is the same number with the local symbol
    // (the issuer chose the denomination as a label — no FX is applied to the
    // canonical USD settle amount).
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

  const money = (n: number) => fmt.format(n);

  const payHref = `/app/pay?to=${encodeURIComponent(issuer.address)}&amount=${encodeURIComponent(
    invoice.amountUsd.toFixed(2)
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
    <main className="talise-top-glow min-h-dvh bg-bg px-5 py-10 text-fg sm:py-16">
      <div className="mx-auto w-full max-w-xl">
        {/* Brand row */}
        <div className="mb-7 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-fg">
            <span
              className="flex size-8 items-center justify-center rounded-xl text-accent"
              style={{ background: "color-mix(in srgb, var(--color-accent) 14%, transparent)" }}
            >
              <HugeiconsIcon icon={Invoice01Icon} size={18} strokeWidth={1.8} />
            </span>
            <span className="text-[17px] font-semibold tracking-tight">Talise</span>
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
              <div className="overflow-hidden rounded-2xl border border-line">
                <table className="w-full text-left text-[14px]">
                  <thead>
                    <tr className="border-b border-line bg-white/[0.02]">
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
                <div className="rounded-2xl border border-line px-4 py-3.5">
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
              <div className="flex items-center justify-center gap-2 rounded-full bg-white/[0.03] py-3 text-[14px] text-accent">
                <HugeiconsIcon icon={CheckmarkCircle02Icon} size={18} strokeWidth={2} />
                This invoice has been paid. Thank you.
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 rounded-full bg-white/[0.03] py-3 text-[14px] text-fg-dim">
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
