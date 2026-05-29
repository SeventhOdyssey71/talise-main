"use client";

import { useMemo, useState } from "react";

function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export function AddBusinessForm() {
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [industry, setIndustry] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const autoHandle = useMemo(() => slugify(name), [name]);
  const effective = handle || autoHandle;
  const ready = name.trim().length >= 2 && effective.length >= 2;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    try {
      const r = await fetch("/api/account/add-business", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: name.trim(),
          businessHandle: effective,
          businessIndustry: industry.trim() || null,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "failed");
      window.location.href = j.redirect ?? "/business";
    } catch (e) {
      setErr((e as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      id="add-business"
      className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-6"
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-fg-dim)]">
        Add a business account
      </div>
      <h3 className="mt-2 text-[18px] font-semibold tracking-tight text-[var(--color-fg)]">
        Accept payments as a business.
      </h3>
      <p className="mt-1 max-w-md text-[13px] leading-relaxed text-[var(--color-fg-muted)]">
        Same Google account, same Sui address, second context. Customers pay
        you at <span className="font-mono text-[var(--color-fg)]">talise.io/p/{effective || "your-handle"}</span>.
      </p>

      <div className="mt-6 space-y-4">
        <Field label="Business name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Café Sole"
            className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2.5 text-[14px] text-[var(--color-fg)] placeholder:text-[var(--color-fg-dim)] focus:border-[var(--color-fg)] focus:outline-none"
          />
        </Field>
        <Field label="Payment handle">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[13px] text-[var(--color-fg-dim)]">
              talise.io/p/
            </span>
            <input
              value={handle || autoHandle}
              onChange={(e) => setHandle(slugify(e.target.value))}
              placeholder="cafe-sole"
              className="flex-1 rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2.5 font-mono text-[13px] text-[var(--color-fg)] placeholder:text-[var(--color-fg-dim)] focus:border-[var(--color-fg)] focus:outline-none"
            />
          </div>
        </Field>
        <Field label="Industry (optional)">
          <input
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            placeholder="Café · Salon · Freelance · SaaS"
            className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2.5 text-[14px] text-[var(--color-fg)] placeholder:text-[var(--color-fg-dim)] focus:border-[var(--color-fg)] focus:outline-none"
          />
        </Field>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button
          type="submit"
          disabled={!ready || submitting}
          className="rounded-md bg-[var(--color-fg)] px-4 py-2 text-[13px] font-medium text-[var(--color-bg)] transition hover:bg-[var(--color-accent-soft)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? "Adding…" : "Create business account →"}
        </button>
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
