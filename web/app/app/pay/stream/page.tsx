"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  FlashIcon,
  InformationCircleIcon,
  CheckmarkCircle02Icon,
  Cancel01Icon,
  StopIcon,
  RadioIcon,
} from "@hugeicons/core-free-icons";
import {
  Eyebrow,
  GlassCard,
  PrimaryButton,
  SlideToConfirm,
  Spinner,
  EmptyState,
  StatusPill,
  Field,
  useSignAndSend,
  resolveRecipient,
  api,
  ApiError,
} from "@/components/app";
import type { StatusTone } from "@/components/app";
import { signSponsorReadyBytes, friendlyError } from "@/components/app/cheques/signBytes";

// ── Types ─────────────────────────────────────────────────────────────────

type PreparePlan = {
  totalUsd: number;
  totalMicros: string;
  trancheMicros: string;
  trancheUsd: number;
  numTranches: number;
  intervalMs: number;
  startMs: number;
};

type PrepareResp = {
  bytes?: string;
  mode?: "onchain" | "gasless" | "sponsored";
  escrowAddress?: string;
  recipient?: { address: string; displayName: string };
  plan?: PreparePlan;
  error?: string;
};

type ProjectedStream = {
  id: string;
  recipientAddress: string;
  recipientHandle: string | null;
  totalUsd: number;
  releasedUsd: number;
  remainingUsd: number;
  trancheUsd: number;
  numTranches: number;
  tranchesDone: number;
  startMs: number;
  intervalMs: number;
  nextTrancheAt: number | null;
  state: string;
  role: string;
  isSender: boolean;
  isRecipient: boolean;
};

type Tab = "setup" | "list";

const DURATIONS: { label: string; min: number }[] = [
  { label: "1 hour", min: 60 },
  { label: "1 day", min: 1440 },
  { label: "1 week", min: 10080 },
  { label: "30 days", min: 43200 },
];
const INTERVALS: { label: string; min: number }[] = [
  { label: "1 min", min: 1 },
  { label: "10 min", min: 10 },
  { label: "1 hour", min: 60 },
  { label: "1 day", min: 1440 },
];

// ── Page ──────────────────────────────────────────────────────────────────

export default function StreamPage() {
  const [tab, setTab] = useState<Tab>("setup");
  const [listReload, setListReload] = useState(0);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <header className="space-y-1.5">
        <Eyebrow>Streaming</Eyebrow>
        <h1
          className="font-display text-[26px] font-medium text-fg sm:text-[30px]"
          style={{ letterSpacing: "-0.03em" }}
        >
          Money over time
        </h1>
        <p className="text-[14px] text-fg-muted">
          Drip a salary, an allowance, or a payout — every payment gasless,
          because gas is free on Talise.
        </p>
      </header>

      <div
        className="talise-glass inline-flex w-full gap-1 p-1"
        style={{ borderRadius: 999 }}
        role="tablist"
      >
        {([
          { id: "setup" as Tab, label: "New stream" },
          { id: "list" as Tab, label: "Your streams" },
        ]).map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              className={`flex-1 rounded-full px-4 py-2 text-[14px] font-semibold transition-colors ${
                active ? "text-[#0a130d]" : "text-fg-muted hover:text-fg"
              }`}
              style={active ? { background: "var(--color-accent)" } : undefined}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "setup" ? (
        <SetupTab
          onStarted={() => {
            setListReload((n) => n + 1);
            setTab("list");
          }}
        />
      ) : (
        <ListTab reloadSignal={listReload} />
      )}
    </div>
  );
}

// ── SETUP ───────────────────────────────────────────────────────────────────

function SetupTab({ onStarted }: { onStarted: () => void }) {
  const { send } = useSignAndSend();

  const [query, setQuery] = useState("");
  const [resolved, setResolved] = useState<{ address: string; displayName: string } | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolveFailed, setResolveFailed] = useState(false);
  const [amount, setAmount] = useState("");
  const [durationMin, setDurationMin] = useState(60);
  const [intervalMin, setIntervalMin] = useState(10);
  const [error, setError] = useState<string | null>(null);
  const [resetSignal, setResetSignal] = useState(0);

  const resolveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqSeq = useRef(0);

  const totalUsd = useMemo(() => {
    const n = Number(amount);
    return Number.isFinite(n) ? n : 0;
  }, [amount]);
  const numTranches = useMemo(
    () => Math.max(1, Math.floor(durationMin / Math.max(1, intervalMin))),
    [durationMin, intervalMin]
  );
  const trancheUsd = numTranches > 0 ? totalUsd / numTranches : 0;

  const validSchedule =
    totalUsd > 0 &&
    trancheUsd >= 0.01 &&
    !!resolved &&
    numTranches >= 1 &&
    numTranches <= 5000;

  // Debounced recipient resolve as the user types.
  useEffect(() => {
    setResolved(null);
    setResolveFailed(false);
    if (resolveTimer.current) clearTimeout(resolveTimer.current);
    const q = query.trim();
    if (!q) {
      setResolving(false);
      return;
    }
    setResolving(true);
    const seq = ++reqSeq.current;
    resolveTimer.current = setTimeout(async () => {
      try {
        const r = await resolveRecipient(q);
        if (seq !== reqSeq.current) return;
        setResolved(r);
        setResolveFailed(false);
      } catch {
        if (seq !== reqSeq.current) return;
        setResolved(null);
        setResolveFailed(true);
      } finally {
        if (seq === reqSeq.current) setResolving(false);
      }
    }, 400);
    return () => {
      if (resolveTimer.current) clearTimeout(resolveTimer.current);
    };
  }, [query]);

  const statusMessage = useMemo(() => {
    if (!query.trim()) return "Enter a recipient — an @handle or a 0x address.";
    if (resolving) return "Looking up that recipient…";
    if (!resolved) return "Enter a recipient we can find before streaming.";
    if (totalUsd <= 0) return "Enter an amount to stream.";
    if (trancheUsd < 0.01)
      return `Each payment works out to $${trancheUsd.toFixed(4)} — below the $0.01 minimum. Raise the total or stream less often.`;
    if (numTranches > 5000)
      return `That's ${numTranches} payments — too many. Stream less often or over a shorter window.`;
    return "Set a recipient, amount and schedule to start.";
  }, [query, resolving, resolved, totalUsd, trancheUsd, numTranches]);

  const intervalLabel = INTERVALS.find((i) => i.min === intervalMin)?.label ?? `${intervalMin} min`;
  const durationLabel = DURATIONS.find((d) => d.min === durationMin)?.label ?? `${durationMin} min`;

  const start = useCallback(async () => {
    if (!resolved || !validSchedule) return;
    setError(null);
    const totalMicros = Math.round(totalUsd * 1_000_000);
    const trancheMicros = Math.floor(totalMicros / numTranches);
    const intervalMs = intervalMin * 60_000;
    const now = Date.now();
    try {
      const prep = await api<PrepareResp>("/api/streams/create-prepare", {
        method: "POST",
        body: { to: resolved.address, totalUsd, intervalMs, numTranches },
      });
      if (prep.error) throw new ApiError(400, prep.error, null);

      // Fund the stream. On-chain rail signs sponsor-ready bytes; escrow rail
      // funds the escrow address over the normal send rail.
      let fundingDigest: string;
      if (prep.mode === "onchain" && prep.bytes) {
        const { digest } = await signSponsorReadyBytes(prep.bytes, { intent: "start-stream" });
        fundingDigest = digest;
      } else {
        // create-prepare returns the escrow address in its plan; fall back to
        // /api/streams/escrow only if it's somehow absent.
        let escrowAddr = prep.escrowAddress;
        if (!escrowAddr) {
          const e = await api<{ escrowAddress: string }>("/api/streams/escrow");
          escrowAddr = e.escrowAddress;
        }
        const { digest } = await send({ to: escrowAddr, amountUsd: totalUsd });
        fundingDigest = digest;
      }

      await api("/api/streams/record", {
        method: "POST",
        body: {
          fundingDigest,
          recipientAddress: resolved.address,
          recipientHandle: resolved.displayName,
          totalMicros: String(totalMicros),
          trancheMicros: String(trancheMicros),
          numTranches,
          startMs: now,
          intervalMs,
        },
      });

      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("talise:tx", { detail: { kind: "stream-start" } }));
      }
      onStarted();
    } catch (e) {
      setError(friendlyError(e, "Couldn't start the stream right now.", "Streaming"));
      setResetSignal((n) => n + 1);
      throw e;
    }
  }, [resolved, validSchedule, totalUsd, numTranches, intervalMin, send, onStarted]);

  return (
    <div className="space-y-6">
      {/* Recipient */}
      <Field label="To">
        <div className="flex items-center gap-2 border-b border-line pb-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="@handle or 0x address"
            className="w-full bg-transparent text-[15px] text-fg outline-none placeholder:text-fg-dim"
          />
          {resolving ? (
            <Spinner size={16} />
          ) : resolved ? (
            <HugeiconsIcon icon={CheckmarkCircle02Icon} size={18} className="text-accent" />
          ) : resolveFailed ? (
            <HugeiconsIcon icon={Cancel01Icon} size={18} style={{ color: "var(--color-danger)" }} />
          ) : null}
        </div>
        <div className="mt-1.5 min-h-[14px] font-mono text-[10px]">
          {resolving ? (
            <span className="text-fg-dim">Looking up recipient…</span>
          ) : resolved ? (
            <span className="text-accent">Resolved: {resolved.displayName}</span>
          ) : resolveFailed ? (
            <span style={{ color: "var(--color-danger)" }}>
              Couldn&apos;t find that recipient. Check the @handle or address.
            </span>
          ) : null}
        </div>
      </Field>

      {/* Amount */}
      <Field label="Total (USDsui)">
        <div className="flex items-center gap-2 border-b border-line pb-2">
          <span className="font-display text-[20px] text-fg-muted">$</span>
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="0.00"
            className="w-full bg-transparent font-display text-[22px] text-fg tabular-nums outline-none placeholder:text-fg-dim"
            style={{ letterSpacing: "-0.02em" }}
          />
        </div>
      </Field>

      {/* Schedule */}
      <GlassCard className="space-y-5 p-5">
        <ChipRow label="Over" options={DURATIONS} value={durationMin} onChange={setDurationMin} />
        <ChipRow label="Every" options={INTERVALS} value={intervalMin} onChange={setIntervalMin} />
      </GlassCard>

      {/* Live preview / status */}
      {validSchedule ? (
        <GlassCard
          className="space-y-1.5 p-4"
          radius={18}
          tint="var(--color-accent)"
        >
          <div className="flex items-center gap-2">
            <HugeiconsIcon icon={FlashIcon} size={15} className="text-accent" />
            <span className="text-[15px] font-medium text-fg">
              {numTranches} payments of ${trancheUsd.toFixed(2)}
            </span>
          </div>
          <p className="text-[13px] text-fg-muted">
            One every {intervalLabel}, finishing in {durationLabel}. First payment fires now.
          </p>
          <p className="font-mono text-[10px] text-accent">
            Every payment is gasless — ${totalUsd.toFixed(2)} total, $0 in fees.
          </p>
        </GlassCard>
      ) : (
        <GlassCard className="flex items-start gap-2 p-4" radius={16}>
          <HugeiconsIcon icon={InformationCircleIcon} size={15} className="mt-0.5 shrink-0 text-fg-muted" />
          <span className="text-[13px] text-fg-muted">{statusMessage}</span>
        </GlassCard>
      )}

      {error && <InlineError>{error}</InlineError>}

      <SlideToConfirm
        label="Slide to start streaming"
        onConfirm={start}
        disabled={!validSchedule}
        resetSignal={resetSignal}
      />
    </div>
  );
}

function ChipRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { label: string; min: number }[];
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2.5">
      <Eyebrow>{label}</Eyebrow>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = value === o.min;
          return (
            <button
              key={o.min}
              type="button"
              onClick={() => onChange(o.min)}
              className={`rounded-full px-4 py-2 text-[13px] transition-colors ${
                on ? "font-medium text-[#0a130d]" : "text-fg hover:border-white/15"
              } ${on ? "" : "talise-glass"}`}
              style={on ? { background: "var(--color-accent)" } : undefined}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── LIST ─────────────────────────────────────────────────────────────────

function ListTab({ reloadSignal }: { reloadSignal: number }) {
  const [streams, setStreams] = useState<ProjectedStream[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api<{ streams: ProjectedStream[] }>("/api/streams");
      setStreams(r.streams ?? []);
    } catch (e) {
      setError(friendlyError(e, "Couldn't load your streams right now.", "Streaming"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadSignal]);

  const cancel = useCallback(
    async (s: ProjectedStream) => {
      setCancelling(s.id);
      setCancelError(null);
      try {
        const r = await api<{
          mode?: string;
          bytes?: string;
          refundUsd?: number;
        }>(`/api/streams/${s.id}/cancel`, { method: "POST", body: {} });
        if (r.mode === "onchain" && r.bytes) {
          await signSponsorReadyBytes(r.bytes, { intent: "cancel-stream" });
        } else if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("talise:tx", { detail: { kind: "stream-cancel" } }));
        }
        await load();
      } catch (e) {
        setCancelError(friendlyError(e, "Couldn't cancel the stream right now.", "Streaming"));
      } finally {
        setCancelling(null);
      }
    },
    [load]
  );

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size={26} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center">
        <p className="max-w-xs text-[14px] text-fg-muted">{error}</p>
        <PrimaryButton variant="ghost" onClick={load}>
          Try again
        </PrimaryButton>
      </div>
    );
  }

  if (streams.length === 0) {
    return (
      <EmptyState
        icon={<HugeiconsIcon icon={RadioIcon} size={26} />}
        title="No streams yet"
        subtitle="Start one to drip money over time — every payment is gasless."
      />
    );
  }

  return (
    <div className="space-y-3">
      {cancelError && <InlineError>{cancelError}</InlineError>}
      {streams.map((s) => {
        const progress = s.totalUsd > 0 ? Math.min(1, s.releasedUsd / s.totalUsd) : 0;
        const canCancel = s.role !== "recipient" && (s.state === "active" || s.state === "paused");
        return (
          <GlassCard key={s.id} className="space-y-3 p-4" radius={18}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <span className="block font-mono text-[10px] uppercase tracking-widest text-fg-dim">
                  {s.role === "recipient" ? "Streaming in" : "Streaming out"}
                </span>
                <span className="block truncate text-[15px] font-medium text-fg">
                  {s.recipientHandle || shortAddr(s.recipientAddress)}
                </span>
              </div>
              <StatusPill label={s.state} tone={streamTone(s.state)} />
            </div>

            {/* Progress bar */}
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${progress * 100}%`,
                  background: "var(--color-accent)",
                  transition: "width 400ms ease-out",
                }}
              />
            </div>

            <div className="flex items-center justify-between font-mono text-[10px]">
              <span className="text-fg-muted tabular-nums">
                ${s.releasedUsd.toFixed(2)} of ${s.totalUsd.toFixed(2)}
              </span>
              <span className="text-fg-dim tabular-nums">
                {s.tranchesDone}/{s.numTranches} payments
              </span>
            </div>

            {canCancel && (
              <PrimaryButton
                variant="ghost"
                full
                loading={cancelling === s.id}
                disabled={cancelling != null && cancelling !== s.id}
                onClick={() => cancel(s)}
              >
                {cancelling !== s.id && <HugeiconsIcon icon={StopIcon} size={15} />}
                {cancelling === s.id ? "Cancelling…" : "Cancel & refund remainder"}
              </PrimaryButton>
            )}
          </GlassCard>
        );
      })}
    </div>
  );
}

// ── Shared bits ────────────────────────────────────────────────────────────

function InlineError({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex items-start gap-2 rounded-2xl px-4 py-3 text-[13px]"
      style={{
        background: "color-mix(in srgb, var(--color-danger) 12%, transparent)",
        color: "var(--color-danger)",
      }}
    >
      <HugeiconsIcon icon={Cancel01Icon} size={15} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

function streamTone(state: string): StatusTone {
  switch (state) {
    case "active":
      return "active";
    case "paused":
      return "paused";
    case "completed":
      return "completed";
    case "cancelled":
      return "neutral";
    default:
      return "neutral";
  }
}

function shortAddr(a: string): string {
  if (!a || a.length <= 12) return a || "—";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
