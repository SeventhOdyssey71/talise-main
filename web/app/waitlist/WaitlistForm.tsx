"use client";

import { useState } from "react";

/**
 * Waitlist form. Pure client component because the only behavior is
 * POST /api/waitlist + the success/error UI flip. No SSR concern.
 *
 * Layout (one viewport tall):
 *   Row 1  email pill + Join waitlist button (the only loud control).
 *   Row 2  three ghost-styled inputs inline (name, country, reason),
 *          all optional, none gate submission. No bordered container
 *          so they read as a quiet aside rather than a second form.
 */
type Status = "idle" | "submitting" | "ok" | "error";

const COUNTRIES = [
  "Nigeria",
  "Kenya",
  "Ghana",
  "South Africa",
  "UK",
  "US",
  "Other",
] as const;

const REASONS = [
  "Send money home",
  "Receive money",
  "Hold dollars",
  "Just curious",
] as const;

// Shared ghost-control styling. Transparent background, hairline
// border, picks up white on focus. Tuned to match the visual weight
// of the email pill above without competing with it.
const GHOST =
  "h-9 min-w-0 flex-1 rounded-full border border-white/10 bg-transparent px-3.5 text-[12.5px] text-white placeholder:text-white/40 transition-colors focus:border-white/30 focus:outline-none disabled:opacity-50";

export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [country, setCountry] = useState("");
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === "submitting") return;
    setStatus("submitting");
    setError("");
    try {
      const r = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          source: "landing",
          name: name.trim() || undefined,
          country: country || undefined,
          reason: reason || undefined,
        }),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || "Couldn't save your email. Try again.");
      }
      setStatus("ok");
    } catch (err) {
      setStatus("error");
      setError((err as Error).message);
    }
  }

  if (status === "ok") {
    return (
      <div
        className="flex flex-col items-center gap-1.5 rounded-2xl border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/[0.06] px-6 py-5 text-center"
        role="status"
        aria-live="polite"
      >
        <div className="text-[15px] font-medium text-white">
          You're on the list.
        </div>
        <div className="text-[12px] text-white/55">
          Check your inbox. We sent a quick confirmation from waitlist@talise.io.
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="waitlist-form flex flex-col gap-3"
      autoComplete="on"
      noValidate
    >
      {/* Scoped autofill override. Chrome paints :-webkit-autofill
          inputs with a yellow background that ignores the parent's
          rounded pill, visually bleeding past the container corners.
          Canonical fix: cancel the bg via a long transition delay,
          force the fill color to white, scoped via .waitlist-form. */}
      <style>{`
        .waitlist-form input:-webkit-autofill,
        .waitlist-form input:-webkit-autofill:hover,
        .waitlist-form input:-webkit-autofill:focus,
        .waitlist-form input:-webkit-autofill:active,
        .waitlist-form select:-webkit-autofill {
          -webkit-text-fill-color: #ffffff;
          -webkit-box-shadow: 0 0 0 1000px transparent inset;
          transition: background-color 9999s ease-in-out 0s;
          caret-color: #ffffff;
          background-clip: content-box !important;
        }
      `}</style>

      {/* Row 1: email + submit. The single loud control on this page. */}
      <label htmlFor="waitlist-email" className="sr-only">
        Email address
      </label>
      <div className="group flex items-stretch gap-2 rounded-full border border-white/15 bg-white/[0.04] p-1.5 transition-colors focus-within:border-white/40">
        <input
          id="waitlist-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (status === "error") setStatus("idle");
          }}
          className="flex-1 bg-transparent px-5 py-1 text-[15px] text-white placeholder:text-white/55 focus:outline-none"
          disabled={status === "submitting"}
        />
        <button
          type="submit"
          disabled={status === "submitting" || email.length === 0}
          className="whitespace-nowrap rounded-full bg-white px-5 py-2.5 text-[14px] font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {status === "submitting" ? "…" : "Join waitlist"}
        </button>
      </div>

      {/* Row 2: optional context, ghost-styled, no container chrome.
          A short hint + three inline pill-shaped controls. All three
          collapse to a stack on narrow screens but stay on one row at
          sm+ where horizontal room is plentiful. */}
      <div className="flex flex-col items-stretch gap-2 px-1 text-left">
        <div className="text-[11px] text-white/40">
          Optional: tell us a bit more, or skip.
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type="text"
            name="name"
            maxLength={50}
            autoComplete="given-name"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={GHOST}
            disabled={status === "submitting"}
            aria-label="Your name"
          />
          <select
            name="country"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className={`${GHOST} appearance-none ${
              country ? "text-white" : "!text-white/40"
            }`}
            disabled={status === "submitting"}
            aria-label="Country"
          >
            <option value="" style={{ background: "#0A0A0A" }}>
              Country
            </option>
            {COUNTRIES.map((c) => (
              <option key={c} value={c} style={{ background: "#0A0A0A" }}>
                {c}
              </option>
            ))}
          </select>
          <select
            name="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={`${GHOST} appearance-none ${
              reason ? "text-white" : "!text-white/40"
            }`}
            disabled={status === "submitting"}
            aria-label="Main reason you want Talise"
          >
            <option value="" style={{ background: "#0A0A0A" }}>
              Why Talise?
            </option>
            {REASONS.map((r) => (
              <option key={r} value={r} style={{ background: "#0A0A0A" }}>
                {r}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="px-4 text-[12px] text-[#F0A99E]" role="alert">
          {error}
        </div>
      )}
    </form>
  );
}
