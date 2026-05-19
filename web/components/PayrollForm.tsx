"use client";

import { useMemo, useState } from "react";
import {
  signAndSubmit,
  buildBatchUsdsuiPayroll,
  hasEphemeralKey,
  triggerOauthSignIn,
} from "@/lib/zkclient";
import { ErrorBox } from "@/components/ErrorBox";

type Row = { id: number; address: string; amount: string; label: string };

const ADDR_RE = /^0x[a-fA-F0-9]{64}$/;

export function PayrollForm({
  senderAddress,
  availableUsdsui,
  availableSui,
}: {
  senderAddress: string;
  availableUsdsui: number;
  availableSui: number;
}) {
  const [rows, setRows] = useState<Row[]>([
    { id: 1, address: "", amount: "", label: "" },
    { id: 2, address: "", amount: "", label: "" },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    digest: string;
    count: number;
    total: number;
  } | null>(null);

  const validRows = useMemo(
    () =>
      rows.filter(
        (r) =>
          ADDR_RE.test(r.address.trim()) &&
          r.address.trim().toLowerCase() !== senderAddress.toLowerCase() &&
          Number(r.amount) > 0
      ),
    [rows, senderAddress]
  );
  const total = validRows.reduce((sum, r) => sum + Number(r.amount), 0);
  const overspend = total > availableUsdsui;
  const canSubmit =
    validRows.length > 0 && !overspend && availableSui >= 0.01 && !submitting;

  function update(id: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((rs) => [
      ...rs,
      { id: rs.length ? rs[rs.length - 1].id + 1 : 1, address: "", amount: "", label: "" },
    ]);
  }
  function removeRow(id: number) {
    setRows((rs) => (rs.length <= 1 ? rs : rs.filter((r) => r.id !== id)));
  }
  function clear() {
    setRows([{ id: 1, address: "", amount: "", label: "" }]);
  }

  async function importCsv(text: string) {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    if (lines.length === 0) return;
    const next: Row[] = lines.map((line, i) => {
      // Expected format:  address,amount[,label]
      const [a, b, ...rest] = line.split(",").map((s) => s.trim());
      return {
        id: i + 1,
        address: a ?? "",
        amount: b ?? "",
        label: rest.join(", "),
      };
    });
    setRows(next);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    try {
      if (!hasEphemeralKey()) {
        // Auto-recover: re-run OAuth with this page as return target.
        await triggerOauthSignIn({
          returnTo: window.location.pathname + window.location.search,
        });
        return; // page unloads
      }
      if (validRows.length === 0) throw new Error("No valid recipients.");
      if (availableSui < 0.005) throw new Error("Need ~0.005 SUI for gas.");
      if (overspend) throw new Error("Total exceeds your USDsui balance.");

      const recipients = validRows.map((r) => ({
        address: r.address.trim(),
        amountMicro: BigInt(Math.round(Number(r.amount) * 1e6)),
        ref: r.label || undefined,
      }));

      const { digest } = await signAndSubmit(
        buildBatchUsdsuiPayroll({ senderAddress, recipients }),
        { senderAddress }
      );

      await fetch("/api/tx/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          digest,
          kind: "payroll",
          amount: total.toString(),
          asset: "USDsui",
          recipient: null,
          memo: `Payroll · ${recipients.length} recipient${recipients.length === 1 ? "" : "s"}`,
        }),
      }).catch(() => {});

      setSuccess({ digest, count: recipients.length, total });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    const net = process.env.NEXT_PUBLIC_SUI_NETWORK ?? "mainnet";
    return (
      <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-6">
        <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-dim)]">
          Payroll executed · atomic
        </div>
        <div className="mt-3 font-display text-[36px] tracking-[-0.02em]">
          ${success.total.toFixed(2)} paid to {success.count} address
          {success.count === 1 ? "" : "es"}.
        </div>
        <p className="mt-2 text-[14px] text-[var(--color-fg-muted)]">
          Settled in one block. Every recipient&apos;s wallet picked up the
          incoming USDsui simultaneously.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3 text-[12px]">
          <a
            href={`https://suiscan.xyz/${net}/tx/${success.digest}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--color-fg)] transition hover:border-[var(--color-fg)]"
          >
            View on Suiscan ↗
          </a>
          <a
            href="/business"
            className="text-[var(--color-fg-muted)] underline-offset-4 hover:text-[var(--color-fg)] hover:underline"
          >
            Back to dashboard
          </a>
        </div>
        <p className="mt-5 font-mono text-[11px] text-[var(--color-fg-dim)] break-all">
          digest: {success.digest}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)]">
        <div className="border-b border-[var(--color-line)] px-5 py-3 text-[11px] uppercase tracking-[0.18em] text-[var(--color-fg-dim)]">
          Recipients ({validRows.length} valid / {rows.length} total)
        </div>

        <div className="divide-y divide-[var(--color-line)]">
          {rows.map((r, i) => {
            const addrOk = !r.address || ADDR_RE.test(r.address);
            const amtOk = !r.amount || Number(r.amount) > 0;
            const isSelf =
              r.address.toLowerCase() === senderAddress.toLowerCase() && r.address.length > 0;
            return (
              <div
                key={r.id}
                className="grid grid-cols-1 gap-3 px-5 py-4 md:grid-cols-[2fr,1fr,1.5fr,auto] md:items-center"
              >
                <div>
                  <input
                    value={r.address}
                    onChange={(e) =>
                      update(r.id, { address: e.target.value.trim() })
                    }
                    placeholder="0x..."
                    autoComplete="off"
                    spellCheck={false}
                    className={`w-full rounded-md border bg-[var(--color-surface)] px-3 py-2 font-mono text-[12px] placeholder:text-[var(--color-fg-dim)] focus:outline-none ${
                      addrOk && !isSelf
                        ? "border-[var(--color-line)] text-[var(--color-fg)] focus:border-[var(--color-fg)]"
                        : "border-[var(--color-fg)] text-[var(--color-fg)]"
                    }`}
                  />
                  {!addrOk && (
                    <div className="mt-1 text-[10px] text-[var(--color-fg)]">
                      ! must be 0x + 64 hex chars
                    </div>
                  )}
                  {isSelf && (
                    <div className="mt-1 text-[10px] text-[var(--color-fg)]">
                      ! your own address
                    </div>
                  )}
                </div>
                <div>
                  <div className="relative">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={r.amount}
                      onChange={(e) => update(r.id, { amount: e.target.value })}
                      placeholder="0.00"
                      className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-[14px] text-[var(--color-fg)] placeholder:text-[var(--color-fg-dim)] focus:border-[var(--color-fg)] focus:outline-none"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] uppercase tracking-wider text-[var(--color-fg-dim)]">
                      USDsui
                    </span>
                  </div>
                </div>
                <input
                  value={r.label}
                  onChange={(e) => update(r.id, { label: e.target.value })}
                  placeholder={`Reference (e.g. ${i === 0 ? "Q2 retainer" : "May contractor"})`}
                  className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-[13px] text-[var(--color-fg)] placeholder:text-[var(--color-fg-dim)] focus:border-[var(--color-fg)] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => removeRow(r.id)}
                  disabled={rows.length === 1}
                  className="self-center justify-self-end rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1 text-[12px] text-[var(--color-fg-muted)] transition hover:border-[var(--color-fg)] hover:text-[var(--color-fg)] disabled:cursor-not-allowed disabled:opacity-30"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-line)] bg-[var(--color-surface-2)] px-5 py-3 text-[12px]">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={addRow}
              className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[12px] text-[var(--color-fg)] transition hover:border-[var(--color-fg)]"
            >
              + Add recipient
            </button>
            <label className="inline-flex cursor-pointer items-center gap-2 text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]">
              <input
                type="file"
                accept=".csv,text/csv,.txt"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const text = await f.text();
                  importCsv(text);
                  e.currentTarget.value = "";
                }}
              />
              <span className="underline underline-offset-4">Import CSV</span>
              <span className="text-[10px] text-[var(--color-fg-dim)]">
                (address,amount,label)
              </span>
            </label>
            <button
              type="button"
              onClick={clear}
              className="text-[var(--color-fg-dim)] underline-offset-4 hover:text-[var(--color-fg)] hover:underline"
            >
              Clear
            </button>
          </div>
          <div className="text-[var(--color-fg-muted)]">
            Total:{" "}
            <span
              className={`font-mono text-[14px] ${
                overspend ? "text-[var(--color-fg)]" : "text-[var(--color-fg)]"
              }`}
            >
              ${total.toFixed(2)} USDsui
            </span>
            <span className="ml-2 text-[var(--color-fg-dim)]">
              available {availableUsdsui.toFixed(2)} USDsui
            </span>
            {overspend && (
              <span className="ml-2 text-[var(--color-fg)]">! insufficient</span>
            )}
          </div>
        </div>
      </div>

      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full rounded-md bg-[var(--color-fg)] px-5 py-3.5 text-[15px] font-medium text-[var(--color-bg)] transition hover:bg-[var(--color-accent-soft)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {submitting
          ? "Signing & broadcasting…"
          : canSubmit
            ? `Pay ${validRows.length} recipient${validRows.length === 1 ? "" : "s"}. $${total.toFixed(2)}`
            : "Add valid recipients and amounts"}
      </button>

      {err && <div className="mt-3"><ErrorBox message={err} /></div>}
    </form>
  );
}
