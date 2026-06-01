"use client";

import { useState } from "react";

export function SettingsForm({
  initialName,
  initialBusinessName,
  initialIndustry,
  initialCountry,
  initialNotify,
  isBusiness,
}: {
  initialName: string;
  initialBusinessName: string;
  initialIndustry: string;
  initialCountry: string;
  initialNotify: boolean;
  isBusiness: boolean;
}) {
  const [name, setName] = useState(initialName);
  const [businessName, setBusinessName] = useState(initialBusinessName);
  const [industry, setIndustry] = useState(initialIndustry);
  const [country, setCountry] = useState(initialCountry);
  const [notify, setNotify] = useState(initialNotify);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const dirty =
    name !== initialName ||
    businessName !== initialBusinessName ||
    industry !== initialIndustry ||
    country !== initialCountry ||
    notify !== initialNotify;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    setSaved(false);
    try {
      const r = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          businessName: isBusiness ? businessName : undefined,
          businessIndustry: isBusiness ? industry : undefined,
          country,
          notifyOnReceive: notify,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "save failed");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-5 rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-6">
      <Field label="Display name">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Sele"
          className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2.5 text-[14px] text-[var(--color-fg)] placeholder:text-[var(--color-fg-dim)] focus:border-[var(--color-fg)] focus:outline-none"
        />
      </Field>

      {isBusiness && (
        <>
          <Field label="Business name">
            <input
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="Café Sole"
              className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2.5 text-[14px] text-[var(--color-fg)] placeholder:text-[var(--color-fg-dim)] focus:border-[var(--color-fg)] focus:outline-none"
            />
          </Field>
          <Field label="Industry">
            <input
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              placeholder="Café · Salon · Software · Freelance"
              className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2.5 text-[14px] text-[var(--color-fg)] placeholder:text-[var(--color-fg-dim)] focus:border-[var(--color-fg)] focus:outline-none"
            />
          </Field>
        </>
      )}

      <Field label="Country / city (optional)">
        <input
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          placeholder="Buenos Aires · Lagos · Manila"
          className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2.5 text-[14px] text-[var(--color-fg)] placeholder:text-[var(--color-fg-dim)] focus:border-[var(--color-fg)] focus:outline-none"
        />
      </Field>

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] p-4">
        <input
          type="checkbox"
          checked={notify}
          onChange={(e) => setNotify(e.target.checked)}
          className="mt-1 h-4 w-4 accent-[var(--color-fg)]"
        />
        <div>
          <div className="text-[13px] text-[var(--color-fg)]">
            Email me when I receive a payment
          </div>
          <div className="mt-0.5 text-[11px] text-[var(--color-fg-muted)]">
            One-line confirmation with a Suiscan link. No marketing.
          </div>
        </div>
      </label>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!dirty || saving}
          className="rounded-md bg-[var(--color-fg)] px-4 py-2 text-[13px] font-medium text-[var(--color-bg)] transition hover:bg-[var(--color-accent-soft)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        {saved && (
          <span className="text-[12px] text-[var(--color-fg-muted)]">
            ✓ Saved
          </span>
        )}
        {err && (
          <span className="text-[12px] text-[var(--color-fg)]">! {err}</span>
        )}
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 text-[11px] uppercase tracking-[0.16em] text-[var(--color-fg-dim)]">
        {label}
      </div>
      {children}
    </label>
  );
}
