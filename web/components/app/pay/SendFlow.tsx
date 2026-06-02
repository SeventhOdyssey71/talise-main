"use client";

/**
 * SendFlow — the web Send experience for /app/pay.
 *
 * A clean multi-step flow that mirrors the iOS Send screens in the website's
 * brand language:
 *
 *   amount  →  recipient  →  review  →  (slide to send)  →  success | failure
 *
 * Amount entry is a big AmountDisplay-style headline you can type with the
 * keyboard (desktop) or the on-screen Numpad (mobile). Recipient resolution is
 * debounced via resolveRecipient(), with recent contacts as quick chips. Money
 * moves only through useSignAndSend(); the API client surfaces server `code`s
 * (429 / LIMIT_EXCEEDED / SCREENING_BLOCK / BELOW_GASLESS_MINIMUM) which we map
 * to friendly inline copy.
 *
 * Deep-link prefill: ?to=&amount= seeds the recipient and amount so the public
 * /pay/<handle> link and Home quick-send can drop the user straight into review.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Alert02Icon,
  ArrowDown01Icon,
  ArrowUpRight01Icon,
  CheckmarkBadge01Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";
import {
  GlassCard,
  Eyebrow,
  MicroLabel,
  PrimaryButton,
  SlideToConfirm,
  Spinner,
  Numpad,
  useBalances,
  useContacts,
  useMe,
  useCurrency,
  useToast,
  useSignAndSend,
  resolveRecipient,
  ApiError,
  type Contact,
} from "@/components/app";
import { CoinBurst } from "@/components/app/anim/CoinBurst";

const EXPLORER = "https://suiscan.xyz/mainnet/tx/";

type Step = "amount" | "recipient" | "review" | "success" | "failure";

type Resolved = { address: string; displayName: string };

// ── Error copy ───────────────────────────────────────────────────────────────

/** Turn an ApiError into a short, friendly, actionable inline message. */
function friendlyError(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case "LIMIT_EXCEEDED":
        return "This send is over your current limit. Try a smaller amount.";
      case "SCREENING_BLOCK":
        return "We couldn't complete this transfer. Please contact support if this keeps happening.";
      case "BELOW_GASLESS_MINIMUM":
        return "That's below the minimum gasless send. Try a slightly larger amount.";
      case "NOT_SIGNED_IN":
        return "Sign in to continue — we'll bring you right back.";
      case "NETWORK":
        return "Network error — check your connection and try again.";
    }
    if (e.status === 429) return "You're going a little fast. Wait a moment and try again.";
    if (e.status === 401) return "Your session expired. Sign in again to send.";
    if (e.message) return e.message;
  }
  return "Something went wrong. No funds moved.";
}

// ── Amount math ───────────────────────────────────────────────────────────────

/** Group the integer part of a typed decimal string with thousands commas. */
function groupDigits(intPart: string): string {
  if (intPart.length <= 3 || !/^\d+$/.test(intPart)) return intPart;
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SendFlow() {
  const router = useRouter();
  const params = useSearchParams();
  const { data: balances } = useBalances();
  const { me } = useMe();
  const { symbol, formatLocal, toLocal, rate } = useCurrency();
  const { toast } = useToast();
  const { send, sending } = useSignAndSend();

  const [step, setStep] = useState<Step>("amount");
  // The raw typed string is in the user's DISPLAY currency (matches iOS).
  const [raw, setRaw] = useState("");
  const [recipientInput, setRecipientInput] = useState("");
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [resolving, setResolving] = useState(false);
  const [noMatch, setNoMatch] = useState(false);

  const [digest, setDigest] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resetSignal, setResetSignal] = useState(0);

  const { contacts } = useContacts();

  // Display-currency typed value → USD (USDsui). FX `rate` is local-per-USD.
  const typedLocal = raw ? parseFloat(raw) : 0;
  const amountUsd = useMemo(() => {
    if (!Number.isFinite(typedLocal) || typedLocal <= 0) return 0;
    return rate > 0 ? typedLocal / rate : typedLocal;
  }, [typedLocal, rate]);

  const available = balances?.usdsui ?? 0;
  const overBalance = amountUsd > 0 && amountUsd > available + 1e-9;
  const canReview = amountUsd > 0 && !overBalance;

  // ── Deep-link prefill (?to=&amount=) ──────────────────────────────────────
  // Recipient prefill is one-shot. Amount prefill is rate-aware: the link
  // amount is in USD, so we seed `raw` (a display-currency string) and re-seed
  // once live FX rates land — but only while the user hasn't typed yet, so we
  // never clobber their edits.
  const recipientPrefillDone = useRef(false);
  const userTouchedAmount = useRef(false);
  const linkAmountUsd = useMemo(() => {
    const amt = params.get("amount");
    if (amt && /^\d*\.?\d*$/.test(amt)) {
      const v = parseFloat(amt);
      if (Number.isFinite(v) && v > 0) return v;
    }
    return null;
  }, [params]);

  useEffect(() => {
    if (userTouchedAmount.current || linkAmountUsd == null) return;
    const local = rate > 0 ? linkAmountUsd * rate : linkAmountUsd;
    setRaw(local % 1 === 0 ? String(Math.round(local)) : local.toFixed(2));
  }, [linkAmountUsd, rate]);

  useEffect(() => {
    if (recipientPrefillDone.current) return;
    const to = params.get("to");
    if (to) {
      recipientPrefillDone.current = true;
      setRecipientInput(to);
      void runResolve(to, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  // ── Keyboard amount entry (desktop) ───────────────────────────────────────
  const onAmountKey = useCallback((d: string) => {
    userTouchedAmount.current = true;
    setRaw((prev) => {
      if (d === ".") {
        if (prev.includes(".")) return prev;
        return prev === "" ? "0." : prev + ".";
      }
      // limit to 2 decimal places
      const dot = prev.indexOf(".");
      if (dot >= 0 && prev.length - dot > 2) return prev;
      if (prev === "0" && d !== ".") return d;
      if (prev.length >= 12) return prev;
      return prev + d;
    });
  }, []);
  const onBackspace = useCallback(() => {
    userTouchedAmount.current = true;
    setRaw((p) => p.slice(0, -1));
  }, []);

  useEffect(() => {
    if (step !== "amount") return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key)) {
        onAmountKey(e.key);
      } else if (e.key === ".") {
        onAmountKey(".");
      } else if (e.key === "Backspace") {
        onBackspace();
      } else if (e.key === "Enter" && canReview) {
        setStep("recipient");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [step, onAmountKey, onBackspace, canReview]);

  const setMax = useCallback(() => {
    if (available <= 0) return;
    userTouchedAmount.current = true;
    const local = toLocal(available);
    setRaw(local.toFixed(2));
  }, [available, toLocal]);

  // ── Recipient resolution (debounced) ──────────────────────────────────────
  const resolveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resolveSeq = useRef(0);

  const runResolve = useCallback(async (qRaw: string, immediate = false) => {
    const q = qRaw.trim();
    setResolved(null);
    setNoMatch(false);
    if (resolveTimer.current) clearTimeout(resolveTimer.current);
    if (q.length < 3) {
      setResolving(false);
      return;
    }
    // A raw 0x address resolves to itself instantly (no round trip).
    if (/^0x[0-9a-fA-F]{6,}$/.test(q)) {
      setResolved({ address: q, displayName: `${q.slice(0, 8)}…${q.slice(-6)}` });
      setResolving(false);
      return;
    }
    const seq = ++resolveSeq.current;
    setResolving(true);
    const fire = async () => {
      try {
        const r = await resolveRecipient(q);
        if (seq !== resolveSeq.current) return;
        setResolved(r);
        setNoMatch(false);
      } catch {
        if (seq !== resolveSeq.current) return;
        setResolved(null);
        setNoMatch(true);
      } finally {
        if (seq === resolveSeq.current) setResolving(false);
      }
    };
    if (immediate) {
      await fire();
    } else {
      resolveTimer.current = setTimeout(fire, 280);
    }
  }, []);

  const onRecipientChange = useCallback(
    (v: string) => {
      setRecipientInput(v);
      void runResolve(v);
    },
    [runResolve]
  );

  const pickContact = useCallback(
    (c: Contact) => {
      if (resolveTimer.current) clearTimeout(resolveTimer.current);
      resolveSeq.current++; // invalidate any pending resolve
      setResolving(false);
      setNoMatch(false);
      setRecipientInput(c.name ?? c.address);
      setResolved({
        address: c.address,
        displayName: c.name ?? `${c.address.slice(0, 8)}…${c.address.slice(-6)}`,
      });
      setStep("review");
    },
    []
  );

  // ── Confirm ────────────────────────────────────────────────────────────────
  const onConfirm = useCallback(async () => {
    if (!resolved) return;
    setErrorMsg(null);
    try {
      const { digest: d } = await send({ to: resolved.address, amountUsd });
      setDigest(d);
      setStep("success");
    } catch (e) {
      // NOT_SIGNED_IN bounces to OAuth inside useSignAndSend — don't show a
      // failure screen for that, just let the redirect happen.
      if (e instanceof ApiError && e.code === "NOT_SIGNED_IN") return;
      setErrorMsg(friendlyError(e));
      setStep("failure");
      throw e; // let SlideToConfirm spring back
    }
  }, [resolved, amountUsd, send]);

  const resetAll = useCallback(() => {
    setStep("amount");
    setRaw("");
    setRecipientInput("");
    setResolved(null);
    setNoMatch(false);
    setDigest(null);
    setErrorMsg(null);
    setResetSignal((s) => s + 1);
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────
  const recentContacts = contacts.slice(0, 8);

  return (
    <div className="mx-auto w-full max-w-md">
      {step === "amount" && (
        <AmountStep
          raw={raw}
          symbol={symbol}
          amountUsd={amountUsd}
          overBalance={overBalance}
          available={available}
          availableLabel={formatLocal(available)}
          canReview={canReview}
          onKey={onAmountKey}
          onBackspace={onBackspace}
          onMax={setMax}
          onNext={() => setStep("recipient")}
          onCancel={() => router.push("/app")}
        />
      )}

      {step === "recipient" && (
        <RecipientStep
          value={recipientInput}
          resolving={resolving}
          resolved={resolved}
          noMatch={noMatch}
          contacts={recentContacts}
          onChange={onRecipientChange}
          onClear={() => onRecipientChange("")}
          onPickContact={pickContact}
          onBack={() => setStep("amount")}
          onNext={() => setStep("review")}
        />
      )}

      {step === "review" && resolved && (
        <ReviewStep
          amountUsd={amountUsd}
          fromHandle={me?.taliseHandle ? `@${me.taliseHandle}` : "your wallet"}
          fromAddress={me?.suiAddress ?? ""}
          to={resolved}
          sending={sending}
          resetSignal={resetSignal}
          onConfirm={onConfirm}
          onBack={() => setStep("recipient")}
        />
      )}

      {step === "success" && digest && (
        <SuccessStep
          amountUsd={amountUsd}
          to={resolved}
          digest={digest}
          onShareCopied={() => toast("Receipt link copied", "success")}
          onDone={() => router.push("/app")}
          onAgain={resetAll}
        />
      )}

      {step === "failure" && (
        <FailureStep
          message={errorMsg}
          onTryAgain={() => {
            setErrorMsg(null);
            setResetSignal((s) => s + 1);
            setStep("review");
          }}
          onDone={() => router.push("/app")}
        />
      )}
    </div>
  );
}

// ── Step header ───────────────────────────────────────────────────────────────

function StepHeader({
  eyebrow,
  onBack,
  onCancel,
}: {
  eyebrow: string;
  onBack?: () => void;
  onCancel?: () => void;
}) {
  return (
    <div className="mb-6 flex items-center justify-between">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="talise-glass flex size-9 items-center justify-center rounded-full text-fg transition-colors hover:border-[color-mix(in_srgb,var(--color-accent-deep)_40%,var(--color-line))]"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} size={18} strokeWidth={2} />
        </button>
      ) : (
        <span className="size-9" />
      )}
      <Eyebrow>{eyebrow}</Eyebrow>
      {onCancel ? (
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel"
          className="talise-glass flex size-9 items-center justify-center rounded-full text-fg-muted transition-colors hover:border-[color-mix(in_srgb,var(--color-accent-deep)_40%,var(--color-line))]"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={16} strokeWidth={2} />
        </button>
      ) : (
        <span className="size-9" />
      )}
    </div>
  );
}

// ── Step 1: Amount ─────────────────────────────────────────────────────────────

function AmountStep({
  raw,
  symbol,
  amountUsd,
  overBalance,
  available,
  availableLabel,
  canReview,
  onKey,
  onBackspace,
  onMax,
  onNext,
  onCancel,
}: {
  raw: string;
  symbol: string;
  amountUsd: number;
  overBalance: boolean;
  available: number;
  availableLabel: string;
  canReview: boolean;
  onKey: (d: string) => void;
  onBackspace: () => void;
  onMax: () => void;
  onNext: () => void;
  onCancel: () => void;
}) {
  const display = useMemo(() => {
    if (!raw) return "0";
    const dot = raw.indexOf(".");
    if (dot >= 0) return `${groupDigits(raw.slice(0, dot))}.${raw.slice(dot + 1)}`;
    return groupDigits(raw);
  }, [raw]);

  const usdsuiLine = `${amountUsd.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} USDsui`;

  return (
    <div>
      <StepHeader eyebrow="Send" onCancel={onCancel} />

      {/* Amount headline */}
      <div className="flex flex-col items-center pb-2 pt-4 text-center">
        <div className="flex items-baseline justify-center gap-1.5">
          <span
            className="font-display font-light text-fg-muted"
            style={{ fontSize: 40, letterSpacing: "-0.02em" }}
          >
            {symbol}
          </span>
          <span
            className={`font-display font-semibold tabular-nums ${
              overBalance ? "text-[var(--color-danger)]" : "text-fg"
            }`}
            style={{ fontSize: 64, lineHeight: 1.02, letterSpacing: "-0.04em" }}
          >
            {display}
          </span>
        </div>
        <span className="mt-3 font-mono text-[12px] tabular-nums text-fg-dim">{usdsuiLine}</span>
        {overBalance && (
          <span className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-danger)]">
            Over available balance
          </span>
        )}
      </div>

      {/* Wallet pill + MAX */}
      <div className="mt-4 mb-6 flex items-center justify-center gap-2">
        <span className="talise-glass inline-flex items-center gap-2 rounded-full px-3.5 py-1.5">
          <span className="size-1.5 rounded-full" style={{ background: "var(--color-accent)" }} />
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg">
            Main wallet
          </span>
          <span className="font-mono text-[10px] text-fg-dim">· {availableLabel}</span>
        </span>
        <button
          type="button"
          onClick={onMax}
          disabled={available <= 0}
          className="talise-glass rounded-full px-3 py-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-accent transition-colors hover:border-[color-mix(in_srgb,var(--color-accent-deep)_40%,var(--color-line))] disabled:opacity-40"
        >
          Max
        </button>
      </div>

      {/* Numpad — shown on mobile; desktop users can type with the keyboard. */}
      <Numpad onKey={onKey} onBackspace={onBackspace} className="lg:hidden" />
      <p className="mt-1 hidden text-center text-[12px] text-fg-dim lg:block">
        Type an amount, then press Enter to continue.
      </p>

      <div className="mt-6">
        <PrimaryButton full disabled={!canReview} onClick={onNext}>
          Review
        </PrimaryButton>
      </div>
    </div>
  );
}

// ── Step 2: Recipient ───────────────────────────────────────────────────────────

function contactInitials(c: Contact): string {
  const src = (c.name ?? c.address).replace(/@?talise\.sui|\.sui/gi, "");
  const parts = src.trim().split(/\s+/);
  if (parts.length >= 2 && parts[0][0] && parts[1][0]) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  const trimmed = src.replace(/^0x/i, "");
  return trimmed.slice(0, 2).toUpperCase();
}

function RecipientStep({
  value,
  resolving,
  resolved,
  noMatch,
  contacts,
  onChange,
  onClear,
  onPickContact,
  onBack,
  onNext,
}: {
  value: string;
  resolving: boolean;
  resolved: Resolved | null;
  noMatch: boolean;
  contacts: Contact[];
  onChange: (v: string) => void;
  onClear: () => void;
  onPickContact: (c: Contact) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div>
      <StepHeader eyebrow="Send to" onBack={onBack} />

      {/* Input */}
      <GlassCard radius={20} className="px-4 py-3.5">
        <Eyebrow className="mb-1.5 block">To</Eyebrow>
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && resolved) onNext();
            }}
            placeholder="alice · 0x6487… · alice.sui"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className="w-full bg-transparent text-[16px] text-fg outline-none placeholder:text-fg-dim"
          />
          {value && (
            <button
              type="button"
              onClick={onClear}
              aria-label="Clear"
              className="flex size-6 shrink-0 items-center justify-center rounded-full text-fg-dim transition-colors hover:bg-accent-soft hover:text-fg"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={2} />
            </button>
          )}
        </div>
      </GlassCard>

      {/* Resolve status */}
      <div className="mt-3 min-h-[20px] px-1">
        {resolving ? (
          <span className="inline-flex items-center gap-2 text-fg-dim">
            <Spinner size={13} />
            <MicroLabel>Resolving…</MicroLabel>
          </span>
        ) : resolved ? (
          <span className="inline-flex items-center gap-1.5">
            <HugeiconsIcon
              icon={CheckmarkCircle02Icon}
              size={14}
              color="var(--color-accent)"
              strokeWidth={2}
            />
            <span className="font-mono text-[11px] text-accent">{resolved.displayName}</span>
            <span className="font-mono text-[10px] text-fg-dim">
              {resolved.address.slice(0, 8)}…{resolved.address.slice(-6)}
            </span>
          </span>
        ) : noMatch && value.trim().length >= 3 ? (
          <span className="inline-flex items-center gap-1.5">
            <HugeiconsIcon
              icon={Alert02Icon}
              size={14}
              color="var(--color-danger)"
              strokeWidth={2}
            />
            <span className="font-mono text-[11px] text-[var(--color-danger)]">
              No match for &ldquo;{value.trim()}&rdquo;
            </span>
          </span>
        ) : null}
      </div>

      {/* Recent contacts */}
      <div className="mt-7">
        <Eyebrow className="mb-3 block">Recent</Eyebrow>
        {contacts.length === 0 ? (
          <p className="text-[13px] text-fg-dim">
            No recent recipients yet — your first send will appear here.
          </p>
        ) : (
          <div className="flex flex-col">
            {contacts.map((c) => (
              <button
                key={c.address}
                type="button"
                onClick={() => onPickContact(c)}
                className="flex items-center gap-3 rounded-2xl px-2 py-2.5 text-left transition-colors hover:bg-accent-soft"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-2 font-display text-[12px] font-semibold text-fg">
                  {contactInitials(c)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-fg">
                    {c.name ?? `${c.address.slice(0, 8)}…${c.address.slice(-6)}`}
                  </span>
                  <span className="block truncate font-mono text-[10px] text-fg-dim">
                    {c.address.slice(0, 10)}…{c.address.slice(-6)}
                  </span>
                </span>
                {c.sentCount > 0 && (
                  <span className="shrink-0 font-mono text-[10px] text-fg-dim">
                    {c.sentCount} sent
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-8">
        <PrimaryButton full disabled={!resolved} onClick={onNext}>
          Continue
        </PrimaryButton>
      </div>
    </div>
  );
}

// ── Step 3: Review ──────────────────────────────────────────────────────────────

function ReviewStep({
  amountUsd,
  fromHandle,
  fromAddress,
  to,
  sending,
  resetSignal,
  onConfirm,
  onBack,
}: {
  amountUsd: number;
  fromHandle: string;
  fromAddress: string;
  to: Resolved;
  sending: boolean;
  resetSignal: number;
  onConfirm: () => Promise<void>;
  onBack: () => void;
}) {
  const { formatUsd } = useCurrency();
  const usdsuiLine = `${amountUsd.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} USDsui`;

  return (
    <div>
      <StepHeader eyebrow="Review" onBack={onBack} />

      <h2
        className="mb-6 text-center font-display text-[24px] font-semibold text-fg"
        style={{ letterSpacing: "-0.03em" }}
      >
        Review send
      </h2>

      <div className="space-y-2">
        {/* From card */}
        <GlassCard radius={22} className="px-5 py-5">
          <Eyebrow className="mb-2 block">From {fromHandle}</Eyebrow>
          <div
            className="font-display font-semibold tabular-nums text-fg"
            style={{ fontSize: 36, letterSpacing: "-0.03em", lineHeight: 1.05 }}
          >
            {formatUsd(amountUsd)}
          </div>
          <div className="mt-1 font-mono text-[12px] text-fg-dim">{usdsuiLine}</div>
        </GlassCard>

        {/* Arrow */}
        <div className="flex justify-center">
          <span className="talise-glass flex size-8 items-center justify-center rounded-full text-fg-muted">
            <HugeiconsIcon icon={ArrowDown01Icon} size={16} strokeWidth={2} />
          </span>
        </div>

        {/* To card */}
        <GlassCard radius={22} className="px-5 py-5">
          <Eyebrow className="mb-2 block">To</Eyebrow>
          <div
            className="truncate font-display text-[20px] font-semibold text-fg"
            style={{ letterSpacing: "-0.02em" }}
          >
            {to.displayName}
          </div>
          <div className="mt-1 font-mono text-[11px] text-fg-dim">
            {to.address.slice(0, 10)}…{to.address.slice(-8)}
          </div>
        </GlassCard>
      </div>

      {/* Fee line */}
      <div className="mt-5 flex items-center justify-center gap-1.5">
        <HugeiconsIcon
          icon={CheckmarkBadge01Icon}
          size={14}
          color="var(--color-accent)"
          strokeWidth={2}
        />
        <span className="font-mono text-[11px] text-fg-muted">
          No network fee — sponsored by Talise.
        </span>
      </div>

      <div className="mt-7">
        <SlideToConfirm
          label="Slide to send"
          onConfirm={onConfirm}
          disabled={sending}
          resetSignal={resetSignal}
        />
      </div>
    </div>
  );
}

// ── Step 4: Success ─────────────────────────────────────────────────────────────

function SuccessStep({
  amountUsd,
  to,
  digest,
  onShareCopied,
  onDone,
  onAgain,
}: {
  amountUsd: number;
  to: Resolved | null;
  digest: string;
  onShareCopied: () => void;
  onDone: () => void;
  onAgain: () => void;
}) {
  const { formatUsd } = useCurrency();
  const explorerUrl = `${EXPLORER}${digest}`;

  const copyReceipt = async () => {
    try {
      await navigator.clipboard.writeText(explorerUrl);
      onShareCopied();
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="flex flex-col items-center pt-6 text-center">
      {/* Coins drop + scatter + settle over the amount — the web port of the
          iOS send-success coin drop. Plays once on mount. */}
      <CoinBurst size={148} />

      <Eyebrow>Sent</Eyebrow>
      <div
        className="mt-3 font-display font-semibold tabular-nums text-fg"
        style={{ fontSize: 44, letterSpacing: "-0.04em" }}
      >
        {formatUsd(amountUsd)}
      </div>
      {to && (
        <p className="mt-2 text-[14px] text-fg-muted">
          to <span className="text-fg">{to.displayName}</span>
        </p>
      )}
      <p className="mt-1 font-mono text-[11px] text-accent">Arrives in &lt;1s</p>

      <div className="mt-8 flex w-full flex-col gap-2.5">
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="talise-glass inline-flex w-full items-center justify-center gap-2 rounded-full px-6 py-3 text-[14px] font-medium text-fg transition-colors hover:border-[color-mix(in_srgb,var(--color-accent-deep)_40%,var(--color-line))]"
        >
          View on Suiscan
          <HugeiconsIcon icon={ArrowUpRight01Icon} size={15} strokeWidth={2} />
        </a>
        <button
          type="button"
          onClick={copyReceipt}
          className="text-[13px] font-medium text-fg-dim transition-colors hover:text-fg"
        >
          Copy receipt link
        </button>
      </div>

      <div className="mt-8 flex w-full flex-col gap-2.5">
        <PrimaryButton full onClick={onDone}>
          Done
        </PrimaryButton>
        <PrimaryButton full variant="ghost" onClick={onAgain}>
          <HugeiconsIcon icon={PlusSignIcon} size={15} strokeWidth={2} />
          Send another
        </PrimaryButton>
      </div>
    </div>
  );
}

// ── Step 5: Failure ─────────────────────────────────────────────────────────────

function FailureStep({
  message,
  onTryAgain,
  onDone,
}: {
  message: string | null;
  onTryAgain: () => void;
  onDone: () => void;
}) {
  return (
    <div className="flex flex-col items-center pt-6 text-center">
      <span
        className="mb-6 flex size-20 items-center justify-center rounded-full"
        style={{ background: "color-mix(in srgb, var(--color-danger) 16%, transparent)" }}
      >
        <HugeiconsIcon
          icon={Alert02Icon}
          size={42}
          color="var(--color-danger)"
          strokeWidth={2}
        />
      </span>

      <h2
        className="font-display text-[28px] font-semibold text-fg"
        style={{ letterSpacing: "-0.03em" }}
      >
        Send failed
      </h2>
      <p className="mt-2 max-w-xs text-[14px] text-fg-muted">No funds moved.</p>
      {message && <p className="mt-2 max-w-xs text-[13px] text-fg-dim">{message}</p>}

      <div className="mt-8 flex w-full flex-col gap-2.5">
        <PrimaryButton full onClick={onTryAgain}>
          Try again
        </PrimaryButton>
        <PrimaryButton full variant="ghost" onClick={onDone}>
          Done
        </PrimaryButton>
      </div>
    </div>
  );
}

export default SendFlow;
