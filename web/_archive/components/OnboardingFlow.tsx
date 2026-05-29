"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useMemo, useState } from "react";

type Step = "choose" | "personal-details" | "business-details" | "ready";

// 8 chars · uppercase letters + digits · no ambiguous (O 0 I 1 L). Mirrors
// `REFERRAL_CODE_RE` in `lib/db.ts`.
const REFERRAL_CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;

export function OnboardingFlow() {
  const [step, setStep] = useState<Step>("choose");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [referralCode, setReferralCode] = useState("");

  // Pre-fill the referral field from the httpOnly cookie set by the landing
  // page's `<Hero>` if the visitor arrived via `?ref=`.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/referral/cookie")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { code?: string | null } | null) => {
        if (cancelled) return;
        const c = (j?.code ?? "").trim().toUpperCase();
        if (REFERRAL_CODE_RE.test(c)) setReferralCode(c);
      })
      .catch(() => {
        /* ignore */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <Stepper step={step} />

      <AnimatePresence mode="wait">
        {step === "choose" && (
          <motion.div
            key="choose"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3 }}
            className="mt-10 grid gap-5 md:grid-cols-2"
          >
            <Choice
              tag="Personal"
              title="I'm sending and saving money."
              points={[
                "Pay friends and family",
                "Hold dollars (USDsui), bitcoin, SUI",
                "Earn yield on idle USDsui",
                "On-chain payment receipts",
              ]}
              onClick={() => setStep("personal-details")}
              cta="Use as personal →"
            />
            <Choice
              tag="Business"
              title="I'm receiving payments."
              points={[
                "Accept stablecoins from customers",
                "Generate payment links + QR codes",
                "Settle in USDsui instantly",
                "Sub-cent fees, sub-second settlement",
              ]}
              onClick={() => setStep("business-details")}
              cta="Use as business →"
              inverse
            />
          </motion.div>
        )}

        {step === "personal-details" && (
          <motion.div
            key="personal"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3 }}
            className="mt-10"
          >
            <PersonalDetails
              onBack={() => setStep("choose")}
              onDone={() => setStep("ready")}
              setErr={setErr}
              submitting={submitting}
              setSubmitting={setSubmitting}
              referralCode={referralCode}
              setReferralCode={setReferralCode}
            />
          </motion.div>
        )}

        {step === "business-details" && (
          <motion.div
            key="business"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3 }}
            className="mt-10"
          >
            <BusinessDetails
              onBack={() => setStep("choose")}
              onDone={() => setStep("ready")}
              setErr={setErr}
              submitting={submitting}
              setSubmitting={setSubmitting}
              referralCode={referralCode}
              setReferralCode={setReferralCode}
            />
          </motion.div>
        )}

        {step === "ready" && (
          <motion.div
            key="ready"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="mt-10"
          />
        )}
      </AnimatePresence>

      {err && (
        <p className="mt-6 text-[12px] text-[var(--color-fg)]">! {err}</p>
      )}
    </div>
  );
}

function Stepper({ step }: { step: Step }) {
  const idx =
    step === "choose"
      ? 0
      : step === "personal-details" || step === "business-details"
        ? 1
        : 2;
  return (
    <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[var(--color-fg-dim)]">
      <StepDot label="Choose" active={idx >= 0} done={idx > 0} />
      <Bar done={idx > 0} />
      <StepDot label="Details" active={idx >= 1} done={idx > 1} />
      <Bar done={idx > 1} />
      <StepDot label="Ready" active={idx >= 2} done={false} />
    </div>
  );
}

function StepDot({
  label,
  active,
  done,
}: {
  label: string;
  active: boolean;
  done: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] ${
          done
            ? "border-[var(--color-fg)] bg-[var(--color-fg)] text-[var(--color-bg)]"
            : active
              ? "border-[var(--color-fg)] text-[var(--color-fg)]"
              : "border-[var(--color-line)] text-[var(--color-fg-dim)]"
        }`}
      >
        {done ? "✓" : ""}
      </span>
      <span className={active ? "text-[var(--color-fg)]" : ""}>{label}</span>
    </div>
  );
}

function Bar({ done }: { done: boolean }) {
  return (
    <span
      className={`h-px w-8 ${done ? "bg-[var(--color-fg)]" : "bg-[var(--color-line)]"}`}
    />
  );
}

function Choice({
  tag,
  title,
  points,
  cta,
  onClick,
  inverse,
}: {
  tag: string;
  title: string;
  points: string[];
  cta: string;
  onClick: () => void;
  inverse?: boolean;
}) {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ y: -3 }}
      transition={{ duration: 0.2 }}
      className={`group h-full rounded-2xl border p-7 text-left transition ${
        inverse
          ? "border-[var(--color-fg)] bg-[var(--color-fg)] text-[var(--color-bg)] hover:bg-[var(--color-accent-soft)]"
          : "border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-fg)] hover:border-[var(--color-fg)]"
      }`}
    >
      <div
        className={`text-[10px] uppercase tracking-[0.22em] ${
          inverse ? "text-[var(--color-bg)]/60" : "text-[var(--color-fg-dim)]"
        }`}
      >
        {tag}
      </div>
      <div className="mt-4 font-display text-[26px] leading-[1.15] tracking-[-0.02em]">
        {title}
      </div>
      <ul
        className={`mt-6 space-y-2.5 text-[14px] ${
          inverse ? "text-[var(--color-bg)]/80" : "text-[var(--color-fg-muted)]"
        }`}
      >
        {points.map((p, i) => (
          <li key={i} className="flex items-start gap-3">
            <span
              className={`mt-1.5 inline-block h-1 w-3 ${
                inverse ? "bg-[var(--color-bg)]/40" : "bg-[var(--color-fg-dim)]"
              }`}
            />
            {p}
          </li>
        ))}
      </ul>
      <div
        className={`mt-8 inline-flex items-center gap-2 text-[13px] ${
          inverse ? "text-[var(--color-bg)]" : "text-[var(--color-fg)]"
        }`}
      >
        {cta}
      </div>
    </motion.button>
  );
}

// --- Personal flow ---------------------------------------------------------

const PERSONAL_INTERESTS = [
  { key: "remit", label: "Send to family abroad" },
  { key: "save", label: "Save in USD / gold" },
  { key: "spend", label: "Spend at merchants" },
  { key: "earn", label: "Earn yield on idle balance" },
];

function PersonalDetails({
  onBack,
  onDone,
  setErr,
  submitting,
  setSubmitting,
  referralCode,
  setReferralCode,
}: {
  onBack: () => void;
  onDone: () => void;
  setErr: (s: string | null) => void;
  submitting: boolean;
  setSubmitting: (b: boolean) => void;
  referralCode: string;
  setReferralCode: (s: string) => void;
}) {
  const [interests, setInterests] = useState<string[]>([]);
  const [country, setCountry] = useState("");
  const [notify, setNotify] = useState(true);
  const referralValid =
    referralCode.length === 0 || REFERRAL_CODE_RE.test(referralCode);

  function toggle(k: string) {
    setInterests((cur) =>
      cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    try {
      const r = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountType: "personal",
          interests,
          country: country.trim() || null,
          notify,
          referralCode: referralCode.trim() || null,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "failed");
      onDone();
      window.location.href = "/home";
    } catch (e) {
      setErr((e as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="max-w-2xl">
      <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--color-fg-dim)]">
        Personal
      </div>
      <h2 className="mt-3 font-display text-[28px] leading-[1.15] tracking-[-0.02em]">
        A bit about you.
      </h2>
      <p className="mt-2 text-[14px] text-[var(--color-fg-muted)]">
        We tune the interface for what you actually use Talise for.
      </p>

      <div className="mt-8 space-y-7">
        <div>
          <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--color-fg-dim)]">
            What will you use Talise for? (pick any)
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {PERSONAL_INTERESTS.map((it) => {
              const on = interests.includes(it.key);
              return (
                <button
                  key={it.key}
                  type="button"
                  onClick={() => toggle(it.key)}
                  className={`rounded-full border px-4 py-2 text-[13px] transition ${
                    on
                      ? "border-[var(--color-fg)] bg-[var(--color-fg)] text-[var(--color-bg)]"
                      : "border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-fg)] hover:border-[var(--color-fg)]"
                  }`}
                >
                  {it.label}
                </button>
              );
            })}
          </div>
        </div>

        <Field label="Where are you based? (optional)">
          <input
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            placeholder="Buenos Aires · Lagos · Manila · NYC"
            className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-3 text-[15px] text-[var(--color-fg)] placeholder:text-[var(--color-fg-dim)] focus:border-[var(--color-fg)] focus:outline-none"
          />
          <p className="mt-2 text-[11px] text-[var(--color-fg-dim)]">
            Helps us prioritize local rails (onramps, off-ramps, partners).
          </p>
        </Field>

        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
          <input
            type="checkbox"
            checked={notify}
            onChange={(e) => setNotify(e.target.checked)}
            className="mt-1 h-4 w-4 accent-[var(--color-fg)]"
          />
          <div>
            <div className="text-[14px] text-[var(--color-fg)]">
              Email me when I receive payments
            </div>
            <div className="mt-0.5 text-[12px] text-[var(--color-fg-muted)]">
              We send a one-line confirmation with a Suiscan link. No marketing.
            </div>
          </div>
        </label>

        <ReferralField
          value={referralCode}
          onChange={setReferralCode}
          valid={referralValid}
        />
      </div>

      <div className="mt-10 flex items-center gap-4">
        <button
          type="submit"
          disabled={submitting || !referralValid}
          className="rounded-md bg-[var(--color-fg)] px-5 py-3 text-[14px] font-medium text-[var(--color-bg)] transition hover:bg-[var(--color-accent-soft)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? "…" : "Create personal account →"}
        </button>
        <button
          type="button"
          onClick={onBack}
          className="text-[13px] text-[var(--color-fg-muted)] underline-offset-4 hover:text-[var(--color-fg)] hover:underline"
        >
          ← back
        </button>
      </div>
    </form>
  );
}

// --- Business flow ---------------------------------------------------------

const BUSINESS_INDUSTRIES = [
  "Café · Restaurant",
  "Salon · Spa",
  "Retail · E-commerce",
  "Freelance · Consulting",
  "SaaS · Software",
  "Creator · Subscription",
  "Marketplace · Other",
];

function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

function BusinessDetails({
  onBack,
  onDone,
  setErr,
  submitting,
  setSubmitting,
  referralCode,
  setReferralCode,
}: {
  onBack: () => void;
  onDone: () => void;
  setErr: (s: string | null) => void;
  submitting: boolean;
  setSubmitting: (b: boolean) => void;
  referralCode: string;
  setReferralCode: (s: string) => void;
}) {
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [industry, setIndustry] = useState("");
  const [country, setCountry] = useState("");
  const referralValid =
    referralCode.length === 0 || REFERRAL_CODE_RE.test(referralCode);

  // Auto-derive handle from business name unless user has typed their own.
  const autoHandle = useMemo(() => slugify(name), [name]);
  const effectiveHandle = handle || autoHandle;

  useEffect(() => {
    if (!handle && autoHandle) {
      // Keep slot in sync but don't override manual edits.
    }
  }, [handle, autoHandle]);

  const ready = name.trim().length >= 2 && effectiveHandle.length >= 2;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    try {
      const r = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountType: "business",
          businessName: name.trim(),
          businessHandle: effectiveHandle,
          businessIndustry: industry.trim() || null,
          country: country.trim() || null,
          referralCode: referralCode.trim() || null,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "failed");
      onDone();
      window.location.href = "/business";
    } catch (e) {
      setErr((e as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="max-w-2xl">
      <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--color-fg-dim)]">
        Business
      </div>
      <h2 className="mt-3 font-display text-[28px] leading-[1.15] tracking-[-0.02em]">
        Tell us about the business.
      </h2>
      <p className="mt-2 text-[14px] text-[var(--color-fg-muted)]">
        Customers will pay you at{" "}
        <span className="font-mono text-[var(--color-fg)]">
          talise.io/p/{effectiveHandle || "your-handle"}
        </span>
        . Every payment settles directly to your non-custodial Sui address.
      </p>

      <div className="mt-8 space-y-6">
        <Field label="Business name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Café Sole"
            autoFocus
            className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-3 text-[15px] text-[var(--color-fg)] placeholder:text-[var(--color-fg-dim)] focus:border-[var(--color-fg)] focus:outline-none"
          />
        </Field>

        <Field label="Payment handle">
          <div className="flex items-center gap-2">
            <span className="text-[14px] text-[var(--color-fg-dim)]">talise.io/p/</span>
            <input
              value={handle || autoHandle}
              onChange={(e) => setHandle(slugify(e.target.value))}
              placeholder="cafe-sole"
              className="flex-1 rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-3 font-mono text-[14px] text-[var(--color-fg)] placeholder:text-[var(--color-fg-dim)] focus:border-[var(--color-fg)] focus:outline-none"
            />
          </div>
          <p className="mt-2 text-[11px] text-[var(--color-fg-dim)]">
            2–32 chars, a–z, 0–9, hyphens. Auto-suggested from your name.
          </p>
        </Field>

        <div>
          <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--color-fg-dim)]">
            Industry (optional)
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {BUSINESS_INDUSTRIES.map((it) => {
              const on = industry === it;
              return (
                <button
                  key={it}
                  type="button"
                  onClick={() => setIndustry(on ? "" : it)}
                  className={`rounded-full border px-3.5 py-1.5 text-[12px] transition ${
                    on
                      ? "border-[var(--color-fg)] bg-[var(--color-fg)] text-[var(--color-bg)]"
                      : "border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-fg-muted)] hover:border-[var(--color-fg)] hover:text-[var(--color-fg)]"
                  }`}
                >
                  {it}
                </button>
              );
            })}
          </div>
        </div>

        <Field label="Operating country (optional)">
          <input
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            placeholder="Argentina · Nigeria · Philippines · USA"
            className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-3 text-[15px] text-[var(--color-fg)] placeholder:text-[var(--color-fg-dim)] focus:border-[var(--color-fg)] focus:outline-none"
          />
          <p className="mt-2 text-[11px] text-[var(--color-fg-dim)]">
            Helps us prioritize local on/off-ramp partners.
          </p>
        </Field>

        <ReferralField
          value={referralCode}
          onChange={setReferralCode}
          valid={referralValid}
        />
      </div>

      <div className="mt-10 flex items-center gap-4">
        <button
          type="submit"
          disabled={!ready || submitting || !referralValid}
          className="rounded-md bg-[var(--color-fg)] px-5 py-3 text-[14px] font-medium text-[var(--color-bg)] transition hover:bg-[var(--color-accent-soft)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? "…" : "Create business account →"}
        </button>
        <button
          type="button"
          onClick={onBack}
          className="text-[13px] text-[var(--color-fg-muted)] underline-offset-4 hover:text-[var(--color-fg)] hover:underline"
        >
          ← back
        </button>
      </div>
    </form>
  );
}

function ReferralField({
  value,
  onChange,
  valid,
}: {
  value: string;
  onChange: (s: string) => void;
  valid: boolean;
}) {
  return (
    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--color-fg-dim)]">
        Referral code (optional)
      </div>
      <input
        value={value}
        onChange={(e) => {
          // Accept any case, strip whitespace, uppercase. Limit to 8.
          const next = e.target.value
            .replace(/\s+/g, "")
            .toUpperCase()
            .slice(0, 8);
          onChange(next);
        }}
        placeholder="e.g. EMMA4F2K"
        spellCheck={false}
        autoComplete="off"
        className="mt-2 w-full rounded-md border border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-2.5 font-mono text-[14px] tracking-[0.18em] text-[var(--color-fg)] placeholder:text-[var(--color-fg-dim)] focus:border-[var(--color-fg)] focus:outline-none"
      />
      {value.length > 0 && !valid ? (
        <p className="mt-2 text-[11px] text-[var(--color-fg)]">
          Codes are 8 characters · A–Z and digits (no O, 0, I, 1, L).
        </p>
      ) : (
        <p className="mt-2 text-[11px] text-[var(--color-fg-dim)]">
          Got invited? Drop the code — you both earn points.
        </p>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-2 text-[11px] uppercase tracking-[0.16em] text-[var(--color-fg-dim)]">
        {label}
      </div>
      {children}
    </label>
  );
}
