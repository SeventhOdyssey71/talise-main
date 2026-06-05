"use client";

/**
 * BusinessAccountCard — switch between the personal wallet (/app) and the
 * business workspace (/business), and set up a business profile on first use.
 *
 * Model (web/lib/db.ts): a user has one account with an optional business
 * profile (`business_handle`). `account_type` is the ACTIVE context.
 *   • Switch to business → POST /api/account/switch {to:"business"}. If no
 *     profile exists yet the route 400s ("not set up") → we reveal the setup
 *     form, POST /api/account/add-business (which creates the profile AND flips
 *     the context to business), then land on /business.
 *   • Switch to personal → POST /api/account/switch {to:"personal"} → /app.
 * A full navigation (location.href) re-runs the layout gate so the right shell
 * mounts.
 */

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Building06Icon, UserIcon } from "@hugeicons/core-free-icons";
import { GlassCard, Eyebrow, PrimaryButton, api, ApiError, useMe } from "@/components/app";

export function BusinessAccountCard() {
  const { me } = useMe();
  const isBusiness = me?.accountType === "business";

  const [setupOpen, setSetupOpen] = useState(false);
  const [bizName, setBizName] = useState("");
  const [bizHandle, setBizHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function switchTo(to: "business" | "personal") {
    setBusy(true);
    setError(null);
    try {
      await api("/api/account/switch", { method: "POST", body: { to } });
      window.location.href = to === "business" ? "/business/dashboard" : "/app";
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Could not switch accounts.";
      if (to === "business" && /not set up/i.test(msg)) {
        setSetupOpen(true);
      } else {
        setError(msg);
      }
      setBusy(false);
    }
  }

  async function createBusiness() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/account/add-business", {
        method: "POST",
        body: { businessName: bizName.trim(), businessHandle: bizHandle.trim().toLowerCase() },
      });
      // add-business also flips account_type to business → land on the dashboard.
      window.location.href = "/business/dashboard";
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not set up the business account.");
      setBusy(false);
    }
  }

  const handleValid = bizName.trim().length >= 2 && /^[a-z0-9_]{3,}$/.test(bizHandle.trim().toLowerCase());

  return (
    <section className="space-y-2.5">
      <Eyebrow>Business</Eyebrow>
      <GlassCard className="space-y-4 p-5">
        <div className="flex items-start gap-3.5">
          <span
            className="flex size-10 shrink-0 items-center justify-center rounded-full text-accent"
            style={{ background: "var(--color-accent-soft)" }}
          >
            <HugeiconsIcon icon={isBusiness ? UserIcon : Building06Icon} size={20} strokeWidth={1.8} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-medium text-fg">
              {isBusiness ? "Business workspace" : "Business account"}
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-fg-muted">
              {isBusiness
                ? "You're in the business workspace — invoices, team payroll, and cash-out. Switch back to your personal wallet any time."
                : "Invoice clients and pay your whole team from a dedicated workspace, on the same balance."}
            </p>
          </div>
        </div>

        {!isBusiness && setupOpen && (
          <div className="space-y-3 border-t border-line pt-4">
            <label className="block">
              <Eyebrow className="mb-1.5 block">Business name</Eyebrow>
              <input
                value={bizName}
                onChange={(e) => setBizName(e.target.value.slice(0, 64))}
                placeholder="Acme Inc."
                className="talise-glass w-full bg-transparent px-4 py-2.5 text-[15px] text-fg outline-none placeholder:text-fg-dim"
                style={{ borderRadius: 14 }}
              />
            </label>
            <label className="block">
              <Eyebrow className="mb-1.5 block">Business handle</Eyebrow>
              <input
                value={bizHandle}
                onChange={(e) => setBizHandle(e.target.value.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase().slice(0, 32))}
                placeholder="acme"
                className="talise-glass w-full bg-transparent px-4 py-2.5 font-mono text-[15px] text-fg outline-none placeholder:text-fg-dim"
                style={{ borderRadius: 14 }}
              />
              <span className="mt-1 block text-[12px] text-fg-dim">
                Clients pay you at @{bizHandle.trim() || "yourbusiness"}.talise.sui
              </span>
            </label>
          </div>
        )}

        {error && <p className="text-[13px] text-red-500">{error}</p>}

        {isBusiness ? (
          <PrimaryButton onClick={() => void switchTo("personal")} loading={busy} variant="ghost">
            Switch to personal
          </PrimaryButton>
        ) : setupOpen ? (
          <div className="flex items-center gap-2.5">
            <PrimaryButton onClick={() => void createBusiness()} disabled={!handleValid || busy} loading={busy}>
              Create business account
            </PrimaryButton>
            <PrimaryButton onClick={() => { setSetupOpen(false); setError(null); }} variant="ghost">
              Cancel
            </PrimaryButton>
          </div>
        ) : (
          <PrimaryButton onClick={() => void switchTo("business")} loading={busy}>
            Switch to business
          </PrimaryButton>
        )}
      </GlassCard>
    </section>
  );
}

export default BusinessAccountCard;
