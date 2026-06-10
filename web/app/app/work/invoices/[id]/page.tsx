"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft02Icon,
  Copy01Icon,
  CheckmarkCircle02Icon,
  Cancel01Icon,
  LinkSquare02Icon,
} from "@hugeicons/core-free-icons";
import {
  GlassCard,
  PrimaryButton,
  StatusPill,
  Sheet,
  Eyebrow,
  MicroLabel,
  Spinner,
  EmptyState,
  api,
  ApiError,
  useToast,
  useCurrency,
} from "@/components/app";

type LineItem = { description: string; qty: number; unitUsd: number };

type OwnerInvoice = {
  id: string;
  amountUsd: number;
  currency: string;
  customerName: string | null;
  customerEmail: string | null;
  lineItems: LineItem[];
  memo: string | null;
  status: "open" | "paid" | "void";
  dueMs: number | null;
  createdAt: number;
  paidAt: number | null;
  payDigest: string | null;
  paidByAddress: string | null;
};

const ORIGIN = typeof window !== "undefined" ? window.location.origin : "";

/** SuiVision tx explorer link for an on-chain receipt digest. */
const suiVisionTx = (digest: string) =>
  `https://suivision.xyz/txblock/${digest}`;

const shortAddr = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`;

/**
 * /app/work/invoices/[id] — the OWNER's detail view of one of their invoices.
 * Renders the full bill (issuer's line items, totals, memo) in the same feel as
 * the public InvoicePayView, plus owner-only affordances: the payer address +
 * on-chain digest (SuiVision link) once paid, a copy-pay-link action, and void.
 */
export default function InvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const router = useRouter();
  const { toast } = useToast();
  const { formatUsd } = useCurrency();

  const [invoice, setInvoice] = useState<OwnerInvoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voiding, setVoiding] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const r = await api<{ invoice: OwnerInvoice; owner: boolean }>(
        `/api/invoices/${id}`
      );
      if (!r.owner) {
        // A non-owner gets the public projection (no payer/digest). Send them
        // to the public pay page instead of rendering a half-empty owner view.
        router.replace(`/i/${id}`);
        return;
      }
      setInvoice(r.invoice);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setNotFound(true);
      } else {
        toast(err instanceof ApiError ? err.message : "Couldn't load invoice", "danger");
      }
    } finally {
      setLoading(false);
    }
  }, [id, router, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const copyLink = async () => {
    if (!id) return;
    try {
      await navigator.clipboard.writeText(`${ORIGIN}/i/${id}`);
      toast("Pay link copied", "success");
    } catch {
      toast("Couldn't copy link", "danger");
    }
  };

  const doVoid = async () => {
    if (!id) return;
    setVoiding(true);
    try {
      await api(`/api/invoices/${id}`, { method: "POST", body: { action: "void" } });
      toast("Invoice voided", "neutral");
      setVoidOpen(false);
      await load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't void invoice", "danger");
    } finally {
      setVoiding(false);
    }
  };

  const dates = useMemo(() => {
    if (!invoice) return { created: "", due: null as string | null, paid: null as string | null };
    const fmt = (ms: number) =>
      new Date(ms).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    return {
      created: fmt(invoice.createdAt),
      due: invoice.dueMs != null ? fmt(invoice.dueMs) : null,
      paid: invoice.paidAt != null ? fmt(invoice.paidAt) : null,
    };
  }, [invoice]);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner size={24} />
      </div>
    );
  }

  if (notFound || !invoice) {
    return (
      <div className="space-y-4">
        <BackLink onClick={() => router.push("/app/work")} />
        <GlassCard className="p-2">
          <EmptyState
            title="Invoice not found"
            subtitle="This invoice doesn't exist or you don't have access to it."
            action={
              <PrimaryButton onClick={() => router.push("/app/work")} variant="ghost">
                Back to invoices
              </PrimaryButton>
            }
          />
        </GlassCard>
      </div>
    );
  }

  const statusTone =
    invoice.status === "paid" ? "completed" : invoice.status === "void" ? "danger" : "pending";
  const statusLabel =
    invoice.status === "paid" ? "Paid" : invoice.status === "void" ? "Voided" : "Awaiting payment";

  return (
    <div className="mx-auto w-full max-w-xl space-y-4">
      <div className="flex items-center justify-between">
        <BackLink onClick={() => router.push("/app/work")} />
        <StatusPill label={statusLabel} tone={statusTone} />
      </div>

      <GlassCard className="overflow-hidden p-0">
        {/* Header — amount */}
        <div className="border-b border-line px-6 pb-5 pt-5">
          <Eyebrow>Invoice</Eyebrow>
          <p className="mt-1.5 font-mono text-[12px] text-fg-dim">{invoice.id}</p>

          <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <MicroLabel>Amount</MicroLabel>
              <div
                className="mt-1 text-[38px] font-semibold leading-none text-fg"
                style={{ letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" }}
              >
                {formatUsd(invoice.amountUsd, { fixed: true })}
              </div>
              {invoice.currency !== "USD" && (
                <p className="mt-1.5 font-mono text-[11px] text-fg-dim">
                  Denominated in {invoice.currency} · settles 1:1 as USDsui
                </p>
              )}
            </div>
            <div className="text-right text-[12px] text-fg-dim">
              <p>Issued {dates.created}</p>
              {dates.due && <p className="mt-0.5">Due {dates.due}</p>}
              {dates.paid && <p className="mt-0.5">Paid {dates.paid}</p>}
            </div>
          </div>
        </div>

        {/* Bill-to + line items */}
        <div className="px-6 py-5">
          {(invoice.customerName || invoice.customerEmail) && (
            <div className="mb-4">
              <MicroLabel>Billed to</MicroLabel>
              {invoice.customerName && (
                <p className="mt-1 text-[15px] text-fg">{invoice.customerName}</p>
              )}
              {invoice.customerEmail && (
                <p className="mt-0.5 text-[13px] text-fg-dim">{invoice.customerEmail}</p>
              )}
            </div>
          )}

          {invoice.lineItems.length > 0 ? (
            <div className="overflow-hidden rounded-xl border border-line">
              <table className="w-full text-left text-[14px]">
                <thead>
                  <tr className="border-b border-line bg-surface-2">
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
                        {formatUsd(li.unitUsd)}
                      </td>
                      <td
                        className="px-4 py-3 text-right font-medium text-fg"
                        style={{ fontVariantNumeric: "tabular-nums" }}
                      >
                        {formatUsd(Math.round(li.qty * li.unitUsd * 100) / 100)}
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
                {formatUsd(invoice.amountUsd, { fixed: true })}
              </span>
            </div>
          )}

          {invoice.lineItems.length > 0 && invoice.memo && (
            <p className="mt-3 text-[13px] text-fg-dim">{invoice.memo}</p>
          )}
        </div>

        {/* Status / on-chain receipt block */}
        <div className="border-t border-line px-6 py-5">
          {invoice.status === "paid" ? (
            <div className="space-y-3">
              <div className="flex items-center justify-center gap-2 rounded-xl bg-accent-soft py-3 text-[14px] text-accent">
                <HugeiconsIcon icon={CheckmarkCircle02Icon} size={18} strokeWidth={2} />
                Paid{dates.paid ? ` · ${dates.paid}` : ""}
              </div>
              {invoice.paidByAddress && (
                <div className="rounded-xl border border-line px-4 py-3.5">
                  <MicroLabel>Paid by</MicroLabel>
                  <p className="mt-1.5 break-all font-mono text-[12px] text-fg">
                    {shortAddr(invoice.paidByAddress)}
                  </p>
                </div>
              )}
              {invoice.payDigest && (
                <div className="rounded-xl border border-line px-4 py-3.5">
                  <MicroLabel>On-chain receipt</MicroLabel>
                  <a
                    href={suiVisionTx(invoice.payDigest)}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mt-1.5 flex items-center gap-1.5 break-all font-mono text-[12px] text-accent underline-offset-2 hover:underline"
                  >
                    {invoice.payDigest}
                    <HugeiconsIcon icon={LinkSquare02Icon} size={13} strokeWidth={2} />
                  </a>
                  <p className="mt-1.5 text-[11px] text-fg-dim">
                    Settled on Sui — view this payment on SuiVision.
                  </p>
                </div>
              )}
            </div>
          ) : invoice.status === "void" ? (
            <div className="flex items-center justify-center gap-2 rounded-xl bg-surface-2 py-3 text-[14px] text-fg-dim">
              <HugeiconsIcon icon={Cancel01Icon} size={18} strokeWidth={2} />
              This invoice was voided.
            </div>
          ) : (
            <p className="text-center text-[13px] text-fg-dim">
              Awaiting payment. Share the pay link below — anyone can pay with a tap,
              gasless, no wallet needed.
            </p>
          )}
        </div>
      </GlassCard>

      {/* Owner actions */}
      <div className="flex items-center gap-2">
        <PrimaryButton onClick={copyLink} variant="ghost" full>
          <HugeiconsIcon icon={Copy01Icon} size={16} strokeWidth={2} />
          Copy pay link
        </PrimaryButton>
        {invoice.status === "open" && (
          <PrimaryButton onClick={() => setVoidOpen(true)} variant="danger" full>
            <HugeiconsIcon icon={Cancel01Icon} size={16} strokeWidth={2} />
            Void
          </PrimaryButton>
        )}
      </div>

      {/* Void confirmation sheet */}
      <Sheet open={voidOpen} onClose={() => setVoidOpen(false)} title="Void invoice">
        <div className="space-y-4">
          <p className="text-[14px] text-fg-muted">
            Voiding this invoice stops its pay link from working. This can't be undone.
          </p>
          <div className="flex items-center gap-2">
            <PrimaryButton onClick={() => setVoidOpen(false)} variant="ghost" full>
              Keep it
            </PrimaryButton>
            <PrimaryButton onClick={doVoid} variant="danger" loading={voiding} full>
              Void invoice
            </PrimaryButton>
          </div>
        </div>
      </Sheet>
    </div>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 text-[13px] text-fg-muted transition-colors hover:text-fg"
    >
      <HugeiconsIcon icon={ArrowLeft02Icon} size={16} strokeWidth={2} />
      Invoices
    </button>
  );
}
