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
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Copy01Icon,
  Tick02Icon,
  ArrowUpRight01Icon,
  Notification01Icon,
  GlobalIcon,
  CheckmarkBadge02Icon,
  Logout01Icon,
  Mail01Icon,
  Notebook01Icon,
  Wallet01Icon,
} from "@hugeicons/core-free-icons";
import {
  GlassCard,
  Eyebrow,
  PrimaryButton,
  Spinner,
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

function shortAddr(a: string): string {
  if (a.length <= 14) return a;
  return `${a.slice(0, 8)}…${a.slice(-6)}`;
}

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

  const initials =
    (me.taliseHandle?.[0] ||
      me.name?.trim()?.[0] ||
      me.email?.[0] ||
      "·").toUpperCase();

  const countryName =
    COUNTRIES.find((c) => c.code === country)?.name ?? country;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-7 pb-8">
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col items-center gap-3 pt-1 text-center">
        {me.picture ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={me.picture}
            alt=""
            className="size-20 rounded-full border border-white/10 object-cover shadow-[0_10px_28px_-12px_rgba(0,0,0,0.6)]"
          />
        ) : (
          <div className="flex size-20 items-center justify-center rounded-full border border-white/10 bg-surface-2 text-[28px] font-medium text-fg shadow-[0_10px_28px_-12px_rgba(0,0,0,0.6)]">
            {initials}
          </div>
        )}
        <div className="space-y-1">
          <h1 className="text-[22px] font-medium tracking-[-0.02em] text-fg">
            {me.name || "Your account"}
          </h1>
          {me.taliseHandle ? (
            <span className="inline-flex items-center gap-1.5 text-fg-muted">
              <HugeiconsIcon
                icon={CheckmarkBadge02Icon}
                size={14}
                className="text-accent"
                strokeWidth={2}
              />
              <span className="font-mono text-[12px]">
                @{me.taliseHandle}.talise.sui
              </span>
            </span>
          ) : (
            <span className="font-mono text-[12px] text-fg-dim">{me.email}</span>
          )}
        </div>
      </div>

      {/* ── Profile ──────────────────────────────────────────────────────── */}
      <section className="space-y-2.5">
        <Eyebrow>Profile</Eyebrow>
        <GlassCard className="space-y-5 p-5">
          <label className="block">
            <Eyebrow className="mb-2 block">Display name</Eyebrow>
            <div className="flex items-center gap-2.5">
              <input
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, 64))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveName();
                }}
                placeholder="Your name"
                maxLength={64}
                className="talise-glass min-w-0 flex-1 bg-transparent px-4 py-3 text-[15px] text-fg outline-none placeholder:text-fg-dim"
                style={{ borderRadius: 14 }}
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

          <div className="border-t border-line pt-5">
            {me.taliseHandle ? (
              <div className="flex items-start gap-3.5">
                <span
                  className="flex size-10 shrink-0 items-center justify-center rounded-full text-accent"
                  style={{
                    background:
                      "color-mix(in srgb, var(--color-accent) 12%, transparent)",
                  }}
                >
                  <HugeiconsIcon
                    icon={CheckmarkBadge02Icon}
                    size={20}
                    strokeWidth={1.8}
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-medium text-fg">Your handle</p>
                  <p className="break-all font-mono text-[13px] text-fg-muted">
                    @{me.taliseHandle}.talise.sui
                  </p>
                  <p className="mt-1 text-[12px] text-fg-dim">
                    Anyone can pay you at this name. Handles are minted on SuiNS
                    and can't be changed.
                  </p>
                </div>
              </div>
            ) : (
              <HandleClaimCard onClaimed={() => void refresh()} />
            )}
          </div>
        </GlassCard>
      </section>

      {/* ── Preferences ──────────────────────────────────────────────────── */}
      <section className="space-y-2.5">
        <Eyebrow>Preferences</Eyebrow>
        <div className="space-y-2">
          <CurrencyPicker />

          {/* Country */}
          <label className="talise-history-row flex w-full cursor-pointer items-center gap-3.5 px-3.5 py-3">
            <span
              className="flex size-10 shrink-0 items-center justify-center rounded-full text-accent"
              style={{
                background:
                  "color-mix(in srgb, var(--color-accent) 12%, transparent)",
              }}
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
                  <span className="text-[14px] text-fg">
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

          {/* Notify on receive */}
          <div className="talise-history-row flex w-full items-center gap-3.5 px-3.5 py-3">
            <span
              className="flex size-10 shrink-0 items-center justify-center rounded-full text-accent"
              style={{
                background:
                  "color-mix(in srgb, var(--color-accent) 12%, transparent)",
              }}
            >
              <HugeiconsIcon
                icon={Notification01Icon}
                size={20}
                strokeWidth={1.8}
              />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium text-fg">
                Email me when I receive
              </span>
              <span className="block truncate text-[13px] text-fg-dim">
                One short email per incoming transfer.
              </span>
            </span>
            <Toggle
              on={notify}
              busy={savingNotify}
              onChange={(v) => void toggleNotify(v)}
            />
          </div>
        </div>
      </section>

      {/* ── Wallet ───────────────────────────────────────────────────────── */}
      <section className="space-y-2.5">
        <Eyebrow>Wallet</Eyebrow>
        <GlassCard className="space-y-4 p-5">
          <div className="flex items-start gap-3.5">
            <span
              className="flex size-10 shrink-0 items-center justify-center rounded-full text-accent"
              style={{
                background:
                  "color-mix(in srgb, var(--color-accent) 12%, transparent)",
              }}
            >
              <HugeiconsIcon icon={Wallet01Icon} size={20} strokeWidth={1.8} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-medium text-fg">Sui address</p>
              <p
                className="break-all font-mono text-[12px] leading-relaxed text-fg-muted"
                title={me.suiAddress}
              >
                {me.suiAddress}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2.5 border-t border-line pt-4">
            <button
              type="button"
              onClick={copyAddress}
              className="talise-glass inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-fg transition-[transform,border-color] hover:border-white/15 active:scale-[0.97]"
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
              className="talise-glass inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-fg transition-[transform,border-color] hover:border-white/15 active:scale-[0.97]"
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

          <p className="text-[12px] leading-relaxed text-fg-dim">
            Your balance is held in USDsui — a fully-backed dollar stablecoin on
            Sui, always 1:1 with USD. The currency you pick above only changes
            how amounts are shown.
          </p>
        </GlassCard>
      </section>

      {/* ── Account ──────────────────────────────────────────────────────── */}
      <section className="space-y-2.5">
        <Eyebrow>Account</Eyebrow>
        <div className="space-y-2">
          <a
            href="mailto:hello@talise.io"
            className="talise-history-row flex w-full items-center gap-3.5 px-3.5 py-3 transition-transform hover:-translate-y-px"
          >
            <span
              className="flex size-10 shrink-0 items-center justify-center rounded-full text-accent"
              style={{
                background:
                  "color-mix(in srgb, var(--color-accent) 12%, transparent)",
              }}
            >
              <HugeiconsIcon icon={Mail01Icon} size={20} strokeWidth={1.8} />
            </span>
            <span className="flex-1 text-[15px] font-medium text-fg">
              Contact support
            </span>
            <HugeiconsIcon
              icon={ArrowUpRight01Icon}
              size={16}
              className="text-fg-dim"
              strokeWidth={2}
            />
          </a>

          <Link
            href="/legal"
            className="talise-history-row flex w-full items-center gap-3.5 px-3.5 py-3 transition-transform hover:-translate-y-px"
          >
            <span
              className="flex size-10 shrink-0 items-center justify-center rounded-full text-accent"
              style={{
                background:
                  "color-mix(in srgb, var(--color-accent) 12%, transparent)",
              }}
            >
              <HugeiconsIcon icon={Notebook01Icon} size={20} strokeWidth={1.8} />
            </span>
            <span className="flex-1 text-[15px] font-medium text-fg">
              Terms &amp; Privacy
            </span>
            <HugeiconsIcon
              icon={ArrowUpRight01Icon}
              size={16}
              className="text-fg-dim"
              strokeWidth={2}
            />
          </Link>
        </div>

        <a
          href="/auth/logout"
          className="mt-1 flex w-full items-center justify-center gap-2 rounded-full border border-[color-mix(in_srgb,var(--color-danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)] px-6 py-3.5 text-[15px] font-semibold text-[var(--color-danger)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-danger)_18%,transparent)]"
        >
          <HugeiconsIcon icon={Logout01Icon} size={17} strokeWidth={2} />
          Sign out
        </a>
        <p className="text-center text-[11px] text-fg-dim">
          Your wallet stays safe. Sign back in with the same Google account
          anytime.
        </p>
      </section>
    </div>
  );
}

/** Compact glass toggle switch. */
function Toggle({
  on,
  busy,
  onChange,
}: {
  on: boolean;
  busy?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Email me when I receive"
      disabled={busy}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
        on ? "bg-accent-deep" : "bg-white/12"
      }`}
    >
      <span
        className={`absolute flex size-5 items-center justify-center rounded-full bg-white shadow transition-transform ${
          on ? "translate-x-[22px]" : "translate-x-[3px]"
        }`}
      >
        {busy && <Spinner size={11} />}
      </span>
    </button>
  );
}
