"use client";

/**
 * BankSelect — on-brand searchable bank picker (replaces the native <select>).
 *
 * A button that opens a search + scrollable list rendered inline (no portal,
 * so it always inherits the .app-clean theme). Click-outside + Escape close it.
 * Styled with the same surface/line/accent tokens as the rest of /app.
 */

import { useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  Search01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import type { LinqBank } from "@/lib/linq-banks";
import { bankLogo } from "@/lib/linq-banks";

/** Brand logo if we have one, else a letter avatar in the accent tint. */
function BankAvatar({ bank }: { bank: LinqBank }) {
  const logo = bankLogo(bank.bankCode);
  if (logo) {
    return (
      <span className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white ring-1 ring-line">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} alt="" className="size-full object-contain p-0.5" />
      </span>
    );
  }
  const initial = bank.name.trim()[0]?.toUpperCase() ?? "?";
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent-soft text-[12px] font-semibold text-accent">
      {initial}
    </span>
  );
}

export function BankSelect({
  banks,
  value,
  onChange,
  placeholder = "Select your bank",
}: {
  banks: readonly LinqBank[];
  value: string;
  onChange: (bankCode: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const selected = banks.find((b) => b.bankCode === value) ?? null;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? banks.filter((b) => b.name.toLowerCase().includes(needle))
    : banks;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-xl bg-surface px-3.5 py-2.5 text-left text-[15px] outline-none ring-1 ring-line transition-shadow focus:ring-accent"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          {selected && <BankAvatar bank={selected} />}
          <span className={`truncate ${selected ? "text-fg" : "text-fg-dim"}`}>
            {selected ? selected.name : placeholder}
          </span>
        </span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          size={18}
          strokeWidth={2}
          className={`shrink-0 text-fg-dim transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute z-50 mt-1.5 w-full overflow-hidden rounded-xl border border-line bg-surface shadow-[0_16px_44px_-14px_rgba(35,78,20,0.28)]">
          <div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
            <HugeiconsIcon icon={Search01Icon} size={16} strokeWidth={2} className="shrink-0 text-fg-dim" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search banks"
              className="w-full bg-transparent text-[14px] text-fg outline-none placeholder:text-fg-dim"
            />
          </div>
          <ul className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <li className="px-4 py-3 text-[13px] text-fg-dim">No banks match.</li>
            )}
            {filtered.map((b) => {
              const sel = b.bankCode === value;
              return (
                <li key={b.bankCode}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(b.bankCode);
                      setOpen(false);
                      setQ("");
                    }}
                    className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[14px] transition-colors hover:bg-accent-soft ${
                      sel ? "text-accent" : "text-fg"
                    }`}
                  >
                    <BankAvatar bank={b} />
                    <span className="min-w-0 flex-1 truncate">{b.name}</span>
                    {sel && (
                      <HugeiconsIcon icon={Tick02Icon} size={16} strokeWidth={2} className="shrink-0 text-accent" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

export default BankSelect;
