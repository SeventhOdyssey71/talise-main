"use client";

/**
 * RulesView — programmable money / automations (/app/rules).
 *
 * A rule pairs a TRIGGER with an ACTION; for launch the one executable action
 * is a scheduled `send` ("pay rent on the 1st", "send $50 every week"). Funds
 * are drawn from a Talise-controlled Rules Pocket escrow that the user pre-funds
 * over the normal gasless rail — so after creating a rule we surface that escrow
 * address to top up.
 *
 *   • GET  /api/rules            → { rules, escrowAddress }. A null escrowAddress
 *                                  means the feature isn't switched on yet →
 *                                  we render a clean "coming soon" state.
 *   • POST /api/rules            → create a scheduled send.
 *   • POST /api/rules/{id}/pause | /resume, DELETE /api/rules/{id}.
 *
 * Matches the v2 app look and reuses the shared primitives + the cookie-authed
 * `api` client.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  PlusSignIcon,
  PlayIcon,
  PauseIcon,
  Delete02Icon,
  RepeatIcon,
  Alert02Icon,
  Copy01Icon,
} from "@hugeicons/core-free-icons";
import {
  GlassCard,
  PrimaryButton,
  StatusPill,
  Sheet,
  Field,
  Eyebrow,
  EmptyState,
  Spinner,
  api,
  ApiError,
  useToast,
  useCurrency,
} from "@/components/app";

type RuleState = "active" | "paused" | "deleted" | string;

type SendConfig = { toAddress?: string; toHandle?: string | null; amountMicros?: string };

type MoneyRule = {
  id: string;
  name: string;
  triggerType: "schedule" | "on-inflow" | "threshold";
  intervalMinutes: number | null;
  dayOfMonth: number | null;
  actionType: "send" | "sweep-earn";
  actionConfig: SendConfig;
  state: RuleState;
  nextDueAt: number | null;
  executionCount: number;
  lastStatus: string | null;
  lastError: string | null;
  createdAt: number;
};

type Cadence = "monthly" | "weekly" | "daily" | "hourly";

const WEEK_MIN = 7 * 24 * 60;
const DAY_MIN = 24 * 60;

/** Map a cadence choice to the API's interval/day-of-month shape. */
function cadencePayload(cadence: Cadence, dayOfMonth: number): {
  intervalMinutes?: number;
  dayOfMonth?: number;
} {
  switch (cadence) {
    case "monthly":
      return { dayOfMonth };
    case "weekly":
      return { intervalMinutes: WEEK_MIN };
    case "daily":
      return { intervalMinutes: DAY_MIN };
    case "hourly":
      return { intervalMinutes: 60 };
  }
}

const ORDINAL = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/** Human cadence label for a rule row. */
function describeCadence(rule: MoneyRule): string {
  if (rule.dayOfMonth) return `Monthly on the ${ORDINAL(rule.dayOfMonth)}`;
  const iv = rule.intervalMinutes;
  if (iv == null) return "On a schedule";
  if (iv === 60) return "Hourly";
  if (iv === DAY_MIN) return "Daily";
  if (iv === WEEK_MIN) return "Weekly";
  if (iv % DAY_MIN === 0) return `Every ${iv / DAY_MIN} days`;
  if (iv % 60 === 0) return `Every ${iv / 60} hours`;
  return `Every ${iv} min`;
}

function shortAddr(a: string): string {
  if (!a || a.length <= 14) return a;
  return `${a.slice(0, 8)}…${a.slice(-6)}`;
}

export function RulesView() {
  const { toast } = useToast();
  const [rules, setRules] = useState<MoneyRule[]>([]);
  const [escrowAddress, setEscrowAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteFor, setDeleteFor] = useState<MoneyRule | null>(null);

  // Feature switch: the API returns escrowAddress only when the escrow key is
  // set server-side. Null ⇒ automations aren't live yet.
  const enabled = escrowAddress != null;

  const load = useCallback(async () => {
    try {
      const r = await api<{ rules: MoneyRule[]; escrowAddress: string | null }>("/api/rules");
      setRules(r.rules ?? []);
      setEscrowAddress(r.escrowAddress ?? null);
    } catch {
      setEscrowAddress(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (rule: MoneyRule) => {
    const action = rule.state === "active" ? "pause" : "resume";
    setBusyId(rule.id);
    try {
      await api(`/api/rules/${rule.id}/${action}`, { method: "POST" });
      toast(action === "pause" ? "Rule paused" : "Rule resumed", "neutral");
      await load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't update rule", "danger");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <div className="font-mono text-[11px] uppercase tracking-[0.28em] text-[#3d7a29]">
          Automations
        </div>
        <h1
          className="mt-2 text-[clamp(24px,4vw,34px)] font-[800] uppercase tracking-[-0.02em] text-[#15300c]"
          style={{ fontFamily: "var(--font-display-v2)" }}
        >
          Money that runs itself.
        </h1>
        <p className="mt-2 max-w-xl text-[14px] leading-[1.5] text-[#3a5230]">
          Set a rule once and Talise pays it on schedule — rent on the 1st, an
          allowance every week. Funded from your Rules Pocket, sent gaslessly.
        </p>
      </header>

      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner size={22} />
        </div>
      ) : !enabled ? (
        <GlassCard className="p-2">
          <EmptyState
            icon={<HugeiconsIcon icon={RepeatIcon} size={26} strokeWidth={1.6} />}
            title="Automations — coming soon"
            subtitle="Scheduled, hands-off payments are almost here. You'll be able to set a rule and let it run."
          />
        </GlassCard>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <Eyebrow>Your rules</Eyebrow>
            <PrimaryButton onClick={() => setCreateOpen(true)} variant="ghost">
              <HugeiconsIcon icon={Add01Icon} size={15} strokeWidth={2} />
              New rule
            </PrimaryButton>
          </div>

          {escrowAddress && <EscrowNote address={escrowAddress} />}

          {rules.length === 0 ? (
            <GlassCard className="p-2">
              <EmptyState
                icon={<HugeiconsIcon icon={RepeatIcon} size={26} strokeWidth={1.6} />}
                title="No rules yet"
                subtitle="Create a scheduled payment and let it run on its own."
                action={
                  <PrimaryButton onClick={() => setCreateOpen(true)}>
                    <HugeiconsIcon icon={PlusSignIcon} size={15} strokeWidth={2} />
                    New rule
                  </PrimaryButton>
                }
              />
            </GlassCard>
          ) : (
            <GlassCard className="overflow-hidden p-0">
              {rules.map((rule, i) => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  busy={busyId === rule.id}
                  onToggle={() => toggle(rule)}
                  onDelete={() => setDeleteFor(rule)}
                  divider={i < rules.length - 1}
                />
              ))}
            </GlassCard>
          )}
        </>
      )}

      <CreateRuleSheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(addr) => {
          setCreateOpen(false);
          if (addr) setEscrowAddress(addr);
          void load();
        }}
        onDisabled={() => {
          setCreateOpen(false);
          setEscrowAddress(null);
        }}
      />

      <DeleteSheet
        rule={deleteFor}
        onClose={() => setDeleteFor(null)}
        onDone={() => {
          setDeleteFor(null);
          void load();
        }}
      />
    </div>
  );
}

// ── Rules Pocket escrow note ─────────────────────────────────────────────────

function EscrowNote({ address }: { address: string }) {
  const { toast } = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      toast("Rules Pocket address copied", "success");
    } catch {
      toast("Couldn't copy address", "danger");
    }
  };
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-[#15300c]/10 bg-white/60 px-4 py-3 backdrop-blur-sm">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#CAFFB8] text-[#15300c]">
        <HugeiconsIcon icon={RepeatIcon} size={15} strokeWidth={1.8} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-[#15300c]">Rules Pocket</div>
        <div className="truncate font-mono text-[11px] text-[#3d7a29]">{shortAddr(address)}</div>
      </div>
      <button
        type="button"
        onClick={copy}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[#15300c]/15 bg-white/60 px-3 py-1.5 text-[12px] text-[#3a5230] backdrop-blur-sm transition-colors hover:bg-[#CAFFB8] hover:text-[#15300c]"
      >
        <HugeiconsIcon icon={Copy01Icon} size={12} strokeWidth={2} />
        Copy
      </button>
    </div>
  );
}

// ── Rule row ───────────────────────────────────────────────────────────────

function RuleRow({
  rule,
  busy,
  onToggle,
  onDelete,
  divider,
}: {
  rule: MoneyRule;
  busy: boolean;
  onToggle: () => void;
  onDelete: () => void;
  divider: boolean;
}) {
  const { formatUsd } = useCurrency();
  const paused = rule.state === "paused";
  const amountUsd = rule.actionConfig?.amountMicros
    ? Number(BigInt(rule.actionConfig.amountMicros)) / 1e6
    : 0;
  const to =
    rule.actionConfig?.toHandle ||
    (rule.actionConfig?.toAddress ? shortAddr(rule.actionConfig.toAddress) : "recipient");

  return (
    <div>
      <div className="flex items-center gap-3.5 px-4 py-3.5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#CAFFB8] text-[#15300c]">
          <HugeiconsIcon icon={RepeatIcon} size={17} strokeWidth={1.8} />
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium text-[#15300c]">{rule.name}</span>
          <span className="block truncate font-mono text-[11px] text-[#3d7a29]">
            {describeCadence(rule)} · to {to}
          </span>
        </span>

        <span className="flex shrink-0 flex-col items-end gap-1.5">
          <span
            className="text-[15px] font-semibold text-[#15300c]"
            style={{ fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em" }}
          >
            {formatUsd(amountUsd, { fixed: true })}
          </span>
          <StatusPill label={paused ? "Paused" : "Active"} tone={paused ? "paused" : "active"} />
        </span>
      </div>

      <div className="flex items-center gap-1 px-4 pb-3 pt-0">
        <button
          type="button"
          onClick={onToggle}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-full border border-[#15300c]/15 bg-white/60 px-3 py-1.5 text-[12px] text-[#3a5230] backdrop-blur-sm transition-colors hover:bg-[#CAFFB8] hover:text-[#15300c] disabled:opacity-50"
        >
          <HugeiconsIcon icon={paused ? PlayIcon : PauseIcon} size={12} strokeWidth={2} />
          {paused ? "Resume" : "Pause"}
        </button>
        {rule.executionCount > 0 && (
          <span className="ml-1 font-mono text-[11px] text-[#3d7a29]">
            {rule.executionCount} run{rule.executionCount === 1 ? "" : "s"}
          </span>
        )}
        <button
          type="button"
          onClick={onDelete}
          className="ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] text-[#3d7a29] transition-colors hover:text-[#c0532f]"
        >
          <HugeiconsIcon icon={Delete02Icon} size={12} strokeWidth={2} />
          Delete
        </button>
      </div>

      {rule.lastStatus === "error" && rule.lastError && (
        <div className="mx-4 mb-3 flex items-start gap-2 rounded-xl border border-[#c0532f]/25 bg-[rgba(255,158,122,0.15)] px-3 py-2 text-[12px] text-[#c0532f]">
          <HugeiconsIcon icon={Alert02Icon} size={13} strokeWidth={2} className="mt-px shrink-0" />
          <span className="min-w-0">{rule.lastError}</span>
        </div>
      )}

      {divider && <div className="mx-4 border-t border-[#15300c]/10" />}
    </div>
  );
}

// ── Create rule sheet ─────────────────────────────────────────────────────────

function CreateRuleSheet({
  open,
  onClose,
  onCreated,
  onDisabled,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (escrowAddress: string | null) => void;
  onDisabled: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [cadence, setCadence] = useState<Cadence>("monthly");
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setRecipient("");
      setAmount("");
      setCadence("monthly");
      setDayOfMonth("1");
    }
  }, [open]);

  const amountUsd = useMemo(() => {
    const v = parseFloat(amount);
    return Number.isFinite(v) && v > 0 ? v : null;
  }, [amount]);

  const dom = useMemo(() => {
    const v = parseInt(dayOfMonth, 10);
    return Number.isFinite(v) && v >= 1 && v <= 31 ? v : 1;
  }, [dayOfMonth]);

  const canSubmit = !submitting && name.trim() && recipient.trim() && amountUsd != null;

  const submit = async () => {
    if (!canSubmit || amountUsd == null) return;
    setSubmitting(true);
    try {
      const r = await api<{ escrowAddress: string | null }>("/api/rules", {
        method: "POST",
        body: {
          name: name.trim(),
          trigger: "schedule",
          action: "send",
          toRecipient: recipient.trim(),
          amountUsd,
          ...cadencePayload(cadence, dom),
        },
      });
      toast("Rule created", "success");
      onCreated(r.escrowAddress ?? null);
    } catch (err) {
      if (err instanceof ApiError && (err.code === "MONEY_RULES_DISABLED" || err.status === 503)) {
        toast("Automations aren't available yet", "neutral");
        onDisabled();
        return;
      }
      toast(err instanceof ApiError ? err.message : "Couldn't create rule", "danger");
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls =
    "w-full rounded-xl border border-[#15300c]/15 bg-white/60 px-3.5 py-2.5 text-[15px] text-[#15300c] outline-none backdrop-blur-sm placeholder:text-[#3d7a29] focus:ring-2 focus:ring-[#3d7a29]/45";

  return (
    <Sheet open={open} onClose={onClose} title="New rule" size="lg">
      <div className="space-y-4">
        <Field label="Name" hint="What this rule is for">
          <input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 80))}
            placeholder="Rent"
            className={inputCls}
          />
        </Field>

        <Field label="Pay to" hint="A @handle or 0x address">
          <input
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="landlord@talise or 0x…"
            className={inputCls}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount" hint="Per run, in USD">
            <div className="flex items-center gap-1.5 rounded-xl border border-[#15300c]/15 bg-white/60 px-3.5 py-2.5 backdrop-blur-sm focus-within:ring-2 focus-within:ring-[#3d7a29]/45">
              <span className="text-[18px] text-[#3a5230]" style={{ fontFamily: "var(--font-display-v2)" }}>
                $
              </span>
              <input
                value={amount}
                onChange={(e) => {
                  const v = e.target.value;
                  if (/^\d*\.?\d{0,2}$/.test(v)) setAmount(v);
                }}
                inputMode="decimal"
                placeholder="0.00"
                className="w-full bg-transparent text-[18px] font-[700] text-[#15300c] tabular-nums outline-none placeholder:text-[#3d7a29]"
              />
            </div>
          </Field>

          <Field label="How often" hint="When this rule runs">
            <select
              value={cadence}
              onChange={(e) => setCadence(e.target.value as Cadence)}
              className="w-full rounded-xl border border-[#15300c]/15 bg-white/60 px-3.5 py-2.5 text-[15px] text-[#15300c] outline-none backdrop-blur-sm focus:ring-2 focus:ring-[#3d7a29]/45"
            >
              <option value="monthly" className="bg-[#f7fcf2] text-[#15300c]">Monthly</option>
              <option value="weekly" className="bg-[#f7fcf2] text-[#15300c]">Weekly</option>
              <option value="daily" className="bg-[#f7fcf2] text-[#15300c]">Daily</option>
              <option value="hourly" className="bg-[#f7fcf2] text-[#15300c]">Hourly</option>
            </select>
          </Field>
        </div>

        {cadence === "monthly" && (
          <Field label="Day of month" hint="1–31 (clamped to the last day in shorter months)">
            <input
              value={dayOfMonth}
              onChange={(e) => {
                const v = e.target.value.replace(/[^\d]/g, "").slice(0, 2);
                setDayOfMonth(v);
              }}
              inputMode="numeric"
              placeholder="1"
              className={inputCls}
              style={{ fontVariantNumeric: "tabular-nums" }}
            />
          </Field>
        )}

        <PrimaryButton onClick={submit} disabled={!canSubmit} loading={submitting} full>
          Create rule
        </PrimaryButton>
        <p className="text-center text-[12px] text-[#3d7a29]">
          Fund your Rules Pocket so payouts have money to draw from.
        </p>
      </div>
    </Sheet>
  );
}

// ── Delete sheet ───────────────────────────────────────────────────────────

function DeleteSheet({
  rule,
  onClose,
  onDone,
}: {
  rule: MoneyRule | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!rule) return;
    setSubmitting(true);
    try {
      await api(`/api/rules/${rule.id}`, { method: "DELETE" });
      toast("Rule deleted", "neutral");
      onDone();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't delete rule", "danger");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet open={!!rule} onClose={onClose} title="Delete rule">
      <div className="space-y-4">
        <p className="text-[14px] text-[#3a5230]">
          Deleting <span className="font-medium text-[#15300c]">{rule?.name}</span> stops it from
          running. This can&apos;t be undone.
        </p>
        <div className="flex items-center gap-2">
          <PrimaryButton onClick={onClose} variant="ghost" full>
            Keep it
          </PrimaryButton>
          <PrimaryButton onClick={submit} variant="danger" loading={submitting} full>
            Delete rule
          </PrimaryButton>
        </div>
      </div>
    </Sheet>
  );
}

export default RulesView;
