"use client";

import { useState } from "react";

/**
 * Waitlist form. Pure client component because the only behavior is
 * POST /api/waitlist + the success/error UI flip. No SSR concern.
 *
 * Single-row layout: email pill + Join waitlist button. The earlier
 * optional name/country/reason inputs were removed; the API still
 * accepts those fields and the DB columns are intact, so we can
 * re-introduce them later without a schema change.
 */
type Status = "idle" | "submitting" | "ok" | "dup" | "error";

export function WaitlistForm() {
  const [email, setEmail] = useState("");
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
        body: JSON.stringify({ email, source: "landing" }),
      });
      if (r.status === 409) {
        // Already on the list — surface as a muted inline note, not an
        // error. Keep the form mounted so the user can re-enter a
        // different email if they made a typo.
        setStatus("dup");
        return;
      }
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
          Check your inbox. We sent a quick confirmation from hello@waitlist.talise.io.
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
        .waitlist-form input:-webkit-autofill:active {
          -webkit-text-fill-color: #ffffff;
          -webkit-box-shadow: 0 0 0 1000px transparent inset;
          transition: background-color 9999s ease-in-out 0s;
          caret-color: #ffffff;
          background-clip: content-box !important;
        }
      `}</style>

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
            if (status === "error" || status === "dup") setStatus("idle");
          }}
          className="flex-1 bg-transparent px-5 py-1 text-[15px] text-white placeholder:text-white/55 focus:outline-none"
          disabled={status === "submitting"}
        />
        <button
          type="submit"
          disabled={status === "submitting" || email.length === 0}
          className="whitespace-nowrap rounded-full bg-white px-5 py-2.5 text-[14px] font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {status === "submitting" ? "Joining…" : "Join waitlist"}
        </button>
      </div>

      {status === "dup" && (
        <div
          className="px-4 text-[12px] text-[#86E1B1]"
          role="status"
          aria-live="polite"
        >
          You're already on the list — check your inbox.
        </div>
      )}

      {error && status === "error" && (
        <div className="px-4 text-[12px] text-[#F0A99E]" role="alert">
          {error}
        </div>
      )}
    </form>
  );
}
