"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeHandle, RESERVED_USERNAMES, USERNAME_RE } from "@/lib/handle";
import { ErrorBox } from "@/components/ErrorBox";
import { UsernameCard } from "@/components/UsernameCard";

type CheckState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "ok" }
  | { status: "bad"; reason: string };

export function ClaimForm({ address }: { address: string }) {
  const [raw, setRaw] = useState("");
  const [check, setCheck] = useState<CheckState>({ status: "idle" });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const normalized = useMemo(() => normalizeHandle(raw), [raw]);
  const localError = useMemo(() => {
    if (!raw) return null;
    const cleaned = raw
      .trim()
      .toLowerCase()
      .replace(/^@/, "")
      .replace(/@talise$/, "")
      .replace(/\.talise\.sui$/, "");
    if (!cleaned) return null;
    if (cleaned.length < 3) return "Too short — 3 characters minimum.";
    if (cleaned.length > 20) return "Too long — 20 characters maximum.";
    if (!USERNAME_RE.test(cleaned))
      return "Only lowercase a–z, 0–9, and _ allowed.";
    if (RESERVED_USERNAMES.has(cleaned)) return "That username is reserved.";
    return null;
  }, [raw]);

  // Debounced availability check
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!normalized) {
      setCheck({ status: "idle" });
      return;
    }
    if (localError) {
      setCheck({ status: "bad", reason: localError });
      return;
    }
    setCheck({ status: "checking" });
    timer.current = setTimeout(async () => {
      try {
        const r = await fetch(
          `/api/username/check?u=${encodeURIComponent(normalized)}`,
          { cache: "no-store" }
        );
        const j = (await r.json()) as { available: boolean; reason?: string };
        if (j.available) {
          setCheck({ status: "ok" });
        } else {
          setCheck({
            status: "bad",
            reason:
              j.reason === "taken"
                ? "That username is taken."
                : j.reason === "reserved"
                  ? "That username is reserved."
                  : "Not a valid username.",
          });
        }
      } catch {
        setCheck({ status: "bad", reason: "Couldn't check availability." });
      }
    }, 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [normalized, localError]);

  const canSubmit = check.status === "ok" && !submitting && !!normalized;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!normalized) {
      setErr("Pick a valid username.");
      return;
    }
    setSubmitting(true);
    try {
      const r = await fetch("/api/username/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: normalized }),
      });
      const j = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok || !j.ok) throw new Error(j.error ?? "Could not claim.");
      window.location.href = "/home";
    } catch (e) {
      setErr((e as Error).message);
      setSubmitting(false);
    }
  }

  // Preview uses either the live normalized username or a placeholder.
  const previewUsername = normalized ?? "yourname";

  return (
    <div className="grid gap-8 md:grid-cols-[1.1fr,1fr]">
      <div>
        <UsernameCard username={previewUsername} address={address} size="lg" />
        <p className="mt-4 text-[12px] text-[var(--color-fg-dim)]">
          Live preview. Your handle is permanent for now — choose carefully.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-5">
        <div>
          <label className="mb-1.5 block text-[11px] uppercase tracking-[0.18em] text-[var(--color-fg-dim)]">
            Choose your username
          </label>
          <div className="relative">
            <input
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder="sele"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              maxLength={32}
              className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-3 pr-24 font-mono text-[14px] text-[var(--color-fg)] placeholder:text-[var(--color-fg-dim)] focus:border-[var(--color-fg)] focus:outline-none"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[12px] text-[var(--color-fg-dim)]">
              @talise
            </span>
          </div>
          <div className="mt-2 min-h-[18px] text-[11px]">
            {check.status === "checking" && (
              <span className="text-[var(--color-fg-dim)]">checking…</span>
            )}
            {check.status === "ok" && (
              <span className="text-[var(--color-fg)]">
                {normalized}@talise is available.
              </span>
            )}
            {check.status === "bad" && (
              <span className="text-[var(--color-fg-muted)]">{check.reason}</span>
            )}
          </div>
        </div>

        <ul className="space-y-1 text-[11px] text-[var(--color-fg-dim)]">
          <li>3–20 characters</li>
          <li>lowercase a–z, 0–9, and underscore only</li>
          <li>permanent — no renames for now</li>
        </ul>

        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full rounded-md bg-[var(--color-fg)] px-5 py-3.5 text-[15px] font-medium text-[var(--color-bg)] transition hover:bg-[var(--color-accent-soft)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting
            ? "Claiming…"
            : normalized && check.status === "ok"
              ? `Claim ${normalized}@talise`
              : "Pick a username"}
        </button>

        {err && <ErrorBox message={err} />}
      </form>
    </div>
  );
}
