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

/**
 * Shared "you're in" confirmation card. Rendered both when a returning
 * user lands on /waitlist already owning a handle (mount probe) AND when
 * a fresh claim succeeds. Single component so the success treatment is
 * identical across both paths.
 */
function ClaimedCard({
  handle,
  email,
  explorerUrl,
}: {
  handle: string;
  email?: string;
  explorerUrl?: string | null;
}) {
  return (
    <div
      className="flex flex-col items-center gap-3 rounded-2xl border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/[0.06] px-5 py-6 text-center sm:px-7 sm:py-7"
      role="status"
      aria-live="polite"
    >
      <span
        aria-hidden
        className="grid h-11 w-11 place-items-center rounded-full bg-[var(--color-accent)]/15 text-[var(--color-accent)]"
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>

      <div className="text-[15px] font-medium text-white sm:text-[16px]">
        <span className="break-all">{handle}@talise.sui</span> is yours.
      </div>

      <p className="max-w-[300px] text-[12px] leading-[1.55] text-white/55 sm:text-[13px]">
        You&apos;re on the list. We&apos;ll email you when it&apos;s your turn.
        {email ? (
          <>
            {" "}
            Open Talise with{" "}
            <span className="break-all text-white/75">{email}</span> to use it.
          </>
        ) : null}
      </p>

      {explorerUrl ? (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-white/45 underline-offset-2 hover:text-white/70 hover:underline"
        >
          View on chain
        </a>
      ) : null}
    </div>
  );
}

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

        // /api/auth/me is the source of truth — `user.talise_username`
        // resolves to `handle` on the response. If it's set the user
        // has already claimed; otherwise drop straight into the
        // picker. The old /handle/existing backstop call doubled the
        // spinner time on every signed-in load for new users without
        // adding signal — /api/auth/me already covers it.
        if (meBody.handle) {
          setExistingHandle(meBody.handle);
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
        className="flex items-center justify-center gap-2.5 rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-6 text-center sm:px-6"
        role="status"
        aria-live="polite"
      >
        <span
          aria-hidden
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/20 border-t-white/70"
        />
        <span className="text-[12px] text-white/55">Checking your account…</span>
      </div>
    );
  }

  if (phase === "existing" && existingHandle && session) {
    return <ClaimedCard handle={existingHandle} email={session.email} />;
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
        className="inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-full bg-white px-5 py-3 text-[14px] font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {signInPending ? (
          <>
            <span
              aria-hidden
              className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-black/25 border-t-black/70"
            />
            Opening Google…
          </>
        ) : (
          "Sign in with Google"
        )}
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
  // Set when the claim POST comes back 409 alreadyClaimed (the user
  // already owns a handle, e.g. they claimed in another tab). We swap to
  // the "you're in" card using the handle from the 409 body rather than
  // showing a generic error.
  const [alreadyClaimed, setAlreadyClaimed] = useState<string | null>(null);
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
        alreadyClaimed?: boolean;
      };
      if (r.status === 401) {
        // Session expired between mount and claim. Reload the page so
        // the outer form re-probes /api/auth/me and shows the sign-in
        // CTA again.
        window.location.reload();
        return;
      }
      if (r.status === 409 && body.alreadyClaimed && body.handle) {
        // Race: the user already owns a handle (claimed in another tab
        // since this page loaded). Swap to the same "you're in" card
        // with their existing handle instead of a jarring error.
        setAlreadyClaimed(body.handle);
        setClaim("idle");
        setClaimError("");
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
      // After successful mint, give the user 1.2s to register the
      // success card visually, then bounce them to the marketing
      // root (talise.io), NOT /home — per the user directive
      // "redirect to talise.io, not talise.io/home". The root is the
      // canonical landing surface; /home is the authed web dashboard
      // which a fresh waitlist claimer doesn't need yet.
      window.setTimeout(() => {
        window.location.href = "/";
      }, 1200);
    } catch (err) {
      setClaim("error");
      setClaimError((err as Error).message);
    }
  }

  // 409 mid-flow: they already own a handle. Same "you're in" card.
  if (alreadyClaimed) {
    return <ClaimedCard handle={alreadyClaimed} email={email} />;
  }

  if (claim === "claimed" && claimSuccess) {
    const explorerUrl = claimSuccess.mintDigest
      ? `https://suivision.xyz/txblock/${claimSuccess.mintDigest}`
      : null;
    return (
      <ClaimedCard
        handle={claimSuccess.handle}
        email={email}
        explorerUrl={explorerUrl}
      />
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

      <div className="waitlist-form flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] p-1.5 transition-colors focus-within:border-white/40">
        <div className="flex min-w-0 flex-1 items-center pl-3 pr-1 sm:pl-4">
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
            className="min-w-0 flex-1 bg-transparent px-2 py-1 text-[15px] text-white placeholder:text-white/40 focus:outline-none"
            disabled={claim === "claiming"}
            aria-describedby="handle-hint"
            maxLength={32}
          />
        </div>
        <button
          type="button"
          onClick={onClaim}
          disabled={!ctaEnabled}
          className="inline-flex flex-none items-center justify-center gap-2 whitespace-nowrap rounded-full bg-white px-4 py-2.5 text-[14px] font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-50 sm:px-5"
        >
          {claim === "claiming" ? (
            <>
              <span
                aria-hidden
                className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-black/25 border-t-black/70"
              />
              <span className="hidden sm:inline">Claiming…</span>
            </>
          ) : (
            "Claim"
          )}
        </button>
      </div>

      <div id="handle-hint" className="px-4 text-[12px]" aria-live="polite">
        {avail.kind === "idle" && (
          <span className="text-white/45">
            Letters, numbers, hyphens. 3-32 chars.
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
