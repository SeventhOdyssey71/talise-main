"use client";

import { useState } from "react";

export function AccountSwitcher({
  current,
  hasBusiness,
}: {
  current: "personal" | "business";
  hasBusiness: boolean;
}) {
  const [switching, setSwitching] = useState<null | "personal" | "business">(null);

  async function go(to: "personal" | "business") {
    if (to === current) return;
    if (to === "business" && !hasBusiness) {
      window.location.href = "/settings#add-business";
      return;
    }
    setSwitching(to);
    try {
      const r = await fetch("/api/account/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "switch failed");
      window.location.href = j.redirect ?? "/home";
    } catch {
      setSwitching(null);
    }
  }

  return (
    <div className="grid grid-cols-2 gap-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] p-1">
      <Pill
        label="Personal"
        active={current === "personal"}
        loading={switching === "personal"}
        onClick={() => go("personal")}
      />
      <Pill
        label={hasBusiness ? "Business" : "+ Business"}
        active={current === "business"}
        loading={switching === "business"}
        onClick={() => go("business")}
        muted={!hasBusiness}
      />
    </div>
  );
}

function Pill({
  label,
  active,
  loading,
  muted,
  onClick,
}: {
  label: string;
  active: boolean;
  loading: boolean;
  muted?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className={`rounded-md py-1.5 font-mono text-[11px] uppercase tracking-wider transition ${
        active
          ? "bg-[var(--color-fg)] text-[var(--color-bg)]"
          : muted
            ? "text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
            : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
      }`}
    >
      {loading ? "…" : label}
    </button>
  );
}
