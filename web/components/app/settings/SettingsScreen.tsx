"use client";

/**
 * /app/settings — the account & preferences surface.
 *
 * Sections (each a GlassCard with an eyebrow title):
 *   1. Profile      — avatar, display name (editable → POST /api/settings),
 *                     claimed @handle OR the HandleClaimCard.
 *   2. Preferences  — display-currency picker, country, notify-on-receive.
 *   3. Wallet       — Sui address with copy + Suiscan, USDsui explainer.
 *   4. Account      — support, terms, and Sign out (→ /auth/logout).
 *
 * All reads come from useMe(); writes go through api()/POST /api/settings.
 * The /api/me payload does not expose notify-on-receive, so we mirror the
 * iOS behaviour: the toggle persists its last value in localStorage for a
 * consistent display and always writes through to the server.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Copy01Icon,
  Tick02Icon,
  ArrowUpRight01Icon,
  Notification01Icon,
  GlobalIcon,
  CheckmarkBadge02Icon,
  Logout01Icon,
  Wallet01Icon,
} from "@hugeicons/core-free-icons";
import {
  GlassCard,
  Eyebrow,
  PrimaryButton,
  Spinner,
  StatusPill,
  api,
  useMe,
  useToast,
} from "@/components/app";
import { HandleClaimCard } from "./HandleClaimCard";
import { CurrencyPicker } from "./CurrencyPicker";

// Talise's live + near-term corridor countries. `country` is stored as an
// ISO code (the settings route caps it at 8 chars); we show full names.
const COUNTRIES: { code: string; name: string }[] = [
  { code: "NG", name: "Nigeria" },
  { code: "GH", name: "Ghana" },
  { code: "KE", name: "Kenya" },
  { code: "ZA", name: "South Africa" },
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "CA", name: "Canada" },
  { code: "EU", name: "European Union" },
  { code: "SG", name: "Singapore" },
  { code: "PH", name: "Philippines" },
  { code: "ID", name: "Indonesia" },
  { code: "VN", name: "Vietnam" },
  { code: "JP", name: "Japan" },
];

const NOTIFY_KEY = "talise:notify-on-receive";

export function SettingsScreen() {
  const { me, loading, refresh } = useMe();
  const { toast } = useToast();

  // ── Profile name ────────────────────────────────────────────────────────
  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const initialName = useRef<string | null>(null);

  // ── Country ──────────────────────────────────────────────────────────────
  const [country, setCountry] = useState("");
  const [savingCountry, setSavingCountry] = useState(false);

  // ── Notify on receive ─────────────────────────────────────────────────────
  const [notify, setNotify] = useState(false);
  const [savingNotify, setSavingNotify] = useState(false);

  // ── Copy address ───────────────────────────────────────────────────────────
  const [copied, setCopied] = useState(false);

  // Hydrate from the loaded user + local notify mirror.
  useEffect(() => {
    if (!me) return;
    if (initialName.current === null) {
      initialName.current = me.name ?? "";
      setName(me.name ?? "");
    }
    setCountry((prev) => prev || me.country || "");
  }, [me]);

  useEffect(() => {
    try {
      setNotify(localStorage.getItem(NOTIFY_KEY) === "1");
    } catch {
      /* storage blocked — default off */
    }
  }, []);

  const nameDirty = useMemo(
    () => initialName.current !== null && name.trim() !== (initialName.current ?? ""),
    [name]
  );

  async function saveName() {
    if (!nameDirty || savingName) return;
    setSavingName(true);
    try {
      await api("/api/settings", { method: "POST", body: { name: name.trim() } });
      initialName.current = name.trim();
      toast("Name updated", "success");
      void refresh();
    } catch {
      toast("Couldn't save your name. Try again.", "danger");
    } finally {
      setSavingName(false);
    }
  }

  async function saveCountry(code: string) {
    const prev = country;
    setCountry(code);
    setSavingCountry(true);
    try {
      await api("/api/settings", { method: "POST", body: { country: code } });
      toast("Country updated", "success");
      void refresh();
    } catch {
      setCountry(prev);
      toast("Couldn't save your country. Try again.", "danger");
    } finally {
      setSavingCountry(false);
    }
  }

  async function toggleNotify(next: boolean) {
    const prev = notify;
    setNotify(next);
    setSavingNotify(true);
    try {
      await api("/api/settings", {
        method: "POST",
        body: { notifyOnReceive: next },
      });
      try {
        localStorage.setItem(NOTIFY_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      toast(next ? "Email alerts on" : "Email alerts off", "success");
    } catch {
      setNotify(prev);
      toast("Couldn't save your preference. Try again.", "danger");
    } finally {
      setSavingNotify(false);
    }
  }

  function copyAddress() {
    if (!me?.suiAddress) return;
    navigator.clipboard?.writeText(me.suiAddress).then(
      () => {
        setCopied(true);
        toast("Address copied", "success");
        setTimeout(() => setCopied(false), 1600);
      },
      () => toast("Couldn't copy. Long-press to select.", "danger")
    );
  }

  if (loading && !me) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner size={22} />
      </div>
    );
  }

  if (!me) {
    return (
      <GlassCard className="p-6">
        <p className="text-fg-muted">Sign in to manage your settings.</p>
      </GlassCard>
    );
  }

  const countryName =
    COUNTRIES.find((c) => c.code === country)?.name ?? country;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-8 pb-8">

      {/* ── Profile ──────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <Eyebrow>Profile</Eyebrow>
        <GlassCard className="divide-y divide-line overflow-hidden p-0" radius={14}>

          {/* Display name row */}
          <div className="px-5 py-4">
            <label className="block">
              <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.18em] text-fg-dim">
                Display name
              </span>
              <div className="flex items-center gap-2.5">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value.slice(0, 64))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void saveName();
                  }}
                  placeholder="Your name"
                  maxLength={64}
                  className="min-w-0 flex-1 rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-[15px] text-fg outline-none placeholder:text-fg-dim focus:border-accent focus:ring-1 focus:ring-accent/30 transition-colors"
                />
                <PrimaryButton
                  onClick={() => void saveName()}
                  disabled={!nameDirty}
                  loading={savingName}
                  variant={nameDirty ? "primary" : "ghost"}
                >
                  Save
                </PrimaryButton>
              </div>
            </label>
          </div>

          {/* Handle row */}
          <div className="px-5 py-4">
            {me.taliseHandle ? (
              <div className="flex items-center gap-3.5">
                <span
                  className="flex size-10 shrink-0 items-center justify-center rounded-full text-accent"
                  style={{ background: "var(--color-accent-soft)" }}
                >
                  <HugeiconsIcon
                    icon={CheckmarkBadge02Icon}
                    size={20}
                    strokeWidth={1.8}
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-medium text-fg">Your handle</p>
                  <p className="mt-0.5 break-all font-mono text-[13px] text-fg-muted">
                    @{me.taliseHandle}.talise.sui
                  </p>
                  <p className="mt-1 text-[12px] leading-relaxed text-fg-dim">
                    Anyone can pay you at this name. Handles are minted on SuiNS
                    and can&apos;t be changed.
                  </p>
                </div>
              </div>
            ) : (
              <HandleClaimCard onClaimed={() => void refresh()} />
            )}
          </div>

        </GlassCard>
      </section>

      {/* Business account switch — pulled from the beta surface for now
          (2026-06-11). Re-add <BusinessAccountCard /> here when the business
          workspace is ready for testers. */}

      {/* ── Preferences ──────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <Eyebrow>Preferences</Eyebrow>
        <GlassCard className="divide-y divide-line overflow-hidden p-0" radius={14}>

          {/* Display currency — CurrencyPicker renders its own row markup */}
          <CurrencyPicker />

          {/* Country */}
          <label className="flex w-full cursor-pointer items-center gap-3.5 px-5 py-3.5 transition-colors hover:bg-surface-2">
            <span
              className="flex size-10 shrink-0 items-center justify-center rounded-full text-accent"
              style={{ background: "var(--color-accent-soft)" }}
            >
              <HugeiconsIcon icon={GlobalIcon} size={20} strokeWidth={1.8} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium text-fg">
                Country
              </span>
              <span className="block truncate text-[13px] text-fg-dim">
                Helps us show the right ramps and rails.
              </span>
            </span>
            <span className="relative flex shrink-0 items-center gap-1.5">
              {savingCountry ? (
                <Spinner size={15} />
              ) : (
                <>
                  <span className="rounded-full bg-surface-2 px-3 py-1 text-[13px] font-medium text-fg">
                    {countryName || "Select"}
                  </span>
                  <select
                    value={country}
                    onChange={(e) => void saveCountry(e.target.value)}
                    aria-label="Country"
                    className="absolute inset-0 cursor-pointer opacity-0"
                  >
                    <option value="" disabled>
                      Select your country
                    </option>
                    {COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </span>
          </label>

          {/* Notify on receive — UNAVAILABLE for now (2026-06-11): greyed,
              Soon-pilled, toggle disabled. Restore the live Toggle (on={notify}
              busy={savingNotify} onChange={toggleNotify}) when receive emails
              are back on. */}
          <div className="flex w-full items-center gap-3.5 px-5 py-3.5 opacity-90">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-black/[0.04] text-fg-dim">
              <HugeiconsIcon
                icon={Notification01Icon}
                size={20}
                strokeWidth={1.8}
              />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-[15px] font-medium text-fg-muted">
                Email me when I receive
                <StatusPill label="Soon" tone="neutral" />
              </span>
              <span className="block truncate text-[13px] text-fg-dim">
                One short email per incoming transfer.
              </span>
            </span>
            <Toggle on={false} busy={false} disabled onChange={() => {}} />
          </div>

        </GlassCard>
      </section>

      {/* ── Wallet ───────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <Eyebrow>Wallet</Eyebrow>
        <GlassCard className="divide-y divide-line overflow-hidden p-0" radius={14}>

          {/* Sui address */}
          <div className="flex items-center gap-3.5 px-5 py-4">
            <span
              className="flex size-10 shrink-0 items-center justify-center rounded-full text-accent"
              style={{ background: "var(--color-accent-soft)" }}
            >
              <HugeiconsIcon icon={Wallet01Icon} size={20} strokeWidth={1.8} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-medium text-fg">Sui address</p>
              <p
                className="mt-0.5 break-all font-mono text-[12px] leading-relaxed text-fg-muted"
                title={me.suiAddress}
              >
                {me.suiAddress}
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2.5 px-5 py-4">
            <button
              type="button"
              onClick={copyAddress}
              className="inline-flex items-center gap-2 rounded-full border border-line bg-surface-2 px-4 py-2 text-sm font-medium text-fg transition-colors hover:border-accent/40 hover:bg-accent-soft active:scale-[0.97]"
            >
              <HugeiconsIcon
                icon={copied ? Tick02Icon : Copy01Icon}
                size={16}
                className={copied ? "text-accent" : "text-fg-muted"}
                strokeWidth={2}
              />
              {copied ? "Copied" : "Copy address"}
            </button>
            <a
              href={`https://suiscan.xyz/mainnet/account/${me.suiAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-line bg-surface-2 px-4 py-2 text-sm font-medium text-fg transition-colors hover:border-accent/40 hover:bg-accent-soft active:scale-[0.97]"
            >
              <HugeiconsIcon
                icon={ArrowUpRight01Icon}
                size={16}
                className="text-fg-muted"
                strokeWidth={2}
              />
              View on Suiscan
            </a>
          </div>

          {/* USDsui explainer */}
          <div className="px-5 py-4">
            <p className="text-[12px] leading-relaxed text-fg-dim">
              Your balance is held in USDsui — a fully-backed dollar stablecoin on
              Sui, always 1:1 with USD. The currency you pick above only changes
              how amounts are shown.
            </p>
          </div>

        </GlassCard>
      </section>

      {/* ── Account ──────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <Eyebrow>Account</Eyebrow>
        <GlassCard className="divide-y divide-line overflow-hidden p-0" radius={14}>
          <a
            href="/auth/logout"
            className="flex w-full items-center gap-3.5 px-5 py-3.5 transition-colors hover:bg-surface-2"
          >
            <span
              className="flex size-10 shrink-0 items-center justify-center rounded-full"
              style={{
                background: "color-mix(in srgb, var(--color-danger) 12%, var(--color-surface-2))",
              }}
            >
              <HugeiconsIcon
                icon={Logout01Icon}
                size={18}
                strokeWidth={2}
                style={{ color: "var(--color-danger)" }}
              />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium" style={{ color: "var(--color-danger)" }}>
                Sign out
              </span>
              <span className="block text-[13px] text-fg-dim">
                Your wallet stays safe — sign back in anytime.
              </span>
            </span>
          </a>
        </GlassCard>
      </section>

    </div>
  );
}

/** Compact toggle switch — matches Wise-style on/off for preferences. */
function Toggle({
  on,
  busy,
  disabled,
  onChange,
}: {
  on: boolean;
  busy?: boolean;
  /** Hard-unavailable (feature not live) — distinct from a transient busy. */
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Email me when I receive"
      disabled={busy || disabled}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
        on ? "bg-accent-deep" : "border border-line bg-surface-2"
      }`}
    >
      <span
        className={`absolute flex size-5 items-center justify-center rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.18)] transition-transform ${
          on ? "translate-x-[22px]" : "translate-x-[3px]"
        }`}
      >
        {busy && <Spinner size={11} />}
      </span>
    </button>
  );
}
