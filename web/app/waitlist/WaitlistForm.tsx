"use client";

import { useEffect, useRef, useState } from "react";
import { triggerOauthSignIn } from "@/lib/zkclient";

/**
 * Waitlist form. After the email-success state, we transition to a
 * second screen where the user can claim their `<handle>.talise.sui`
 * subname.
 *
 * New (post-claim-rework) flow:
 *   email submit → "needsSignIn" (Google CTA) → /auth/callback bounces
 *   back to /waitlist with a live session → "claim" form → atomic
 *   on-chain SuiNS mint. The handle is on chain by the time the
 *   success card renders.
 *
 * Welcome-back (existing handle) and already-signed-in users skip
 * straight past the OAuth CTA. See the `useEffect` race below: we
 * call /api/auth/me and /api/waitlist/handle/existing in parallel and
 * branch off the first relevant signal.
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

type ClaimSuccess = {
  handle: string;
  mintDigest?: string;
  suiAddress?: string;
};

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
  const [claimSuccess, setClaimSuccess] = useState<ClaimSuccess | null>(null);
  const [claimError, setClaimError] = useState("");
  // Phases:
  //   • checking      — racing /api/auth/me and /api/waitlist/handle/existing
  //   • existing      — welcome-back: this email already owns a handle
  //   • needsSignIn   — caller is not signed in; show Google CTA
  //   • claim         — caller is signed in; show the handle input + Claim
  const [phase, setPhase] = useState<
    "checking" | "existing" | "needsSignIn" | "claim"
  >("checking");
  const [existingHandle, setExistingHandle] = useState<string | null>(null);
  const [signInPending, setSignInPending] = useState(false);
  const seqRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Race both probes — neither one needs the other's result. The
        // decision tree:
        //   1. existing handle → "existing" (welcome-back)
        //   2. signed in       → "claim"
        //   3. neither         → "needsSignIn"
        const [existingRes, meRes] = await Promise.all([
          fetch("/api/waitlist/handle/existing", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email }),
          }).catch(() => null),
          fetch("/api/auth/me", { cache: "no-store" }).catch(() => null),
        ]);
        if (cancelled) return;

        const existingBody = existingRes
          ? ((await existingRes.json().catch(() => ({}))) as {
              existing?: { handle: string } | null;
            })
          : {};
        if (existingBody.existing?.handle) {
          setExistingHandle(existingBody.existing.handle);
          setPhase("existing");
          return;
        }

        const meBody = meRes
          ? ((await meRes.json().catch(() => ({}))) as {
              signedIn?: boolean;
              email?: string;
              handle?: string | null;
            })
          : {};
        // If the session belongs to a different email than the one
        // typed in step 1, still require sign-in so the claim route
        // doesn't 403 the user. The needsSignIn CTA will switch the
        // Google account picker open.
        if (
          meBody.signedIn &&
          (meBody.email ?? "").toLowerCase() === email.toLowerCase()
        ) {
          // If they already own a handle via the session row, treat
          // as welcome-back even if the waitlist row is stale.
          if (meBody.handle) {
            setExistingHandle(meBody.handle);
            setPhase("existing");
            return;
          }
          setPhase("claim");
          return;
        }
        setPhase("needsSignIn");
      } catch {
        // Fall through to needsSignIn — safer than dropping straight
        // into claim and hitting a 401 mid-flow.
        if (!cancelled) setPhase("needsSignIn");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [email]);

  async function onSignIn() {
    if (signInPending) return;
    setSignInPending(true);
    try {
      // Stash the return-to so /auth/callback drops the user back
      // here, where the page reloads, /api/auth/me reports signedIn,
      // and the form flips to phase="claim" automatically.
      await triggerOauthSignIn({ returnTo: "/waitlist" });
    } catch (err) {
      setSignInPending(false);
      setClaimError((err as Error).message);
    }
  }

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
        mintDigest?: string;
        suiAddress?: string;
        error?: string;
      };
      if (r.status === 401) {
        // Session expired between mount and claim — bounce back to
        // sign-in. Rare in practice (we just checked /api/auth/me on
        // mount), but the failure is recoverable.
        setPhase("needsSignIn");
        setClaim("idle");
        return;
      }
      if (!r.ok || !body.ok || !body.handle) {
        throw new Error(body.error || "Couldn't claim that handle.");
      }
      setClaimSuccess({
        handle: body.handle,
        mintDigest: body.mintDigest,
        suiAddress: body.suiAddress,
      });
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

  // Sign-in gate. The user is on the waitlist but is not signed in
  // yet — show the Google CTA. After OAuth, /auth/callback drops them
  // back at /waitlist with a session cookie and the form auto-advances
  // to phase="claim".
  if (phase === "needsSignIn") {
    return (
      <div className="flex flex-col gap-3">
        <div className="px-1 text-center">
          <div className="text-[15px] font-medium text-white">
            Sign in to claim your handle.
          </div>
          <div className="mt-1 text-[12px] leading-[1.55] text-white/55">
            Talise creates a Sui wallet from your Google account. Your
            handle mints to that wallet the moment you click Claim.
          </div>
        </div>

        <button
          type="button"
          onClick={onSignIn}
          disabled={signInPending}
          className="whitespace-nowrap rounded-full bg-white px-5 py-3 text-[14px] font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {signInPending ? "Opening Google…" : "Sign in with Google"}
        </button>

        {claimError && (
          <div className="px-4 text-center text-[12px] text-[#F0A99E]" role="alert">
            {claimError}
          </div>
        )}
      </div>
    );
  }

  // Welcome-back: this email already owns a *.talise.sui name (admin
  // testers, returning beta users). Skip the claim flow entirely — they
  // just need to sign in to access the handle they already have.
  if (phase === "existing" && existingHandle) {
    return (
      <div
        className="flex flex-col items-center gap-1.5 rounded-2xl border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/[0.06] px-6 py-5 text-center"
        role="status"
        aria-live="polite"
      >
        <div className="text-[15px] font-medium text-white">
          Welcome back. You already have {existingHandle}@talise.sui.
        </div>
        <div className="text-[12px] text-white/55">
          Open Talise on iOS with{" "}
          <span className="text-white/75">{email}</span> to use it right away.
        </div>
      </div>
    );
  }

  if (claim === "claimed" && claimSuccess) {
    const explorerUrl = claimSuccess.mintDigest
      ? `https://suivision.xyz/txblock/${claimSuccess.mintDigest}`
      : null;
    return (
      <div
        className="flex flex-col items-center gap-1.5 rounded-2xl border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/[0.06] px-6 py-5 text-center"
        role="status"
        aria-live="polite"
      >
        <div className="text-[15px] font-medium text-white">
          {claimSuccess.handle}@talise.sui is yours, on chain.
        </div>
        <div className="text-[12px] leading-[1.55] text-white/55">
          Try it now in the app — anyone can send to{" "}
          <span className="text-white/75">{claimSuccess.handle}@talise.sui</span>.
        </div>
        {explorerUrl && (
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 text-[11px] text-white/45 underline-offset-2 hover:text-white/70 hover:underline"
          >
            View mint on SuiVision
          </a>
        )}
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
          Mints on chain to your wallet the moment you click Claim.
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
            {avail.handle}@talise.sui is available.
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
