"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fromBase64 } from "@mysten/sui/utils";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  UserGroupIcon,
  PlusSignIcon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons";
import {
  triggerOauthSignIn,
  readEphemeralForT2000,
  writeCachedProof,
} from "@/lib/zkclient";
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
  SlideToConfirm,
  api,
  ApiError,
  useToast,
  useCurrency,
  resolveRecipient,
} from "@/components/app";

type Cadence = "hourly" | "daily" | "weekly" | "monthly";

const CADENCES: { id: Cadence; label: string; period: string; ms: number }[] = [
  { id: "hourly", label: "Hourly", period: "hour", ms: 3_600_000 },
  { id: "daily", label: "Daily", period: "day", ms: 86_400_000 },
  { id: "weekly", label: "Weekly", period: "week", ms: 604_800_000 },
  { id: "monthly", label: "Monthly", period: "month", ms: 2_592_000_000 },
];

type Contract = {
  id: string;
  payeeAddress: string;
  payeeHandle: string | null;
  title: string;
  rateUsd: number;
  cadence: Cadence;
  cadenceLabel: string;
  periods: number;
  totalUsd: number;
  streamId: string;
  status: "active" | "completed" | "cancelled";
  paidUsd: number;
  remainingUsd: number;
  periodsPaid: number;
  nextPayAt: number | null;
  streamState: string | null;
};

export function ContractsTab() {
  const { toast } = useToast();
  const { formatUsd } = useCurrency();
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ contracts: Contract[] }>("/api/contracts");
      setContracts(r.contracts ?? []);
    } catch {
      /* surfaced via empty state */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const cancel = async (c: Contract) => {
    if (
      !window.confirm(
        `Cancel "${c.title}"? Future pay stops and the unsent ${formatUsd(
          c.remainingUsd,
          { fixed: true }
        )} is returned to you.`
      )
    )
      return;
    try {
      const r = await api<{ refundUsd?: number; refunded?: boolean }>(
        `/api/contracts/${c.id}`,
        { method: "POST", body: { action: "cancel" } }
      );
      toast(
        r.refunded && r.refundUsd
          ? `Contract cancelled — ${formatUsd(r.refundUsd, { fixed: true })} returned`
          : "Contract cancelled",
        "neutral"
      );
      await load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't cancel", "danger");
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <MicroLabel>Active contracts</MicroLabel>
        <PrimaryButton onClick={() => setCreateOpen(true)} variant="ghost">
          <HugeiconsIcon icon={Add01Icon} size={16} strokeWidth={2} />
          New contract
        </PrimaryButton>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner size={22} />
        </div>
      ) : contracts.length === 0 ? (
        <GlassCard className="p-2">
          <EmptyState
            icon={<HugeiconsIcon icon={UserGroupIcon} size={26} strokeWidth={1.6} />}
            title="No contracts yet"
            subtitle="Set up recurring pay for a contractor or teammate. Fund it once — Talise releases each pay period automatically."
            action={
              <PrimaryButton onClick={() => setCreateOpen(true)}>
                <HugeiconsIcon icon={PlusSignIcon} size={16} strokeWidth={2} />
                Hire someone
              </PrimaryButton>
            }
          />
        </GlassCard>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {contracts.map((c) => (
            <ContractCard
              key={c.id}
              c={c}
              formatUsd={formatUsd}
              onCancel={() => cancel(c)}
            />
          ))}
        </div>
      )}

      <CreateContractSheet
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

function ContractCard({
  c,
  formatUsd,
  onCancel,
}: {
  c: Contract;
  formatUsd: (usd: number, o?: { fixed?: boolean }) => string;
  onCancel: () => void;
}) {
  const pct = c.totalUsd > 0 ? Math.min(100, (c.paidUsd / c.totalUsd) * 100) : 0;
  const stateTone =
    c.status === "cancelled"
      ? "danger"
      : c.status === "completed" || c.streamState === "completed"
        ? "completed"
        : c.streamState === "paused"
          ? "paused"
          : "active";
  const stateLabel =
    c.status === "cancelled"
      ? "Cancelled"
      : c.streamState === "completed" || c.status === "completed"
        ? "Completed"
        : c.streamState === "paused"
          ? "Paused"
          : "Active";

  const next =
    c.nextPayAt && c.status === "active" && c.streamState === "active"
      ? new Date(c.nextPayAt)
      : null;
  const payee = c.payeeHandle || `${c.payeeAddress.slice(0, 6)}…${c.payeeAddress.slice(-4)}`;

  return (
    <GlassCard className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-medium text-fg">{c.title}</p>
          <p className="mt-0.5 truncate font-mono text-[12px] text-fg-dim">{payee}</p>
        </div>
        <StatusPill label={stateLabel} tone={stateTone} />
      </div>

      <p className="text-[13px] text-fg-muted">
        {formatUsd(c.rateUsd, { fixed: true })} every {c.cadenceLabel} · {c.periods}{" "}
        {c.cadenceLabel}
        {c.periods === 1 ? "" : "s"}
      </p>

      {/* Progress */}
      <div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]">
          <div
            className="h-full rounded-full bg-accent-deep transition-[width] duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[12px]">
          <span className="text-fg-muted" style={{ fontVariantNumeric: "tabular-nums" }}>
            Paid {formatUsd(c.paidUsd, { fixed: true })} of{" "}
            {formatUsd(c.totalUsd, { fixed: true })}
          </span>
          <span className="font-mono text-fg-dim">
            {c.periodsPaid}/{c.periods}
          </span>
        </div>
      </div>

      <div className="mt-auto flex items-center justify-between pt-1">
        {next ? (
          <span className="text-[12px] text-fg-dim">
            Next pay{" "}
            {next.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </span>
        ) : (
          <span className="text-[12px] text-fg-dim">
            {formatUsd(c.remainingUsd, { fixed: true })} remaining
          </span>
        )}
        {c.status === "active" && (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] text-fg-dim transition-colors hover:text-[var(--color-danger)]"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={13} strokeWidth={2} />
            Cancel
          </button>
        )}
      </div>
    </GlassCard>
  );
}

// ── Create contract sheet ──────────────────────────────────────────────────

type Resolved = { address: string; displayName: string };

function CreateContractSheet({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const { formatUsd } = useCurrency();

  const [payeeInput, setPayeeInput] = useState("");
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolveErr, setResolveErr] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [rate, setRate] = useState("");
  const [cadence, setCadence] = useState<Cadence>("weekly");
  const [periods, setPeriods] = useState("4");

  const [slideReset, setSlideReset] = useState(0);

  const cad = CADENCES.find((c) => c.id === cadence)!;
  const rateNum = Number(rate);
  const periodsNum = Math.floor(Number(periods));
  const total =
    Number.isFinite(rateNum) && rateNum > 0 && periodsNum > 0
      ? Math.round(rateNum * periodsNum * 100) / 100
      : 0;

  const reset = () => {
    setPayeeInput("");
    setResolved(null);
    setResolveErr(null);
    setTitle("");
    setRate("");
    setCadence("weekly");
    setPeriods("4");
  };

  // Debounced recipient resolve.
  useEffect(() => {
    const q = payeeInput.trim();
    setResolved(null);
    setResolveErr(null);
    if (q.length < 2) return;
    let cancelled = false;
    setResolving(true);
    const t = setTimeout(async () => {
      try {
        const r = await resolveRecipient(q);
        if (!cancelled) setResolved(r);
      } catch (err) {
        if (!cancelled) {
          setResolveErr(
            err instanceof ApiError && err.status === 404
              ? "No Talise user found for that handle or address."
              : "Couldn't resolve that recipient."
          );
        }
      } finally {
        if (!cancelled) setResolving(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [payeeInput]);

  const previewName = resolved?.displayName || payeeInput.trim() || "your payee";

  const ready = !!resolved && !!title.trim() && total > 0 && periodsNum > 0;

  // The full hire-&-fund pipeline: fund the stream (sponsor-prepare → sign →
  // execute → record), then persist the contract metadata.
  const hireAndFund = useCallback(async () => {
    if (!resolved) {
      toast("Pick a valid recipient first", "danger");
      throw new Error("no recipient");
    }

    const eph = readEphemeralForT2000();
    if (!eph) {
      triggerOauthSignIn({
        returnTo: typeof location !== "undefined" ? location.pathname : "/app/work",
      });
      throw new Error("not signed in");
    }

    // 1) Prepare the stream funding tx (full amount → escrow / on-chain create).
    const prep = await api<{
      bytes: string;
      mode: string;
      escrowAddress?: string;
      recipient?: { address: string };
      plan: {
        totalMicros: string;
        trancheMicros: string;
        numTranches: number;
        intervalMs: number;
        startMs: number;
      };
    }>("/api/streams/create-prepare", {
      method: "POST",
      body: {
        to: resolved.address,
        totalUsd: total,
        intervalMs: cad.ms,
        numTranches: periodsNum,
      },
    });

    // 2) Sign the funding bytes with the ephemeral key.
    const keypair = Ed25519Keypair.fromSecretKey(eph.ephemeralPrivateKey);
    const { signature: userSignature } = await keypair.signTransaction(
      fromBase64(prep.bytes)
    );

    // 3) Execute — gasless rail vs sponsor-execute, same split as useSignAndSend.
    const executePath =
      prep.mode === "gasless"
        ? "/api/send/gasless-submit"
        : "/api/zk/sponsor-execute";
    const exec = await api<{
      digest: string;
      freshProof?: Parameters<typeof writeCachedProof>[0];
    }>(executePath, {
      method: "POST",
      body: {
        bytesB64: prep.bytes,
        ephemeralPubKeyB64: eph.ephemeralPubKeyB64,
        maxEpoch: eph.maxEpoch,
        randomness: eph.randomness,
        userSignature,
        cachedProof: eph.cachedProof,
        meta: { kind: "stream-fund" },
      },
    });
    if (exec.freshProof) {
      try {
        writeCachedProof(exec.freshProof);
      } catch {
        /* non-fatal */
      }
    }

    // 4) Record the stream (server inserts the row + returns the stream id).
    const rec = await api<{ id: string }>("/api/streams/record", {
      method: "POST",
      body: {
        fundingDigest: exec.digest,
        recipientAddress: resolved.address,
        recipientHandle: resolved.displayName || null,
        totalMicros: prep.plan.totalMicros,
        trancheMicros: prep.plan.trancheMicros,
        numTranches: prep.plan.numTranches,
        startMs: prep.plan.startMs,
        intervalMs: prep.plan.intervalMs,
      },
    });

    // 5) Persist the contract metadata wrapping that stream.
    await api("/api/contracts", {
      method: "POST",
      body: {
        payeeAddress: resolved.address,
        payeeHandle: resolved.displayName || null,
        title: title.trim(),
        rateUsd: rateNum,
        cadence,
        periods: periodsNum,
        streamId: rec.id,
        fundingDigest: exec.digest,
      },
    });

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("talise:tx", { detail: { digest: exec.digest } }));
    }
    toast("Contract funded — pay starts now", "success");
    reset();
    onCreated();
  }, [resolved, total, cad.ms, periodsNum, title, rateNum, cadence, toast, onCreated]);

  const onConfirm = useCallback(async () => {
    try {
      await hireAndFund();
    } catch (err) {
      // Reset the slider so the user can retry; surface a friendly message.
      setSlideReset((n) => n + 1);
      if (err instanceof ApiError) {
        const code = err.code;
        if (code === "LIMIT_EXCEEDED" || code === "SCREENING_BLOCK") {
          toast(err.message, "danger");
        } else if (code === "BELOW_GASLESS_MINIMUM" || code === "TRANCHE_BELOW_MINIMUM") {
          toast(err.message, "danger");
        } else if (err.status === 429) {
          toast("You're going too fast — try again in a moment.", "danger");
        } else if (err.message && err.code !== "NOT_SIGNED_IN") {
          toast(err.message, "danger");
        }
      } else if (
        (err as Error)?.message &&
        (err as Error).message !== "not signed in" &&
        (err as Error).message !== "no recipient"
      ) {
        toast("Couldn't set up the contract. Please try again.", "danger");
      }
      throw err;
    }
  }, [hireAndFund, toast]);

  return (
    <Sheet open={open} onClose={onClose} title="New work contract" size="lg">
      <div className="space-y-4">
        <Field label="Who are you paying?" hint="Talise handle, @username, or Sui address">
          <input
            value={payeeInput}
            onChange={(e) => setPayeeInput(e.target.value)}
            placeholder="@alice or 0x…"
            className="talise-glass w-full rounded-xl px-3.5 py-2.5 text-[15px] text-fg outline-none placeholder:text-fg-dim"
          />
        </Field>
        {resolving && (
          <div className="flex items-center gap-2 text-[12px] text-fg-dim">
            <Spinner size={13} /> Resolving…
          </div>
        )}
        {resolved && (
          <div className="flex items-center gap-2 rounded-xl bg-[var(--color-accent-soft)] px-3 py-2 text-[13px] text-accent">
            Paying {resolved.displayName}
          </div>
        )}
        {resolveErr && <p className="text-[12px] text-[var(--color-danger)]">{resolveErr}</p>}

        <Field label="Role / title">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Senior contractor — design"
            className="talise-glass w-full rounded-xl px-3.5 py-2.5 text-[15px] text-fg outline-none placeholder:text-fg-dim"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Rate per period">
            <div className="talise-glass flex items-center rounded-xl px-3.5 py-2.5">
              <span className="text-[15px] text-fg-dim">$</span>
              <input
                value={rate}
                onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ""))}
                inputMode="decimal"
                placeholder="500"
                className="w-full bg-transparent pl-1 text-[15px] text-fg outline-none placeholder:text-fg-dim"
                style={{ fontVariantNumeric: "tabular-nums" }}
              />
            </div>
          </Field>
          <Field label="Periods" hint={`How many ${cad.period}s to pay`}>
            <input
              value={periods}
              onChange={(e) => setPeriods(e.target.value.replace(/[^\d]/g, ""))}
              inputMode="numeric"
              placeholder="4"
              className="talise-glass w-full rounded-xl px-3.5 py-2.5 text-[15px] text-fg outline-none placeholder:text-fg-dim"
              style={{ fontVariantNumeric: "tabular-nums" }}
            />
          </Field>
        </div>

        <div>
          <Eyebrow className="mb-2 block">Cadence</Eyebrow>
          <div className="flex flex-wrap gap-2">
            {CADENCES.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCadence(c.id)}
                className={`rounded-full px-4 py-2 text-[13px] font-medium transition-colors ${
                  cadence === c.id
                    ? "bg-accent-deep text-white"
                    : "talise-glass text-fg-muted hover:text-fg"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Live preview */}
        <div className="rounded-xl border border-line bg-[var(--color-surface-2)] px-4 py-4">
          {total > 0 ? (
            <>
              <p className="text-[14px] leading-relaxed text-fg">
                Pays{" "}
                <span className="font-medium text-accent">{previewName}</span>{" "}
                {formatUsd(rateNum, { fixed: true })} every {cad.period} for {periodsNum}{" "}
                {cad.period}
                {periodsNum === 1 ? "" : "s"}.
              </p>
              <div className="mt-3 flex items-center justify-between">
                <MicroLabel>Funded now</MicroLabel>
                <span
                  className="text-[22px] font-semibold text-fg"
                  style={{ fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" }}
                >
                  {formatUsd(total, { fixed: true })}
                </span>
              </div>
              <p className="mt-1.5 text-[12px] text-fg-dim">
                Funded once, gasless. Each {cad.period}&apos;s pay releases automatically —
                cancel anytime to get the unsent balance back.
              </p>
            </>
          ) : (
            <p className="text-[13px] text-fg-dim">
              Set a rate and number of periods to preview the total.
            </p>
          )}
        </div>

        <SlideToConfirm
          label="Slide to hire & fund"
          onConfirm={onConfirm}
          disabled={!ready}
          resetSignal={slideReset}
        />
      </div>
    </Sheet>
  );
}
