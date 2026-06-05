"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Sheet } from "@/components/app/ui/Sheet";
import type {
  KycField,
  OnrampKycTier,
  SessionResult,
} from "@/lib/onramp/types";

/**
 * "Add money" (on-ramp) modal — quote-gated KYC scaffold.
 *
 * Flow: enter an amount → POST /api/onramp/v2/requirements → render ONLY the
 * KYC fields the amount requires (lite fields inline; an ID-upload prompt
 * only when standard+ is needed) → POST /api/onramp/v2/session → show the
 * provider widget placeholder.
 *
 * DORMANT by default: renders nothing unless NEXT_PUBLIC_ONRAMP_ENABLED is
 * "true". It is exported but intentionally NOT mounted in primary nav — wire
 * it from a dev/admin surface when ready. It never touches send/balance/limit
 * code; it only calls the additive /api/onramp/v2/* routes.
 *
 * Styled with the same tokens as the rest of /app (talise-glass, fg/accent,
 * Sheet surface).
 */

const ENABLED = process.env.NEXT_PUBLIC_ONRAMP_ENABLED === "true";

export interface AddMoneyModalProps {
  open: boolean;
  onClose: () => void;
  /** Optional prefill from the existing /api/me pattern. */
  prefill?: {
    name?: string | null;
    email?: string | null;
    country?: string | null;
  };
}

type RequirementsResponse = {
  provider: string;
  deliverAsset: "USDSUI" | "USDC";
  currentTier: OnrampKycTier;
  requiredTier: OnrampKycTier;
  missingFields: KycField[];
  satisfied: boolean;
};

const LITE_FIELD_LABELS: Partial<Record<KycField, string>> = {
  firstName: "First name",
  lastName: "Last name",
  email: "Email",
  mobile: "Mobile",
  country: "Country (ISO, e.g. US)",
  "address.line1": "Address line 1",
  "address.city": "City",
  "address.region": "State / region",
  "address.postalCode": "Postal code",
};

const DOC_FIELDS: KycField[] = [
  "governmentId",
  "selfie",
  "purposeOfUsage",
  "ssn",
  "proofOfAddress",
  "sourceOfFunds",
];

export function AddMoneyModal({ open, onClose, prefill }: AddMoneyModalProps) {
  const [amount, setAmount] = useState("");
  const [country, setCountry] = useState(prefill?.country ?? "");
  const [reqs, setReqs] = useState<RequirementsResponse | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [session, setSession] = useState<SessionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed lite prefills once we know the country/profile.
  useEffect(() => {
    if (!prefill) return;
    setFields((prev) => {
      const next = { ...prev };
      if (prefill.email && !next.email) next.email = prefill.email;
      if (prefill.country && !next.country) next.country = prefill.country;
      if (prefill.name && !next.firstName) {
        const [first, ...rest] = prefill.name.trim().split(/\s+/);
        if (first) next.firstName = first;
        if (rest.length && !next.lastName) next.lastName = rest.join(" ");
      }
      return next;
    });
  }, [prefill]);

  const amountCents = useMemo(() => {
    const n = Number(amount);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
  }, [amount]);

  const checkRequirements = useCallback(async () => {
    setError(null);
    setSession(null);
    if (amountCents <= 0) {
      setError("Enter an amount greater than 0.");
      return;
    }
    setLoading(true);
    try {
      const resp = await fetch("/api/onramp/v2/requirements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ amountCents, country: country || undefined }),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error ?? "Could not load requirements.");
      setReqs(json as RequirementsResponse);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [amountCents, country]);

  const liteFields = useMemo(
    () => (reqs?.missingFields ?? []).filter((f) => !DOC_FIELDS.includes(f)),
    [reqs]
  );
  const needsDocs = useMemo(
    () => (reqs?.missingFields ?? []).some((f) => DOC_FIELDS.includes(f)),
    [reqs]
  );

  const startSession = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const profile = {
        firstName: fields.firstName ?? "",
        lastName: fields.lastName ?? "",
        email: fields.email ?? prefill?.email ?? "",
        mobile: fields.mobile,
        country: fields.country || country,
        address: {
          line1: fields["address.line1"] ?? "",
          city: fields["address.city"] ?? "",
          region: fields["address.region"] ?? "",
          postalCode: fields["address.postalCode"] ?? "",
        },
      };
      const resp = await fetch("/api/onramp/v2/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ amountCents, profile }),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error ?? "Could not start session.");
      setSession(json as SessionResult);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [amountCents, country, fields, prefill]);

  if (!ENABLED) return null;

  return (
    <Sheet open={open} onClose={onClose} title="Add money" size="md">
      <div className="space-y-5 pb-2">
        {/* Amount */}
        <div>
          <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.18em] text-fg-dim">
            Amount (USD)
          </label>
          <div className="talise-glass flex items-center gap-2 rounded-xl px-4 py-3">
            <span className="font-display text-[18px] text-fg-muted">$</span>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="0.00"
              className="w-full bg-transparent text-[18px] tabular-nums text-fg outline-none placeholder:text-fg-dim"
            />
          </div>
        </div>

        {/* Country (if not on profile) */}
        {!prefill?.country && (
          <div>
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.18em] text-fg-dim">
              Country (ISO, e.g. US)
            </label>
            <div className="talise-glass rounded-xl px-4 py-3">
              <input
                value={country}
                onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))}
                placeholder="US"
                className="w-full bg-transparent text-[15px] text-fg outline-none placeholder:text-fg-dim"
              />
            </div>
          </div>
        )}

        {!reqs && (
          <button
            type="button"
            disabled={loading || amountCents <= 0}
            onClick={checkRequirements}
            className="talise-glass inline-flex w-full items-center justify-center rounded-full px-5 py-3 text-[14px] font-medium text-fg transition-colors hover:border-[color-mix(in_srgb,var(--color-accent-deep)_40%,var(--color-line))] disabled:opacity-50"
          >
            {loading ? "Checking…" : "Continue"}
          </button>
        )}

        {/* Requirements summary */}
        {reqs && (
          <div className="space-y-4">
            <p className="text-[13px] text-fg-dim">
              {reqs.satisfied
                ? `You're verified for this amount (${reqs.requiredTier}).`
                : `This amount needs ${reqs.requiredTier} verification.`}{" "}
              Funds arrive as{" "}
              <span className="text-fg-muted">{reqs.deliverAsset}</span> via{" "}
              <span className="text-fg-muted">{reqs.provider}</span>.
            </p>

            {/* Lite fields inline */}
            {liteFields.length > 0 && (
              <div className="space-y-3">
                {liteFields.map((f) => (
                  <div key={f}>
                    <label className="mb-1 block text-[12px] text-fg-dim">
                      {LITE_FIELD_LABELS[f] ?? f}
                    </label>
                    <div className="talise-glass rounded-xl px-4 py-2.5">
                      <input
                        value={fields[f] ?? ""}
                        onChange={(e) =>
                          setFields((p) => ({ ...p, [f]: e.target.value }))
                        }
                        className="w-full bg-transparent text-[15px] text-fg outline-none placeholder:text-fg-dim"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ID prompt — only for standard+ */}
            {needsDocs && (
              <div className="talise-glass rounded-xl px-4 py-3 text-[13px] text-fg-dim">
                This amount also requires an identity document
                {reqs.missingFields.includes("selfie") ? " + selfie" : ""}
                {reqs.missingFields.includes("ssn") ? " + SSN (US)" : ""}
                {reqs.missingFields.includes("sourceOfFunds")
                  ? " + source of funds"
                  : ""}
                . You'll complete this securely in the provider step.
              </div>
            )}

            {!session && (
              <button
                type="button"
                disabled={loading}
                onClick={startSession}
                className="inline-flex w-full items-center justify-center rounded-full bg-accent px-5 py-3 text-[14px] font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {loading ? "Starting…" : "Continue to payment"}
              </button>
            )}
          </div>
        )}

        {/* Provider widget placeholder */}
        {session && (
          <div className="talise-glass rounded-xl px-4 py-6 text-center">
            <p className="font-display text-[15px] font-semibold text-fg">
              Provider widget
            </p>
            <p className="mt-1.5 text-[12px] text-fg-dim">
              {session.requiresSwapToUsdsui
                ? "Delivers USDC, then swaps to USDsui."
                : "Delivers USDsui directly."}
            </p>
            {session.widgetUrl && (
              <p className="mt-3 break-all text-[11px] text-fg-muted">
                {session.widgetUrl}
              </p>
            )}
            {session.clientSecret && (
              <p className="mt-3 text-[11px] text-fg-muted">
                clientSecret ready — mount embedded SDK here.
              </p>
            )}
          </div>
        )}

        {error && <p className="text-[12px] text-red-400">{error}</p>}
      </div>
    </Sheet>
  );
}
