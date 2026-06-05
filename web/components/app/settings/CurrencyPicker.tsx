"use client";

/**
 * Display-currency picker for /app/settings.
 *
 * A glass row showing the active currency that opens a Sheet listing all 13
 * supported display currencies. Selecting one calls useCurrency().setCurrency
 * (persisted in localStorage). This is DISPLAY-ONLY — the wallet always
 * settles in USDsui.
 */

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { UnfoldMoreIcon, Tick02Icon } from "@hugeicons/core-free-icons";
import { Sheet, useCurrency, Flag } from "@/components/app";

export function CurrencyPicker() {
  const { currency, setCurrency, currencies } = useCurrency();
  const [open, setOpen] = useState(false);
  const active = currencies.find((c) => c.code === currency) ?? currencies[0];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="talise-history-row flex w-full items-center gap-3.5 px-3.5 py-3 text-left transition-transform hover:-translate-y-px"
      >
        <Flag code={currency} size={40} className="ring-1 ring-line" />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium text-fg">
            Display currency
          </span>
          <span className="block truncate text-[13px] text-fg-dim">
            Changes display only — your wallet settles in USDsui.
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <span className="text-[15px] font-medium text-fg">
            {active.symbol}
          </span>
          <span className="font-mono text-[12px] text-fg-muted">
            {active.code}
          </span>
          <HugeiconsIcon
            icon={UnfoldMoreIcon}
            size={16}
            className="text-fg-dim"
            strokeWidth={2}
          />
        </span>
      </button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Display currency"
        size="sm"
      >
        <div className="space-y-1">
          {currencies.map((c) => {
            const selected = c.code === currency;
            return (
              <button
                key={c.code}
                type="button"
                onClick={() => {
                  setCurrency(c.code);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left transition-colors ${
                  selected ? "bg-accent-soft" : "hover:bg-accent-soft"
                }`}
              >
                <Flag code={c.code} size={36} className="ring-1 ring-line" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium text-fg">
                    {c.label}
                  </span>
                  <span className="block font-mono text-[11px] uppercase tracking-wider text-fg-dim">
                    {c.symbol} · {c.code}
                  </span>
                </span>
                {selected && (
                  <HugeiconsIcon
                    icon={Tick02Icon}
                    size={18}
                    className="shrink-0 text-accent"
                    strokeWidth={2.2}
                  />
                )}
              </button>
            );
          })}
        </div>
      </Sheet>
    </>
  );
}
