"use client";

import type { Invoice } from "@/lib/db";

export function InvoiceList({
  invoices,
  handle,
}: {
  invoices: Invoice[];
  handle: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] uppercase tracking-[0.2em] text-[var(--color-fg-dim)]">
          Issued invoices ({invoices.length})
        </h2>
        <span className="text-[11px] text-[var(--color-fg-dim)]">
          newest first
        </span>
      </div>

      {invoices.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-[var(--color-line)] bg-[var(--color-surface-2)] p-10 text-center">
          <div className="mx-auto h-8 w-8 rounded-full border border-[var(--color-line)]" />
          <p className="mt-3 text-[13px] text-[var(--color-fg-muted)]">
            No invoices yet.
          </p>
          <p className="mt-1 text-[11px] text-[var(--color-fg-dim)]">
            Create one on the left, then share the link or QR with your
            customer.
          </p>
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {invoices.map((inv) => {
            const link = `/p/${handle}?amount=${inv.amount_usdc}&invoice=${inv.slug}${inv.reference ? `&memo=${encodeURIComponent(inv.reference)}` : ""}`;
            const isPaid = inv.status === "paid";
            return (
              <li
                key={inv.id}
                className="flex flex-col gap-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4 md:flex-row md:items-center md:justify-between"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`inline-flex h-2 w-2 rounded-full ${
                      isPaid ? "bg-[#0a0a0a]" : "bg-[var(--color-fg-dim)]"
                    }`}
                  />
                  <div>
                    <div className="text-[15px] text-[var(--color-fg)]">
                      ${Number(inv.amount_usdc).toFixed(2)} USDsui
                      {inv.reference && (
                        <span className="ml-2 text-[12px] text-[var(--color-fg-muted)]">
                          · {inv.reference}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] text-[var(--color-fg-dim)]">
                      {inv.slug} ·{" "}
                      {new Date(inv.created_at).toLocaleDateString()}
                      {inv.customer_email && ` · ${inv.customer_email}`}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill status={inv.status} />
                  {isPaid && inv.receipt_object_id && (
                    <a
                      href={`https://suiscan.xyz/mainnet/object/${inv.receipt_object_id}`}
                      target="_blank"
                      rel="noreferrer"
                      title={`Receipt: ${inv.receipt_object_id}`}
                      className="inline-flex items-center gap-1 rounded-md border border-[var(--color-fg)] bg-[var(--color-fg)] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-bg)] transition hover:opacity-90"
                    >
                      Receipt ↗
                    </a>
                  )}
                  <a
                    href={link}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[12px] text-[var(--color-fg)] transition hover:border-[var(--color-fg)]"
                  >
                    Open
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const label = status === "paid" ? "Paid" : status === "void" ? "Void" : "Open";
  const isPaid = status === "paid";
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${
        isPaid
          ? "border-[var(--color-fg)] bg-[var(--color-fg)] text-[var(--color-bg)]"
          : "border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-fg-muted)]"
      }`}
    >
      {label}
    </span>
  );
}
