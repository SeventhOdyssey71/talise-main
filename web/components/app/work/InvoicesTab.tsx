"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  Delete02Icon,
  Invoice01Icon,
  Copy01Icon,
  CheckmarkCircle02Icon,
  Cancel01Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";
import {
  GlassCard,
  PrimaryButton,
  StatusPill,
  Sheet,
  Field,
  Eyebrow,
  MicroLabel,
  EmptyState,
  Spinner,
  api,
  ApiError,
  useToast,
  useCurrency,
} from "@/components/app";

type LineItem = { description: string; qty: string; unitUsd: string };

type Invoice = {
  id: string;
  amountUsd: number;
  currency: string;
  customerName: string | null;
  customerEmail: string | null;
  lineItems: { description: string; qty: number; unitUsd: number }[];
  memo: string | null;
  status: "open" | "paid" | "void";
  dueMs: number | null;
  createdAt: number;
};

const ORIGIN =
  typeof window !== "undefined" ? window.location.origin : "";

export function InvoicesTab() {
  const { toast } = useToast();
  const { formatUsd } = useCurrency();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ invoices: Invoice[] }>("/api/invoices");
      setInvoices(r.invoices ?? []);
    } catch {
      /* surfaced via empty state */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const copyLink = async (id: string) => {
    try {
      await navigator.clipboard.writeText(`${ORIGIN}/i/${id}`);
      toast("Pay link copied", "success");
    } catch {
      toast("Couldn't copy link", "danger");
    }
  };

  const mutate = async (id: string, action: "void" | "mark-paid") => {
    try {
      if (action === "mark-paid") {
        const digest = window.prompt(
          "Paste the transaction digest you received off-platform to mark this paid:"
        );
        if (!digest || !digest.trim()) return;
        await api(`/api/invoices/${id}`, {
          method: "POST",
          body: { action: "mark-paid", digest: digest.trim() },
        });
        toast("Invoice marked paid", "success");
      } else {
        if (!window.confirm("Void this invoice? The pay link will stop working.")) return;
        await api(`/api/invoices/${id}`, { method: "POST", body: { action: "void" } });
        toast("Invoice voided", "neutral");
      }
      await load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Something went wrong", "danger");
    }
  };

  return (
    <div className="space-y-4">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <Eyebrow>Your invoices</Eyebrow>
        <PrimaryButton onClick={() => setCreateOpen(true)} variant="ghost">
          <HugeiconsIcon icon={Add01Icon} size={15} strokeWidth={2} />
          New invoice
        </PrimaryButton>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner size={22} />
        </div>
      ) : invoices.length === 0 ? (
        <GlassCard className="p-2">
          <EmptyState
            icon={<HugeiconsIcon icon={Invoice01Icon} size={26} strokeWidth={1.6} />}
            title="No invoices yet"
            subtitle="Create your first invoice and share a pay link that works for anyone — gasless, no wallet needed."
            action={
              <PrimaryButton onClick={() => setCreateOpen(true)}>
                <HugeiconsIcon icon={PlusSignIcon} size={15} strokeWidth={2} />
                Create invoice
              </PrimaryButton>
            }
          />
        </GlassCard>
      ) : (
        /* Wise-style: all invoices in one flat card as stacked rows */
        <GlassCard className="overflow-hidden p-0">
          {invoices.map((inv, i) => (
            <InvoiceRow
              key={inv.id}
              inv={inv}
              formatUsd={formatUsd}
              onCopy={() => copyLink(inv.id)}
              onMarkPaid={() => mutate(inv.id, "mark-paid")}
              onVoid={() => mutate(inv.id, "void")}
              divider={i < invoices.length - 1}
            />
          ))}
        </GlassCard>
      )}

      <CreateInvoiceSheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          void load();
        }}
      />
    </div>
  );
}

// ── Invoice row (Wise list-row pattern) ────────────────────────────────────

function InvoiceRow({
  inv,
  formatUsd,
  onCopy,
  onMarkPaid,
  onVoid,
  divider,
}: {
  inv: Invoice;
  formatUsd: (usd: number, o?: { fixed?: boolean }) => string;
  onCopy: () => void;
  onMarkPaid: () => void;
  onVoid: () => void;
  divider: boolean;
}) {
  const tone =
    inv.status === "paid" ? "completed" : inv.status === "void" ? "danger" : "pending";
  const label =
    inv.status === "paid" ? "Paid" : inv.status === "void" ? "Void" : "Open";
  const title =
    inv.customerName ||
    (inv.lineItems[0]?.description ?? inv.memo ?? "Invoice");
  const created = new Date(inv.createdAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

  return (
    <div>
      <div className="talise-history-row flex items-center gap-3.5 px-4 py-3.5">
        {/* Circular icon chip */}
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
          <HugeiconsIcon icon={Invoice01Icon} size={17} strokeWidth={1.8} />
        </span>

        {/* Title + meta */}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium text-fg">{title}</span>
          <span className="block truncate font-mono text-[11px] text-fg-dim">
            {inv.id.slice(0, 8)}… · {created}
          </span>
        </span>

        {/* Amount + status */}
        <span className="flex shrink-0 flex-col items-end gap-1.5">
          <span
            className="text-[15px] font-semibold text-fg"
            style={{ fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em" }}
          >
            {formatUsd(inv.amountUsd, { fixed: true })}
          </span>
          <StatusPill label={label} tone={tone} />
        </span>
      </div>

      {/* Inline actions for open invoices */}
      {inv.status === "open" && (
        <div className="flex items-center gap-1 px-4 pb-3 pt-0">
          <button
            type="button"
            onClick={onCopy}
            className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-[12px] text-fg-muted transition-colors hover:bg-accent-soft hover:text-accent"
          >
            <HugeiconsIcon icon={Copy01Icon} size={12} strokeWidth={2} />
            Copy link
          </button>
          <button
            type="button"
            onClick={onMarkPaid}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] text-accent transition-colors hover:bg-accent-soft"
          >
            <HugeiconsIcon icon={CheckmarkCircle02Icon} size={12} strokeWidth={2} />
            Mark paid
          </button>
          <button
            type="button"
            onClick={onVoid}
            className="ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] text-fg-dim transition-colors hover:text-[var(--color-danger)]"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={2} />
            Void
          </button>
        </div>
      )}

      {/* Copy link on non-open invoices */}
      {inv.status !== "open" && (
        <div className="flex items-center gap-1 px-4 pb-3 pt-0">
          <button
            type="button"
            onClick={onCopy}
            className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-[12px] text-fg-muted transition-colors hover:bg-accent-soft hover:text-accent"
          >
            <HugeiconsIcon icon={Copy01Icon} size={12} strokeWidth={2} />
            Copy link
          </button>
        </div>
      )}

      {divider && <div className="mx-4 border-t border-line" />}
    </div>
  );
}

// ── Create invoice sheet ───────────────────────────────────────────────────

function CreateInvoiceSheet({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const { currencies, currency: displayCurrency, toUsd } = useCurrency();
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [memo, setMemo] = useState("");
  const [currency, setCurrency] = useState(displayCurrency || "USD");
  const [items, setItems] = useState<LineItem[]>([
    { description: "", qty: "1", unitUsd: "" },
  ]);
  const [submitting, setSubmitting] = useState(false);

  // Keep the picker defaulting to the user's display currency when opened.
  useEffect(() => {
    if (open) setCurrency(displayCurrency || "USD");
  }, [open, displayCurrency]);

  const total = useMemo(() => {
    return (
      Math.round(
        items.reduce((acc, li) => {
          const q = Number(li.qty);
          const u = Number(li.unitUsd);
          if (!Number.isFinite(q) || !Number.isFinite(u)) return acc;
          return acc + Math.max(0, q) * Math.max(0, u);
        }, 0) * 100
      ) / 100
    );
  }, [items]);

  const symbol = useMemo(
    () => currencies.find((c) => c.code === currency)?.symbol ?? "$",
    [currencies, currency]
  );
  const money = (n: number) =>
    `${symbol}${n.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  const setItem = (i: number, patch: Partial<LineItem>) =>
    setItems((cur) => cur.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const addItem = () =>
    setItems((cur) => [...cur, { description: "", qty: "1", unitUsd: "" }]);
  const removeItem = (i: number) =>
    setItems((cur) => (cur.length === 1 ? cur : cur.filter((_, idx) => idx !== i)));

  const reset = () => {
    setCustomerName("");
    setCustomerEmail("");
    setMemo("");
    setItems([{ description: "", qty: "1", unitUsd: "" }]);
  };

  const canSubmit =
    !submitting &&
    total > 0 &&
    items.some((it) => it.description.trim() && Number(it.unitUsd) > 0);

  const submit = async () => {
    const cleaned = items
      .filter((it) => it.description.trim() && Number(it.unitUsd) > 0)
      .map((it) => ({
        description: it.description.trim(),
        qty: Math.max(1, Number(it.qty) || 1),
        // The unit price is typed in the invoice's display currency — convert
        // back to USD before it's stored (₦50 must become $0.036, not $50).
        unitUsd: toUsd(Number(it.unitUsd), currency),
      }));
    if (cleaned.length === 0) {
      toast("Add at least one line item", "danger");
      return;
    }
    setSubmitting(true);
    try {
      const r = await api<{ payUrl: string }>("/api/invoices", {
        method: "POST",
        body: {
          currency,
          customerName: customerName.trim() || undefined,
          customerEmail: customerEmail.trim() || undefined,
          memo: memo.trim() || undefined,
          lineItems: cleaned,
        },
      });
      try {
        await navigator.clipboard.writeText(r.payUrl);
        toast("Invoice created — pay link copied", "success");
      } catch {
        toast("Invoice created", "success");
      }
      reset();
      onCreated();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't create invoice", "danger");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="New invoice" size="lg">
      <div className="space-y-4">
        {/* Customer details */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Customer name" hint="Shown on the invoice (optional)">
            <input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Acme Inc."
              className="talise-glass w-full rounded-xl px-3.5 py-2.5 text-[15px] text-fg outline-none placeholder:text-fg-dim"
            />
          </Field>
          <Field label="Customer email" hint="For your records only (optional)">
            <input
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              placeholder="billing@acme.com"
              type="email"
              className="talise-glass w-full rounded-xl px-3.5 py-2.5 text-[15px] text-fg outline-none placeholder:text-fg-dim"
            />
          </Field>
        </div>

        <Field label="Currency" hint="Display only — money settles 1:1 as USDsui">
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="talise-glass w-full rounded-xl px-3.5 py-2.5 text-[15px] text-fg outline-none"
          >
            {currencies.map((c) => (
              <option key={c.code} value={c.code} className="bg-surface text-fg">
                {c.code} — {c.label}
              </option>
            ))}
          </select>
        </Field>

        {/* Line items */}
        <div>
          <Eyebrow className="mb-2.5 block">Line items</Eyebrow>
          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={it.description}
                  onChange={(e) => setItem(i, { description: e.target.value })}
                  placeholder="Design work — week 1"
                  className="talise-glass min-w-0 flex-1 rounded-xl px-3 py-2.5 text-[14px] text-fg outline-none placeholder:text-fg-dim"
                />
                <input
                  value={it.qty}
                  onChange={(e) => setItem(i, { qty: e.target.value.replace(/[^\d.]/g, "") })}
                  inputMode="decimal"
                  aria-label="Quantity"
                  className="talise-glass w-14 rounded-xl px-2.5 py-2.5 text-center text-[14px] text-fg outline-none"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                />
                <div className="talise-glass flex w-24 items-center rounded-xl px-2.5 py-2.5">
                  <span className="text-[13px] text-fg-dim">{symbol}</span>
                  <input
                    value={it.unitUsd}
                    onChange={(e) =>
                      setItem(i, { unitUsd: e.target.value.replace(/[^\d.]/g, "") })
                    }
                    inputMode="decimal"
                    placeholder="0.00"
                    aria-label="Unit price"
                    className="w-full bg-transparent pl-1 text-right text-[14px] text-fg outline-none placeholder:text-fg-dim"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeItem(i)}
                  disabled={items.length === 1}
                  aria-label="Remove line item"
                  className="flex size-9 shrink-0 items-center justify-center rounded-xl text-fg-dim transition-colors hover:text-[var(--color-danger)] disabled:opacity-30"
                >
                  <HugeiconsIcon icon={Delete02Icon} size={16} strokeWidth={1.8} />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addItem}
            className="mt-2.5 inline-flex items-center gap-1.5 text-[13px] text-accent transition-opacity hover:opacity-80"
          >
            <HugeiconsIcon icon={Add01Icon} size={14} strokeWidth={2} />
            Add line item
          </button>
        </div>

        <Field label="Note" hint="Optional message to the payer">
          <input
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="Thanks for your business!"
            className="talise-glass w-full rounded-xl px-3.5 py-2.5 text-[15px] text-fg outline-none placeholder:text-fg-dim"
          />
        </Field>

        {/* Live total */}
        <div className="flex items-center justify-between rounded-xl border border-line bg-surface-2 px-4 py-3.5">
          <span className="text-[14px] text-fg-muted">Invoice total</span>
          <span
            className="text-[22px] font-semibold text-fg"
            style={{ fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" }}
          >
            {money(total)}
          </span>
        </div>

        <PrimaryButton onClick={submit} disabled={!canSubmit} loading={submitting} full>
          Create invoice &amp; copy pay link
        </PrimaryButton>
      </div>
    </Sheet>
  );
}
