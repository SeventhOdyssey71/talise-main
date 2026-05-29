"use client";

import { useState } from "react";

export function PayLookup() {
  const [input, setInput] = useState("");

  function extractHandle(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) return "";
    // Accept full URLs or paths or @handle or bare handle
    try {
      const u = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
      const segs = u.pathname.split("/").filter(Boolean);
      // /p/<handle> or /@handle
      const last = segs[segs.length - 1] ?? "";
      return last.replace(/^@/, "").toLowerCase();
    } catch {
      return trimmed.replace(/^@/, "").toLowerCase();
    }
  }

  const handle = extractHandle(input);
  const valid = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(handle);

  function go(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    window.location.href = `/p/${handle}`;
  }

  return (
    <form onSubmit={go} className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-[14px] text-[var(--color-fg-dim)]">talise.io/p/</span>
        <input
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="cafe-sole"
          className="flex-1 rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-3 font-mono text-[14px] text-[var(--color-fg)] placeholder:text-[var(--color-fg-dim)] focus:border-[var(--color-fg)] focus:outline-none"
        />
      </div>
      {input && !valid && (
        <p className="text-[11px] text-[var(--color-fg)]">
          ! Handles use a–z, 0–9, hyphens. Paste a link or just the handle.
        </p>
      )}
      <button
        type="submit"
        disabled={!valid}
        className="rounded-md bg-[var(--color-fg)] px-4 py-2.5 text-[14px] font-medium text-[var(--color-bg)] transition hover:bg-[var(--color-accent-soft)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        Open payment page →
      </button>
    </form>
  );
}
