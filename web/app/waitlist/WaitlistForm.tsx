"use client";

import { useState } from "react";

/**
 * Waitlist form. Pure client component because the only behavior is
 * `POST /api/waitlist` + the success/error UI flip. No SSR concern.
 *
 * States:
 *   idle    — input + button visible
 *   submitting — button shows spinner
 *   ok      — input replaced with "You're on the list."
 *   error   — inline message under the input, button re-enabled
 */
type Status = "idle" | "submitting" | "ok" | "error";

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
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || "Couldn't save your email — try again.");
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
        className="flex flex-col items-center gap-1.5 rounded-full border border-[#79D96C]/30 bg-[#79D96C]/[0.06] px-6 py-4 text-center"
        role="status"
        aria-live="polite"
      >
        <div className="text-[15px] font-medium text-white">
          You're on the list.
        </div>
        <div className="text-[12px] text-white/55">
          We'll email when it's your turn — usually within a few days.
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-2"
      // Properly identify the form to the browser's autofill — without
      // this, Chrome reaches for any email it has on file and the
      // suggestion popup overlays the page chrome.
      autoComplete="on"
      noValidate
    >
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
          // Brighter placeholder + larger inline padding; the original
          // text-white/30 was barely legible against the dark bg.
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
      {error && (
        <div className="px-4 text-[12px] text-[#F0A99E]" role="alert">
          {error}
        </div>
      )}
    </form>
  );
}
