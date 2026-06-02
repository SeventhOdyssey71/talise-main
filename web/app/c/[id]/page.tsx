"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CheckmarkBadge01Icon,
  GlobalIcon,
  SecurityCheckIcon,
  Cancel01Icon,
  Alert02Icon,
} from "@hugeicons/core-free-icons";
import { api, ApiError, triggerOauthSignIn } from "@/components/app";
import { ChequeCard } from "@/components/app/cheques/ChequeCard";
import { Turnstile, turnstileEnabled } from "@/components/app/cheques/Turnstile";

type PreviewResp = {
  id: string;
  amountUsd: number;
  status: string;
  payeeLabel: string | null;
  memo: string | null;
  signatureName: string | null;
  creatorDisplay: string;
  allowedCountries: string[];
  expiresAt: number;
  claimable: boolean;
};

type ClaimResp = { ok: boolean; digest?: string; amountUsd?: number };
type MeResp = { id: string; name: string | null };

/**
 * Public, ungated cheque-claim page (talise.io/c/<id>?s=<secret>). Anyone with
 * the link can open it — no app gate. Renders the cheque, prompts Google
 * sign-in if the visitor isn't signed in (claiming credits their wallet), runs
 * the Turnstile human-check, and releases the funds. Closes the "DM a cheque
 * to anyone" viral loop.
 *
 * `useSearchParams` requires a Suspense boundary in Next 15, so the page body
 * lives in `ClaimInner` and the default export wraps it.
 */
export default function PublicClaimPage() {
  return (
    <Suspense fallback={<main className="min-h-dvh bg-bg" />}>
      <ClaimInner />
    </Suspense>
  );
}

function ClaimInner() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const id = params?.id ?? "";

  // The shareable link puts the secret in the URL FRAGMENT
  // (`/c/<id>#<secret>`) so it never hits a server log; `?s=<secret>` is also
  // accepted as a fallback. The fragment is client-only — resolved at mount.
  const [secret, setSecret] = useState<string>("");

  const [preview, setPreview] = useState<PreviewResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [meName, setMeName] = useState<string | null>(null);

  const [token, setToken] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [cashed, setCashed] = useState<number | null>(null);

  // Resolve the secret from the fragment (preferred) or the `?s=` query, then
  // load the cheque preview (unauthenticated read).
  useEffect(() => {
    let cancelled = false;
    const fromHash =
      typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
    const resolvedSecret = fromHash
      ? decodeURIComponent(fromHash)
      : search.get("s") ?? "";
    setSecret(resolvedSecret);

    if (!id || !resolvedSecret) {
      setLoadError("This cheque link is missing its secret. Ask the sender to share the full link.");
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const pv = await api<PreviewResp>(`/api/cheques/${id}/preview`, {
          query: { s: resolvedSecret },
        });
        if (!cancelled) setPreview(pv);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 503) {
          setLoadError("Cheques are rolling out — check back soon.");
        } else {
          setLoadError(
            "This cheque couldn't be opened — it may be invalid, expired, or already claimed."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, search]);

  // Detect sign-in (the session cookie is same-origin).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await api<MeResp>("/api/me");
        if (!cancelled) {
          setSignedIn(true);
          setMeName(me.name);
        }
      } catch {
        if (!cancelled) setSignedIn(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(() => {
    triggerOauthSignIn({
      returnTo: typeof location !== "undefined" ? location.pathname + location.search : undefined,
    });
  }, []);

  const claim = useCallback(async () => {
    if (turnstileEnabled() && !token) {
      setClaimError("Complete the human check below, then claim.");
      return;
    }
    setClaiming(true);
    setClaimError(null);
    try {
      const r = await api<ClaimResp>(`/api/cheques/${id}/claim/release`, {
        method: "POST",
        body: { secret, turnstileToken: token },
      });
      if (r.ok) setCashed(r.amountUsd ?? preview?.amountUsd ?? 0);
    } catch (e) {
      setClaimError(gateError(e));
      setToken(null);
    } finally {
      setClaiming(false);
    }
  }, [id, secret, token, preview]);

  return (
    <main className="relative min-h-dvh bg-bg text-fg">
      {/* Subtle top green glow */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-64"
        style={{
          background:
            "radial-gradient(60% 100% at 50% 0%, color-mix(in srgb, var(--color-accent) 16%, transparent) 0%, transparent 70%)",
        }}
        aria-hidden
      />

      <div className="relative mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 py-8">
        {/* Brand header */}
        <header className="mb-8 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2">
            <span
              className="font-serif text-[22px] font-medium text-accent"
              style={{ letterSpacing: "-0.01em" }}
            >
              Talise
            </span>
          </a>
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-fg-dim">
            Cheque
          </span>
        </header>

        <div className="flex flex-1 flex-col justify-center">
          {loading ? (
            <LoadingBlock />
          ) : loadError ? (
            <ErrorBlock message={loadError} />
          ) : cashed != null ? (
            <CashedBlock amount={cashed} name={meName} />
          ) : preview ? (
            <div className="space-y-6">
              <p className="text-center text-[14px] text-fg-muted">
                From {preview.creatorDisplay}
              </p>

              <ChequeCard
                amountUsd={preview.amountUsd}
                payee={preview.payeeLabel ?? "You"}
                memo={preview.memo ?? ""}
                signature={preview.signatureName ?? ""}
                chequeNo={preview.id.slice(-5)}
                stamp={preview.claimable ? undefined : preview.status.toUpperCase()}
              />

              {preview.allowedCountries.length > 0 && (
                <div className="flex items-center justify-center gap-1.5 font-mono text-[11px] text-fg-dim">
                  <HugeiconsIcon icon={GlobalIcon} size={13} />
                  Claimable only from {preview.allowedCountries.join(", ")}
                </div>
              )}

              {!preview.claimable ? (
                <p className="text-center text-[14px] text-fg-muted">
                  This cheque is {preview.status} and can no longer be claimed.
                </p>
              ) : signedIn === false ? (
                <div className="space-y-3">
                  <p className="text-center text-[13px] text-fg-muted">
                    Sign in to claim — the money lands in your Talise wallet
                    instantly. No bank, no app, no fees.
                  </p>
                  <button
                    type="button"
                    onClick={signIn}
                    className="flex w-full items-center justify-center gap-3 rounded-full bg-white px-5 py-3.5 text-[15px] font-semibold text-[#1f1f1f] transition-[transform,filter] active:scale-[0.98] hover:brightness-95"
                  >
                    <GoogleMark />
                    Continue with Google
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  {turnstileEnabled() && (
                    <div className="flex justify-center">
                      <Turnstile onToken={setToken} />
                    </div>
                  )}
                  {claimError && <ErrorInline>{claimError}</ErrorInline>}
                  <button
                    type="button"
                    onClick={claim}
                    disabled={claiming || signedIn === null}
                    className="flex w-full items-center justify-center gap-2 rounded-full bg-accent-deep px-5 py-3.5 text-[15px] font-semibold text-white shadow-[0_10px_30px_-12px_rgba(75,138,55,0.7)] transition-[transform,filter] active:scale-[0.98] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {claiming ? "Claiming…" : `Claim $${preview.amountUsd.toFixed(2)}`}
                  </button>
                  <div className="flex items-center justify-center gap-1.5 font-mono text-[10px] text-fg-dim">
                    <HugeiconsIcon icon={SecurityCheckIcon} size={12} className="text-accent" />
                    Protected by a human check + no-VPN policy
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>

        <footer className="mt-10 text-center">
          <p className="font-mono text-[10px] text-fg-dim">
            Talise — pay anyone, anywhere. Gasless dollars on Sui.
          </p>
        </footer>
      </div>
    </main>
  );
}

// ── Sub-blocks ────────────────────────────────────────────────────────────

function LoadingBlock() {
  return (
    <div className="space-y-4">
      <div
        className="w-full animate-pulse rounded-2xl bg-white/[0.04]"
        style={{ aspectRatio: "16 / 8.6" }}
      />
      <div className="mx-auto h-10 w-full animate-pulse rounded-full bg-white/[0.04]" />
    </div>
  );
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <span
        className="flex size-14 items-center justify-center rounded-full"
        style={{
          background: "color-mix(in srgb, var(--color-danger) 12%, transparent)",
          color: "var(--color-danger)",
        }}
      >
        <HugeiconsIcon icon={Alert02Icon} size={28} />
      </span>
      <h1 className="text-[18px] font-semibold text-fg" style={{ letterSpacing: "-0.01em" }}>
        Can&apos;t open this cheque
      </h1>
      <p className="max-w-xs text-[14px] text-fg-muted">{message}</p>
      <a
        href="/"
        className="mt-2 rounded-full border border-line px-5 py-2.5 text-[14px] font-medium text-fg transition-colors hover:border-white/15"
      >
        Go to Talise
      </a>
    </div>
  );
}

function CashedBlock({ amount, name }: { amount: number; name: string | null }) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <span
        className="flex size-16 items-center justify-center rounded-full text-accent"
        style={{ background: "color-mix(in srgb, var(--color-accent) 12%, transparent)" }}
      >
        <HugeiconsIcon icon={CheckmarkBadge01Icon} size={38} />
      </span>
      <span
        className="font-display text-[40px] font-semibold tabular-nums text-fg"
        style={{ letterSpacing: "-0.03em" }}
      >
        ${amount.toFixed(2)}
      </span>
      <h1 className="text-[20px] font-medium text-fg" style={{ letterSpacing: "-0.02em" }}>
        Cashed{name ? `, ${name.split(" ")[0]}` : ""}
      </h1>
      <p className="max-w-xs text-[14px] text-fg-muted">
        It&apos;s in your Talise balance. Spend it, save it, or send it on — all gasless.
      </p>
      <a
        href="/app"
        className="mt-2 rounded-full bg-accent-deep px-6 py-3 text-[15px] font-semibold text-white shadow-[0_10px_30px_-12px_rgba(75,138,55,0.7)] transition-[filter] hover:brightness-110"
      >
        Open my wallet
      </a>
    </div>
  );
}

function ErrorInline({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex items-start gap-2 rounded-2xl px-4 py-3 text-[13px]"
      style={{
        background: "color-mix(in srgb, var(--color-danger) 12%, transparent)",
        color: "var(--color-danger)",
      }}
    >
      <HugeiconsIcon icon={Cancel01Icon} size={15} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}

/** Friendly copy for claim/release errors, incl. GATE_FAILED reasons. */
function gateError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 401 || e.code === "NOT_SIGNED_IN") {
      return "Please sign in to claim this cheque.";
    }
    if (e.code === "GATE_FAILED" || e.status === 403) {
      // Server returns reason-specific copy (captcha / vpn / country) in message.
      return e.message || "Claim blocked — turn off any VPN and try again.";
    }
    if (e.status === 409) {
      return "This cheque has already been claimed or has expired.";
    }
    if (e.message) return e.message;
  }
  return "Couldn't claim this cheque right now. Please try again.";
}
