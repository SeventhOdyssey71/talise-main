"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Waitlist form. After the email-success state, we transition to a
 * second screen where the user can claim their `<handle>.talise.sui`
 * subname. The claim is reserved in DB at this point; the actual
 * SuiNS mint happens at first iOS sign-in via
 * `bindWaitlistHandleIfAny`.
 */
type EmailStatus = "idle" | "submitting" | "ok" | "dup" | "error";

type HandleAvailability =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available"; handle: string }
  | { kind: "taken" }
  | { kind: "invalid"; message: string }
  | { kind: "error"; message: string };

type ClaimStatus =
  | "idle"
  | "claiming"
  | "claimed"
  | "error"
  | "skipped";

export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<EmailStatus>("idle");
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
        // Already on the list — treat as success so the user can
        // continue to claim their handle. The handle UI scopes its
        // checks by email, not by "did we just insert".
        setStatus("ok");
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
    return <HandleClaim email={email} />;
  }

  return (
    <form
      onSubmit={onSubmit}
      className="waitlist-form flex flex-col gap-3"
      autoComplete="on"
      noValidate
    >
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

/**
 * Handle claim sub-flow. Shown after a successful waitlist signup.
 * Debounced availability check on each keystroke (350ms) → optimistic
 * CTA enabled only when the server returns `available: true`. On
 * claim success the form collapses to a confirmation banner.
 */
function HandleClaim({ email }: { email: string }) {
  const [handle, setHandle] = useState("");
  const [avail, setAvail] = useState<HandleAvailability>({ kind: "idle" });
  const [claim, setClaim] = useState<ClaimStatus>("idle");
  const [claimedHandle, setClaimedHandle] = useState<string | null>(null);
  const [claimError, setClaimError] = useState("");
  // Welcome-back: if this email is already a Talise user with a bound
  // handle (admin testers, returning beta users), skip the claim UI
  // entirely. `phase` gates the whole render.
  const [phase, setPhase] = useState<"checking" | "existing" | "claim">("checking");
  const [existingHandle, setExistingHandle] = useState<string | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/waitlist/handle/existing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        if (cancelled) return;
        const body = (await r.json().catch(() => ({}))) as {
          existing?: { handle: string } | null;
        };
        if (body.existing?.handle) {
          setExistingHandle(body.existing.handle);
          setPhase("existing");
        } else {
          setPhase("claim");
        }
      } catch {
        // Fall through to claim UI on any error — better to over-show
        // the claim screen than to hide it incorrectly.
        if (!cancelled) setPhase("claim");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [email]);

  useEffect(() => {
    if (phase !== "claim") return;
    if (claim === "claimed" || claim === "skipped") return;
    const trimmed = handle.trim();
    if (!trimmed) {
      setAvail({ kind: "idle" });
      return;
    }

    // Debounce so we don't hit the API on every keystroke. 350ms is the
    // sweet spot between feeling instant and saving round trips.
    const mySeq = ++seqRef.current;
    setAvail({ kind: "checking" });
    const t = setTimeout(async () => {
      try {
        const r = await fetch("/api/waitlist/handle/availability", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, handle: trimmed }),
        });
        if (mySeq !== seqRef.current) return; // stale
        const body = (await r.json().catch(() => ({}))) as {
          available?: boolean;
          normalized?: string;
          error?: string;
          reason?: string;
        };
        if (r.status === 400) {
          setAvail({
            kind: "invalid",
            message: body.error || "Invalid handle.",
          });
          return;
        }
        if (r.status === 404 || r.status === 409) {
          setAvail({
            kind: "error",
            message: body.error || "Could not check that handle.",
          });
          return;
        }
        if (!r.ok) {
          setAvail({
            kind: "error",
            message: body.error || "Could not check that handle.",
          });
          return;
        }
        if (body.available && body.normalized) {
          setAvail({ kind: "available", handle: body.normalized });
        } else {
          setAvail({ kind: "taken" });
        }
      } catch (err) {
        if (mySeq !== seqRef.current) return;
        setAvail({ kind: "error", message: (err as Error).message });
      }
    }, 350);

    return () => clearTimeout(t);
  }, [handle, email, claim, phase]);

  async function onClaim() {
    if (avail.kind !== "available") return;
    setClaim("claiming");
    setClaimError("");
    try {
      const r = await fetch("/api/waitlist/handle/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, handle: avail.handle }),
      });
      const body = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        handle?: string;
        error?: string;
      };
      if (!r.ok || !body.ok || !body.handle) {
        throw new Error(body.error || "Couldn't claim that handle.");
      }
      setClaimedHandle(body.handle);
      setClaim("claimed");
    } catch (err) {
      setClaim("error");
      setClaimError((err as Error).message);
    }
  }

  // Initial probe — quick muted spinner so the form doesn't flash empty.
  if (phase === "checking") {
    return (
      <div
        className="flex flex-col items-center gap-1.5 rounded-2xl border border-white/10 bg-white/[0.04] px-6 py-5 text-center"
        role="status"
        aria-live="polite"
      >
        <div className="text-[12px] text-white/55">Checking your account…</div>
      </div>
    );
  }

  // Welcome-back: this email already owns a *.talise.sui name (admin
  // testers, returning beta users). Skip the claim flow entirely — they
  // just need to sign in on iOS to access the handle they already have.
  if (phase === "existing" && existingHandle) {
    return (
      <div
        className="flex flex-col items-center gap-1.5 rounded-2xl border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/[0.06] px-6 py-5 text-center"
        role="status"
        aria-live="polite"
      >
        <div className="text-[15px] font-medium text-white">
          Welcome back. You already have @{existingHandle}.
        </div>
        <div className="text-[12px] text-white/55">
          Sign in on iOS with{" "}
          <span className="text-white/75">{email}</span> to use it right away.
        </div>
      </div>
    );
  }

  if (claim === "claimed" && claimedHandle) {
    return (
      <div
        className="flex flex-col items-center gap-1.5 rounded-2xl border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/[0.06] px-6 py-5 text-center"
        role="status"
        aria-live="polite"
      >
        <div className="text-[15px] font-medium text-white">
          @{claimedHandle} is reserved for you.
        </div>
        <div className="text-[12px] leading-[1.55] text-white/55">
          It mints to your wallet on-chain the first time you sign in on iOS
          with{" "}
          <span className="text-white/75">{email}</span>. Until then it's held
          off-chain in your name.
        </div>
      </div>
    );
  }

  if (claim === "skipped") {
    return (
      <div
        className="flex flex-col items-center gap-1.5 rounded-2xl border border-white/10 bg-white/[0.04] px-6 py-5 text-center"
        role="status"
        aria-live="polite"
      >
        <div className="text-[15px] font-medium text-white">
          You're on the list.
        </div>
        <div className="text-[12px] text-white/55">
          You can claim a handle anytime by returning to this page with{" "}
          <span className="text-white/75">{email}</span>.
        </div>
      </div>
    );
  }

  const ctaEnabled = avail.kind === "available" && claim !== "claiming";

  return (
    <div className="flex flex-col gap-3">
      <div className="px-1 text-center">
        <div className="text-[15px] font-medium text-white">
          Now claim your @handle.
        </div>
        <div className="mt-1 text-[12px] text-white/55">
          It will be ready the moment you sign in on iOS.
        </div>
      </div>

      <div className="waitlist-form flex items-stretch gap-2 rounded-full border border-white/15 bg-white/[0.04] p-1.5 transition-colors focus-within:border-white/40">
        <div className="flex flex-1 items-center pl-4 pr-1">
          <span className="select-none text-[15px] text-white/55">@</span>
          <input
            id="waitlist-handle"
            name="handle"
            type="text"
            required
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="yourname"
            value={handle}
            onChange={(e) => {
              const next = e.target.value.replace(/^@+/, "");
              setHandle(next);
              if (claim === "error") setClaim("idle");
            }}
            className="flex-1 bg-transparent px-2 py-1 text-[15px] text-white placeholder:text-white/40 focus:outline-none"
            disabled={claim === "claiming"}
            aria-describedby="handle-hint"
            maxLength={32}
          />
        </div>
        <button
          type="button"
          onClick={onClaim}
          disabled={!ctaEnabled}
          className="whitespace-nowrap rounded-full bg-white px-5 py-2.5 text-[14px] font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {claim === "claiming"
            ? "Claiming…"
            : avail.kind === "available"
              ? `Claim @${avail.handle}`
              : "Claim"}
        </button>
      </div>

      <div id="handle-hint" className="px-4 text-[12px]" aria-live="polite">
        {avail.kind === "idle" && (
          <span className="text-white/45">
            Letters, numbers, hyphens. 2-32 chars.
          </span>
        )}
        {avail.kind === "checking" && (
          <span className="text-white/55">Checking…</span>
        )}
        {avail.kind === "available" && (
          <span className="text-[#86E1B1]">
            @{avail.handle}.talise.sui is available.
          </span>
        )}
        {avail.kind === "taken" && (
          <span className="text-[#F0A99E]">Taken. Try another.</span>
        )}
        {avail.kind === "invalid" && (
          <span className="text-white/55">{avail.message}</span>
        )}
        {avail.kind === "error" && (
          <span className="text-[#F0A99E]">{avail.message}</span>
        )}
      </div>

      {claim === "error" && claimError && (
        <div className="px-4 text-[12px] text-[#F0A99E]" role="alert">
          {claimError}
        </div>
      )}

      <button
        type="button"
        onClick={() => setClaim("skipped")}
        disabled={claim === "claiming"}
        className="self-center text-[12px] text-white/45 underline-offset-2 transition-colors hover:text-white/70 hover:underline disabled:opacity-50"
      >
        Skip for now
      </button>
    </div>
  );
}
