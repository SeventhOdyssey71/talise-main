"use client";

/**
 * /app/ramps — Cash in & cash out.
 *
 * Cash-out (off-ramp) is the live, primary action: a full-width card that
 * opens <WithdrawToBankSheet>. NGN is live via Linq; KES/GHS are queued.
 *
 * Top-up (on-ramp) isn't wired yet (no card processor keys), so it's a slim
 * secondary strip — a "Notify me" waiting room — rather than a dead equal-size
 * card. When NEXT_PUBLIC_ONRAMP_ENABLED flips on it becomes a real
 * "Buy USDsui" action that opens <AddMoneyModal>.
 */

import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  BankIcon,
  CreditCardIcon,
  Tick02Icon,
  Notification01Icon,
} from "@hugeicons/core-free-icons";
import { Eyebrow, StatusPill, useToast } from "@/components/app";
import { Flag } from "@/components/app/ui/Flag";
import { WithdrawToBankSheet } from "@/components/app/ramps/WithdrawToBankSheet";
import { AddMoneyModal } from "@/components/app/AddMoneyModal";

const NOTIFY_KEY = "talise:ramp-notify:onramp";
const ONRAMP_ENABLED = process.env.NEXT_PUBLIC_ONRAMP_ENABLED === "true";

const OFFRAMP_CURRENCIES: { cc: string; country: string; code: string; live: boolean }[] = [
  { cc: "ng", country: "Nigeria", code: "NGN", live: true },
  { cc: "ke", country: "Kenya", code: "KES", live: false },
  { cc: "gh", country: "Ghana", code: "GHS", live: false },
];

const CARD_SHADOW =
  "shadow-[0_1px_2px_rgba(16,40,8,0.04),0_16px_40px_-20px_rgba(35,78,20,0.18)]";

export default function RampsPage() {
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-7 pb-10 pt-1">
      {/* Hero */}
      <header className="space-y-3">
        <Eyebrow>Cash out</Eyebrow>
        <h1 className="max-w-xl text-[26px] font-semibold leading-[1.15] tracking-[-0.03em] text-fg">
          Turn USDsui into cash, at the real rate.
        </h1>
        <p className="max-w-md text-[15px] leading-relaxed text-fg-muted">
          {/* Short on phones; the fuller line reads on wider screens. */}
          <span className="sm:hidden">Straight to your bank, settled in seconds.</span>
          <span className="hidden sm:inline">
            Paid straight to your bank via Linq — a live rate, one clear fee,
            settled in seconds.
          </span>
        </p>
      </header>

      {/* PRIMARY — cash out (live) */}
      <div
        className={`relative flex flex-col overflow-hidden rounded-3xl bg-surface p-7 ring-1 ring-black/[0.04] sm:p-9 ${CARD_SHADOW}`}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-accent-soft/35 to-transparent"
        />
        <div className="relative flex items-start justify-between gap-3">
          <div className="flex items-center gap-3.5">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent">
              <HugeiconsIcon icon={BankIcon} size={20} strokeWidth={1.8} />
            </span>
            <div className="space-y-1">
              <span className="block text-[11px] font-medium uppercase tracking-[0.18em] text-fg-dim">
                Off-ramp
              </span>
              <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-fg">
                Cash out to your bank
              </h2>
            </div>
          </div>
        </div>

        <ul className="relative mt-6 divide-y divide-black/[0.05]">
          {OFFRAMP_CURRENCIES.map((c) => (
            <li
              key={c.cc}
              className="flex items-center justify-between gap-3 py-3.5 first:pt-0"
            >
              <span className="flex items-center gap-3">
                <span className="flex size-7 items-center justify-center overflow-hidden rounded-full ring-1 ring-black/[0.06]">
                  <Flag code={c.cc} size={28} />
                </span>
                <span className="flex items-baseline gap-1.5">
                  <span className="text-[14px] font-medium text-fg">{c.country}</span>
                  <span className="text-[13px] text-fg-dim">{c.code}</span>
                </span>
              </span>
              <StatusPill
                label={c.live ? "Live" : "Soon"}
                tone={c.live ? "success" : "neutral"}
              />
            </li>
          ))}
        </ul>

        <div className="relative mt-8">
          <button
            type="button"
            onClick={() => setWithdrawOpen(true)}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-accent-deep px-6 text-[15px] font-semibold text-white shadow-[0_8px_22px_-8px_rgba(35,78,20,0.5)] transition-[transform,background,box-shadow] duration-150 hover:bg-[color-mix(in_srgb,var(--color-accent-deep)_90%,white)] hover:shadow-[0_10px_26px_-8px_rgba(35,78,20,0.55)] active:scale-[0.985]"
          >
            Cash out to your bank
          </button>
        </div>
      </div>

      {/* SECONDARY — top up (slim strip; live action only when enabled) */}
      <OnRampStrip onBuy={() => setAddOpen(true)} />

      <p className="text-center text-[12px] leading-relaxed text-fg-dim">
        Balances are always 1:1 with the US dollar — send and receive anytime.
      </p>

      <WithdrawToBankSheet open={withdrawOpen} onClose={() => setWithdrawOpen(false)} />
      <AddMoneyModal open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}

/** Compact top-up row. A real "Buy USDsui" action when enabled, else a quiet
 *  "coming soon" strip with a one-tap Notify-me. */
function OnRampStrip({ onBuy }: { onBuy: () => void }) {
  const { toast } = useToast();
  const [notified, setNotified] = useState(false);

  useEffect(() => {
    try {
      setNotified(localStorage.getItem(NOTIFY_KEY) === "1");
    } catch {
      /* storage blocked */
    }
  }, []);

  function notifyMe() {
    if (notified) return;
    setNotified(true);
    try {
      localStorage.setItem(NOTIFY_KEY, "1");
    } catch {
      /* ignore */
    }
    toast("You're on the list — we'll let you know the moment it's live.", "success");
  }

  // When enabled, a real prominent action card. When not, a deliberately quiet
  // row (no border, muted, transparent) so "coming soon" recedes into the page.
  return (
    <div
      className={`flex items-center gap-3.5 rounded-2xl px-5 py-3.5 ${
        ONRAMP_ENABLED
          ? `bg-surface ring-1 ring-black/[0.04] ${CARD_SHADOW}`
          : "bg-transparent"
      }`}
    >
      <span
        className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${
          ONRAMP_ENABLED ? "bg-accent-soft text-accent" : "bg-black/[0.03] text-fg-dim"
        }`}
      >
        <HugeiconsIcon icon={CreditCardIcon} size={17} strokeWidth={1.8} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={`text-[14px] font-medium ${ONRAMP_ENABLED ? "text-fg" : "text-fg-muted"}`}
          >
            Add money with a card
          </span>
          {!ONRAMP_ENABLED && (
            <span className="rounded-full bg-black/[0.04] px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-fg-dim">
              Soon
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-[12.5px] text-fg-dim">
          Top up your balance — card &amp; bank.
        </p>
      </div>
      {ONRAMP_ENABLED ? (
        <button
          type="button"
          onClick={onBuy}
          className="inline-flex h-9 shrink-0 items-center justify-center rounded-full bg-accent-deep px-4 text-[13px] font-semibold text-white transition-transform duration-150 active:scale-[0.97]"
        >
          Buy USDsui
        </button>
      ) : (
        <button
          type="button"
          onClick={notifyMe}
          disabled={notified}
          className="inline-flex shrink-0 items-center gap-1.5 text-[13px] font-medium text-fg-muted transition-colors duration-150 hover:text-fg disabled:text-fg-dim"
        >
          <HugeiconsIcon
            icon={notified ? Tick02Icon : Notification01Icon}
            size={14}
            strokeWidth={2}
          />
          {notified ? "On the list" : "Notify me"}
        </button>
      )}
    </div>
  );
}
