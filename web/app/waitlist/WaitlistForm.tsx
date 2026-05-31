"use client";

import { useEffect, useRef, useState } from "react";
import { triggerOauthSignIn } from "@/lib/zkclient";

/**
 * Waitlist form. Google-first flow:
 *
 *   1. Mount: probe /api/auth/me. If there's a session, jump to the
 *      claim step (or show "welcome back" if the user already owns a
 *      handle). Otherwise render the Google sign-in CTA.
 *   2. User clicks "Sign in with Google" → triggerOauthSignIn bounces
 *      to Google, /auth/callback drops them back at /waitlist with a
 *      live session cookie, the form auto-advances to claim.
 *   3. User picks a handle → POST /api/waitlist/handle/claim with just
 *      `{ handle }`. The route derives the email from the session and
 *      UPSERTs the waitlist row. The handle mints on chain inside the
 *      same request; a confirmation email is sent on success.
 *
 * There is no email input on this page anymore. The legacy
 * /api/waitlist endpoint is still alive for external links but the new
 * UI never calls it.
 */

type HandleAvailability =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available"; handle: string }
  | { kind: "taken" }
  | { kind: "invalid"; message: string }
  | { kind: "error"; message: string };

type ClaimStatus = "idle" | "claiming" | "claimed" | "error";

type ClaimSuccess = {
  handle: string;
  mintDigest?: string;
  suiAddress?: string;
};

// Outer state machine. `checking` is the initial probe while we race
// /api/auth/me and /api/waitlist/handle/existing. After that we land
// on exactly one of:
//   • needsSignIn   — render the Google CTA
//   • signedOutCancel — user backed out of the Google sheet (quiet pill)
//   • needsClaim    — session active, no handle yet → handle picker
//   • existing      — session active + already owns a handle (welcome back)
type Phase =
  | "checking"
  | "needsSignIn"
  | "signedOutCancel"
  | "needsClaim"
  | "existing";

type Session = { email: string; suiAddress?: string };

export function WaitlistForm() {
  const [phase, setPhase] = useState<Phase>("checking");
  const [session, setSession] = useState<Session | null>(null);
  const [existingHandle, setExistingHandle] = useState<string | null>(null);
  const [signInPending, setSignInPending] = useState(false);
  const [signInError, setSignInError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const meRes = await fetch("/api/auth/me", {
          cache: "no-store",
        }).catch(() => null);
        if (cancelled) return;

        const meBody = meRes
          ? ((await meRes.json().catch(() => ({}))) as {
              signedIn?: boolean;
              email?: string;
              suiAddress?: string;
              handle?: string | null;
            })
          : {};

        if (!meBody.signedIn || !meBody.email) {
          setPhase("needsSignIn");
          return;
        }

        const sess: Session = {
          email: meBody.email,
          suiAddress: meBody.suiAddress,
        };
        setSession(sess);

        // Welcome-back: if the user row already carries a handle we
        // can short-circuit. We still check /handle/existing as a
        // backstop (handle bound out of band, e.g. via the bind hook).
        if (meBody.handle) {
          setExistingHandle(meBody.handle);
          setPhase("existing");
          return;
        }

        const existingRes = await fetch("/api/waitlist/handle/existing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: sess.email }),
        }).catch(() => null);
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

        setPhase("needsClaim");
      } catch {
        if (!cancelled) setPhase("needsSignIn");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSignIn() {
    if (signInPending) return;
    setSignInPending(true);
    setSignInError("");
    try {
      // Stash the return-to so /auth/callback drops the user back
      // here with a session cookie. On reload, the useEffect above
      // re-probes and advances to needsClaim (or existing).
      await triggerOauthSignIn({ returnTo: "/waitlist" });
    } catch (err) {
      setSignInPending(false);
      // User cancelled the Google sheet. Surface a quiet pill, not
      // a loud error.
      const msg = (err as Error).message ?? "";
      if (
        /cancel/i.test(msg) ||
        /closed/i.test(msg) ||
        /aborted/i.test(msg)
      ) {
        setPhase("signedOutCancel");
        return;
      }
      setSignInError(msg || "Sign-in failed. Try again.");
    }
  }

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

  if (phase === "existing" && existingHandle && session) {
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
          <span className="text-white/75">{session.email}</span> to use it
          right away.
        </div>
      </div>
    );
  }

  if (phase === "needsClaim" && session) {
    return <HandleClaim session={session} />;
  }

  // needsSignIn (or signedOutCancel, which renders the same CTA with a
  // muted "cancelled" pill above it).
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

      {phase === "signedOutCancel" && (
        <div
          className="px-4 text-center text-[12px] text-white/55"
          role="status"
          aria-live="polite"
        >
          Sign-in cancelled. Try again when you are ready.
        </div>
      )}

      <button
        type="button"
        onClick={onSignIn}
        disabled={signInPending}
        className="whitespace-nowrap rounded-full bg-white px-5 py-3 text-[14px] font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {signInPending ? "Opening Google…" : "Sign in with Google"}
      </button>

      {signInError && (
        <div className="px-4 text-center text-[12px] text-[#F0A99E]" role="alert">
          {signInError}
        </div>
      )}
    </div>
  );
}

/**
 * Handle claim sub-flow. Shown after Google sign-in completes (so we
 * always have an authenticated `session` to work with). Debounced
 * availability check on each keystroke (350ms) → optimistic CTA
 * enabled only when the server returns `available: true`. On claim
 * success the form collapses to a confirmation banner.
 *
 * The claim POST sends ONLY the handle — the route derives the email
 * from the session cookie.
 */
function HandleClaim({ session }: { session: Session }) {
  const { email } = session;
  const [handle, setHandle] = useState("");
  const [avail, setAvail] = useState<HandleAvailability>({ kind: "idle" });
  const [claim, setClaim] = useState<ClaimStatus>("idle");
  const [claimSuccess, setClaimSuccess] = useState<ClaimSuccess | null>(null);
  const [claimError, setClaimError] = useState("");
  const seqRef = useRef(0);

  useEffect(() => {
    if (claim === "claimed") return;
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
  }, [handle, email, claim]);

  async function onClaim() {
    if (avail.kind !== "available") return;
    setClaim("claiming");
    setClaimError("");
    try {
      // No email in the body — the route reads it from the session
      // cookie. Sending it would be a footgun if it ever drifted out
      // of sync with the actual signed-in user.
      const r = await fetch("/api/waitlist/handle/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle: avail.handle }),
      });
      const body = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        handle?: string;
        mintDigest?: string;
        suiAddress?: string;
        error?: string;
      };
      if (r.status === 401) {
        // Session expired between mount and claim. Reload the page so
        // the outer form re-probes /api/auth/me and shows the sign-in
        // CTA again.
        window.location.reload();
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
          Try it now in the app. Anyone can send to{" "}
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

  const ctaEnabled = avail.kind === "available" && claim !== "claiming";

  return (
    <div className="flex flex-col gap-3">
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
    </div>
  );
}
