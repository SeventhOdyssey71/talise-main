"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  Delete02Icon,
  UserMultipleIcon,
  CheckmarkCircle02Icon,
} from "@hugeicons/core-free-icons";
import {
  GlassCard,
  PrimaryButton,
  Sheet,
  Field,
  Eyebrow,
  MicroLabel,
  EmptyState,
  Spinner,
  SlideToConfirm,
  api,
  ApiError,
  useToast,
  useCurrency,
  resolveRecipient,
} from "@/components/app";
import { signSponsorReadyBytes, friendlyError } from "@/components/app/cheques/signBytes";

const MAX_RECIPIENTS = 50;

type ResolveState =
  | { status: "idle" }
  | { status: "resolving" }
  | { status: "ok"; address: string; displayName: string }
  | { status: "error"; message: string };

type Row = {
  /** Stable client key for React. */
  key: string;
  /** What the user typed: @handle / alice.talise.sui / 0x… */
  input: string;
  /** USDsui amount as a raw input string. */
  amount: string;
  /** Optional per-recipient label (memo). */
  label: string;
  resolve: ResolveState;
};

let rowSeq = 0;
function emptyRow(): Row {
  rowSeq += 1;
  return {
    key: `r${rowSeq}_${Date.now().toString(36)}`,
    input: "",
    amount: "",
    label: "",
    resolve: { status: "idle" },
  };
}

/**
 * PayoutsTab — pay your whole team USDsui in ONE atomic sponsored
 * transaction. Three stages in a single sheet:
 *
 *   1) Add recipients — paste `handle,amount,label` lines OR add rows by hand;
 *      each recipient live-resolves via /api/recipient/resolve.
 *   2) Review — resolved recipients, per-amount, running total + count.
 *   3) Pay — SlideToConfirm → prepare (build one sponsored PTB) → sign with
 *      the zkLogin ephemeral key + sponsor-execute → record the digest.
 *
 * Everyone or no one: the PTB is atomic on chain.
 */
export function PayoutsTab() {
  const { formatUsd } = useCurrency();
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Eyebrow>Batch payouts</Eyebrow>
        <PrimaryButton onClick={() => setCreateOpen(true)} variant="ghost">
          <HugeiconsIcon icon={Add01Icon} size={15} strokeWidth={2} />
          New payout
        </PrimaryButton>
      </div>

      <GlassCard className="p-2">
        <EmptyState
          icon={<HugeiconsIcon icon={UserMultipleIcon} size={26} strokeWidth={1.6} />}
          title="Pay your whole team in one signature"
          subtitle="Add everyone — paste a list or add rows by hand — and send USDsui to all of them in one atomic transaction. Everyone gets paid, or no one does. Gas is on us."
          action={
            <PrimaryButton onClick={() => setCreateOpen(true)}>
              <HugeiconsIcon icon={Add01Icon} size={15} strokeWidth={2} />
              Start a payout
            </PrimaryButton>
          }
        />
      </GlassCard>

      <BatchPayoutSheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        formatUsd={formatUsd}
      />
    </div>
  );
}

// ── Batch payout sheet ──────────────────────────────────────────────────────

function BatchPayoutSheet({
  open,
  onClose,
  formatUsd,
}: {
  open: boolean;
  onClose: () => void;
  formatUsd: (usd: number, o?: { fixed?: boolean }) => string;
}) {
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [pasteText, setPasteText] = useState("");
  const [stage, setStage] = useState<"build" | "review">("build");
  const [slideReset, setSlideReset] = useState(0);
  const [done, setDone] = useState<{ count: number; total: number } | null>(null);

  const reset = useCallback(() => {
    setRows([emptyRow()]);
    setPasteText("");
    setStage("build");
    setDone(null);
  }, []);

  // Reset to a clean slate whenever the sheet (re)opens.
  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  const setRow = (key: string, patch: Partial<Row>) =>
    setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const addRow = () =>
    setRows((cur) =>
      cur.length >= MAX_RECIPIENTS ? cur : [...cur, emptyRow()]
    );

  const removeRow = (key: string) =>
    setRows((cur) => (cur.length === 1 ? cur : cur.filter((r) => r.key !== key)));

  // Parse pasted lines `handle,amount,label` (label optional) into rows. Blank
  // lines are skipped. Replaces any empty trailing starter row.
  const applyPaste = () => {
    const lines = pasteText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return;
    const parsed: Row[] = [];
    for (const line of lines) {
      const parts = line.split(",").map((p) => p.trim());
      const input = parts[0] ?? "";
      const amount = (parts[1] ?? "").replace(/[^\d.]/g, "");
      const label = parts.slice(2).join(",").trim();
      if (!input) continue;
      const r = emptyRow();
      r.input = input;
      r.amount = amount;
      r.label = label;
      parsed.push(r);
    }
    if (parsed.length === 0) return;
    setRows((cur) => {
      // Drop a single empty starter row, otherwise append.
      const keep = cur.filter((r) => r.input.trim() || r.amount.trim());
      const merged = [...keep, ...parsed];
      return merged.slice(0, MAX_RECIPIENTS);
    });
    setPasteText("");
  };

  // Debounced live-resolve per row whenever its input changes.
  const debounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  useEffect(() => {
    for (const row of rows) {
      const q = row.input.trim();
      const t = debounceRef.current;
      if (t[row.key]) clearTimeout(t[row.key]);
      if (q.length < 2) {
        if (row.resolve.status !== "idle") setRow(row.key, { resolve: { status: "idle" } });
        continue;
      }
      // Already resolved this exact input → skip.
      if (row.resolve.status === "ok") continue;
      t[row.key] = setTimeout(async () => {
        setRow(row.key, { resolve: { status: "resolving" } });
        try {
          const r = await resolveRecipient(q);
          setRow(row.key, {
            resolve: { status: "ok", address: r.address, displayName: r.displayName },
          });
        } catch (err) {
          setRow(row.key, {
            resolve: {
              status: "error",
              message:
                err instanceof ApiError && err.status === 404
                  ? "No Talise user / address for that."
                  : "Couldn't resolve that recipient.",
            },
          });
        }
      }, 450);
    }
    return () => {
      const t = debounceRef.current;
      for (const k of Object.keys(t)) clearTimeout(t[k]);
    };
    // We re-run when any row's input changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.map((r) => `${r.key}:${r.input}`).join("|")]);

  // The valid, resolved, positive-amount recipients (what we'd actually send).
  const validLegs = useMemo(
    () =>
      rows
        .map((r) => {
          const amount = Number(r.amount);
          if (r.resolve.status !== "ok") return null;
          if (!Number.isFinite(amount) || amount <= 0) return null;
          return {
            input: r.input.trim(),
            address: r.resolve.address,
            displayName: r.resolve.displayName,
            amount,
            label: r.label.trim() || undefined,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null),
    [rows]
  );

  const total = useMemo(
    () => Math.round(validLegs.reduce((acc, l) => acc + l.amount, 0) * 100) / 100,
    [validLegs]
  );

  const anyResolving = rows.some((r) => r.resolve.status === "resolving");
  const anyError = rows.some((r) => r.resolve.status === "error");
  // Ready to review when every non-empty row resolves and has a valid amount,
  // there's at least one leg, and nothing's mid-flight or errored.
  const filledRows = rows.filter((r) => r.input.trim() || r.amount.trim());
  const allRowsValid =
    filledRows.length > 0 &&
    filledRows.every(
      (r) => r.resolve.status === "ok" && Number(r.amount) > 0
    );
  const canReview =
    allRowsValid && !anyResolving && !anyError && validLegs.length > 0;

  // The full pay pipeline: prepare → sign + sponsor-execute → record.
  const payBatch = useCallback(async () => {
    if (validLegs.length === 0) {
      toast("Add at least one valid recipient", "danger");
      throw new Error("no recipients");
    }

    // 1) Prepare — server resolves again (authoritative), screens, gates the
    //    limit, builds ONE sponsored PTB, persists the batch.
    const prep = await api<{
      batchId: string;
      bytes: string;
      recipientCount: number;
      totalUsd: number;
    }>("/api/payouts/batch/prepare", {
      method: "POST",
      body: {
        asset: "USDsui",
        recipients: validLegs.map((l) => ({
          to: l.input,
          amount: l.amount,
          label: l.label,
        })),
      },
    });

    // 2) Sign the sponsor-ready bytes with the zkLogin ephemeral key and
    //    broadcast via /api/zk/sponsor-execute. kind:"send" + the batch total
    //    keeps us on the standard sponsor-execute path (no special handling).
    const { digest } = await signSponsorReadyBytes(prep.bytes, {
      kind: "send",
      amountUsd: prep.totalUsd,
    });

    // 3) Record — mark the batch broadcast with the confirmed digest.
    await api(`/api/payouts/batch/${prep.batchId}/record`, {
      method: "POST",
      body: { digest },
    });

    // Balances + activity refresh (same event ContractsTab posts).
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("talise:tx", { detail: { digest } }));
    }
    toast(
      `Paid ${prep.recipientCount} ${prep.recipientCount === 1 ? "person" : "people"} — ${formatUsd(prep.totalUsd, { fixed: true })}`,
      "success"
    );
    setDone({ count: prep.recipientCount, total: prep.totalUsd });
  }, [validLegs, toast, formatUsd]);

  const onConfirm = useCallback(async () => {
    try {
      await payBatch();
    } catch (err) {
      setSlideReset((n) => n + 1);
      if (err instanceof ApiError) {
        if (err.code === "NOT_SIGNED_IN") {
          toast("Taking you to sign in…", "neutral");
        } else {
          toast(friendlyError(err, "Couldn't run the payout. Please try again."), "danger");
        }
      } else if ((err as Error)?.message && (err as Error).message !== "no recipients") {
        toast("Couldn't run the payout. Please try again.", "danger");
      }
      throw err;
    }
  }, [payBatch, toast]);

  return (
    <Sheet open={open} onClose={onClose} title="Pay your team" size="lg">
      {done ? (
        <SuccessState
          count={done.count}
          total={done.total}
          formatUsd={formatUsd}
          onDone={onClose}
          onAgain={reset}
        />
      ) : stage === "build" ? (
        <div className="space-y-5">
          {/* Paste block */}
          <Field
            label="Paste a list"
            hint="One per line: handle,amount,label — e.g. @alice,500,Design · label optional"
          >
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={3}
              placeholder={"@alice,500,Design\nbob.talise.sui,300\n0xabc…,120,Bonus"}
              className="talise-glass w-full resize-y rounded-xl px-3.5 py-2.5 font-mono text-[13px] text-fg outline-none placeholder:text-fg-dim"
            />
          </Field>
          {pasteText.trim() && (
            <button
              type="button"
              onClick={applyPaste}
              className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3.5 py-1.5 text-[12px] font-medium text-accent transition-opacity hover:opacity-80"
            >
              <HugeiconsIcon icon={Add01Icon} size={13} strokeWidth={2} />
              Add pasted recipients
            </button>
          )}

          {/* Manual rows */}
          <div>
            <Eyebrow className="mb-2.5 block">Recipients</Eyebrow>
            <div className="space-y-2">
              {rows.map((r) => (
                <RecipientRow
                  key={r.key}
                  row={r}
                  onChange={(patch) => {
                    // Editing the input invalidates a prior resolution.
                    if (patch.input !== undefined) {
                      setRow(r.key, { ...patch, resolve: { status: "idle" } });
                    } else {
                      setRow(r.key, patch);
                    }
                  }}
                  onRemove={() => removeRow(r.key)}
                  removable={rows.length > 1}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={addRow}
              disabled={rows.length >= MAX_RECIPIENTS}
              className="mt-2.5 inline-flex items-center gap-1.5 text-[13px] text-accent transition-opacity hover:opacity-80 disabled:opacity-40"
            >
              <HugeiconsIcon icon={Add01Icon} size={14} strokeWidth={2} />
              Add recipient
            </button>
            {rows.length >= MAX_RECIPIENTS && (
              <p className="mt-1.5 text-[12px] text-fg-dim">
                Max {MAX_RECIPIENTS} recipients per batch.
              </p>
            )}
          </div>

          {/* Running total */}
          <div className="flex items-center justify-between rounded-xl border border-line bg-surface-2 px-4 py-3.5">
            <span className="text-[14px] text-fg-muted">
              {validLegs.length} ready · total
            </span>
            <span
              className="text-[22px] font-semibold text-fg"
              style={{ fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" }}
            >
              {formatUsd(total, { fixed: true })}
            </span>
          </div>

          <PrimaryButton onClick={() => setStage("review")} disabled={!canReview} full>
            Review {validLegs.length} {validLegs.length === 1 ? "payout" : "payouts"}
          </PrimaryButton>
        </div>
      ) : (
        /* Review + Pay */
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setStage("build")}
            className="text-[13px] text-accent transition-opacity hover:opacity-80"
          >
            ← Edit recipients
          </button>

          <GlassCard className="overflow-hidden p-0">
            {validLegs.map((l, i) => (
              <div key={`${l.address}_${i}`}>
                <div className="flex items-center gap-3.5 px-4 py-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
                    <HugeiconsIcon icon={UserMultipleIcon} size={15} strokeWidth={1.8} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-fg">
                      {l.displayName}
                    </span>
                    {l.label && (
                      <span className="block truncate text-[11px] text-fg-dim">
                        {l.label}
                      </span>
                    )}
                  </span>
                  <span
                    className="shrink-0 text-[14px] font-semibold text-fg"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {formatUsd(l.amount, { fixed: true })}
                  </span>
                </div>
                {i < validLegs.length - 1 && <div className="mx-4 border-t border-line" />}
              </div>
            ))}
          </GlassCard>

          <div className="rounded-xl border border-line bg-surface-2 px-4 py-4">
            <div className="flex items-center justify-between">
              <MicroLabel>Total to {validLegs.length} {validLegs.length === 1 ? "person" : "people"}</MicroLabel>
              <span
                className="text-[22px] font-semibold text-fg"
                style={{ fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" }}
              >
                {formatUsd(total, { fixed: true })}
              </span>
            </div>
            <p className="mt-1.5 text-[12px] text-fg-dim">
              One atomic transaction — everyone gets paid, or no one does. Gas is
              sponsored by Talise.
            </p>
          </div>

          <SlideToConfirm
            label="Slide to pay everyone"
            onConfirm={onConfirm}
            disabled={validLegs.length === 0}
            resetSignal={slideReset}
          />
        </div>
      )}
    </Sheet>
  );
}

// ── A single editable recipient row ─────────────────────────────────────────

function RecipientRow({
  row,
  onChange,
  onRemove,
  removable,
}: {
  row: Row;
  onChange: (patch: Partial<Row>) => void;
  onRemove: () => void;
  removable: boolean;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <input
          value={row.input}
          onChange={(e) => onChange({ input: e.target.value })}
          placeholder="@alice or 0x…"
          className="talise-glass min-w-0 flex-1 rounded-xl px-3 py-2.5 text-[14px] text-fg outline-none placeholder:text-fg-dim"
        />
        <div className="talise-glass flex w-28 items-center rounded-xl px-2.5 py-2.5">
          <span className="text-[13px] text-fg-dim">$</span>
          <input
            value={row.amount}
            onChange={(e) => onChange({ amount: e.target.value.replace(/[^\d.]/g, "") })}
            inputMode="decimal"
            placeholder="0.00"
            aria-label="Amount"
            className="w-full bg-transparent pl-1 text-right text-[14px] text-fg outline-none placeholder:text-fg-dim"
            style={{ fontVariantNumeric: "tabular-nums" }}
          />
        </div>
        <button
          type="button"
          onClick={onRemove}
          disabled={!removable}
          aria-label="Remove recipient"
          className="flex size-9 shrink-0 items-center justify-center rounded-xl text-fg-dim transition-colors hover:text-[var(--color-danger)] disabled:opacity-30"
        >
          <HugeiconsIcon icon={Delete02Icon} size={16} strokeWidth={1.8} />
        </button>
      </div>

      {/* Optional label + resolve status */}
      <div className="flex items-center gap-2 pl-1">
        <input
          value={row.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="Label (optional)"
          className="min-w-0 flex-1 bg-transparent text-[12px] text-fg-muted outline-none placeholder:text-fg-dim"
        />
        <span className="shrink-0 text-[11px]">
          {row.resolve.status === "resolving" && (
            <span className="inline-flex items-center gap-1 text-fg-dim">
              <Spinner size={11} /> Resolving…
            </span>
          )}
          {row.resolve.status === "ok" && (
            <span className="inline-flex items-center gap-1 text-accent">
              <HugeiconsIcon icon={CheckmarkCircle02Icon} size={12} strokeWidth={2} />
              {row.resolve.displayName}
            </span>
          )}
          {row.resolve.status === "error" && (
            <span className="text-[var(--color-danger)]">{row.resolve.message}</span>
          )}
        </span>
      </div>
    </div>
  );
}

// ── Success state ───────────────────────────────────────────────────────────

function SuccessState({
  count,
  total,
  formatUsd,
  onDone,
  onAgain,
}: {
  count: number;
  total: number;
  formatUsd: (usd: number, o?: { fixed?: boolean }) => string;
  onDone: () => void;
  onAgain: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-4 py-6 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-accent-soft text-accent">
        <HugeiconsIcon icon={CheckmarkCircle02Icon} size={30} strokeWidth={1.8} />
      </span>
      <div>
        <h3 className="text-[18px] font-medium text-fg">Team paid</h3>
        <p className="mt-1 text-[14px] text-fg-muted">
          {formatUsd(total, { fixed: true })} to {count}{" "}
          {count === 1 ? "person" : "people"} in one transaction.
        </p>
      </div>
      <div className="flex w-full gap-2">
        <PrimaryButton onClick={onAgain} variant="ghost" full>
          Pay another batch
        </PrimaryButton>
        <PrimaryButton onClick={onDone} full>
          Done
        </PrimaryButton>
      </div>
    </div>
  );
}
