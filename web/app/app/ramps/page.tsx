"use client";

/**
 * /app/ramps — money in & money out.
 *
 * Order is top-up FIRST, cash-out SECOND (the funnel reads in → out). Top-up
 * isn't wired yet (no card processor keys), so it renders as a clearly
 * unavailable GREY-FRAMED card with a one-tap Notify-me; when
 * NEXT_PUBLIC_ONRAMP_ENABLED flips on it becomes a real "Buy USDsui" card
 * that opens <AddMoneyModal>.
 *
 * Cash-out (off-ramp) is the live action: NGN via Linq. Queued corridors
 * (KES/GHS) collapse into a single overlapped-flag stack row — greyscaled
 * circles + one "Coming soon" pill — instead of a dead full row each.
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

/** Queued off-ramp corridors — rendered as one overlapped grey flag stack. */
const COMING_SOON_CORRIDORS: { cc: string; country: string }[] = [
  { cc: "ke", country: "Kenya" },
  { cc: "gh", country: "Ghana" },
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
        <Eyebrow>Ramps</Eyebrow>
        <h1 className="max-w-xl font-display text-[26px] font-medium leading-[1.15] tracking-[-0.03em] text-fg">
          Money in, money out — at the real rate.
        </h1>
        <p className="max-w-md text-[15px] leading-relaxed text-fg-muted">
          {/* Short on phones; the fuller line reads on wider screens. */}
          <span className="sm:hidden">Cash out to your bank, settled in seconds.</span>
          <span className="hidden sm:inline">
            Cash out straight to your bank via Linq — a live rate, one clear
            fee, settled in seconds.
          </span>
        </p>
      </header>

      {/* TOP-UP (on-ramp) — first in the funnel. Grey-framed while unavailable;
          a real action card the moment the processor keys land. */}
      <AddMoneyCard onBuy={() => setAddOpen(true)} />

      {/* CASH-OUT (off-ramp) — the live action. */}
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
          {/* The one live corridor gets a full row. */}
          <li className="flex items-center justify-between gap-3 py-3.5 first:pt-0">
            <span className="flex items-center gap-3">
              <span className="flex size-7 items-center justify-center overflow-hidden rounded-full ring-1 ring-black/[0.06]">
                <Flag code="ng" size={28} />
              </span>
              <span className="flex items-baseline gap-1.5">
                <span className="text-[14px] font-medium text-fg">Nigeria</span>
                <span className="text-[13px] text-fg-dim">NGN</span>
              </span>
            </span>
            <StatusPill label="Live" tone="success" />
          </li>
          {/* Queued corridors: one overlapped, greyscaled flag stack — not a
              dead full row per country. */}
          <li className="flex items-center justify-between gap-3 py-3.5">
            <span className="flex items-center gap-3">
              <span className="flex shrink-0 -space-x-2.5">
                {COMING_SOON_CORRIDORS.map((c) => (
                  <span
                    key={c.cc}
                    className="flex size-7 items-center justify-center overflow-hidden rounded-full opacity-60 ring-2 ring-surface grayscale"
                  >
                    <Flag code={c.cc} size={28} />
                  </span>
                ))}
              </span>
              <span className="text-[13px] text-fg-dim">
                {COMING_SOON_CORRIDORS.map((c) => c.country).join(", ")} &amp; more
              </span>
            </span>
            <StatusPill label="Coming soon" tone="neutral" />
          </li>
        </ul>

        <div className="relative mt-8">
          <button
            type="button"
            onClick={() => setWithdrawOpen(true)}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-accent-deep px-6 text-[15px] font-semibold text-white shadow-[0_8px_22px_-8px_rgba(35,78,20,0.5)] transition-[transform,background,box-shadow] duration-150 hover:bg-[color-mix(in_srgb,var(--color-accent-deep)_90%,white)] hover:shadow-[0_10px_26px_-8px_rgba(35,78,20,0.55)] active:scale-[0.985] outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--color-accent-deep)_55%,transparent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]"
          >
            Cash out to your bank
          </button>
        </div>
      </div>

      <p className="text-center text-[12px] leading-relaxed text-fg-dim">
        Balances are always 1:1 with the US dollar — send and receive anytime.
      </p>

      <WithdrawToBankSheet open={withdrawOpen} onClose={() => setWithdrawOpen(false)} />
      <AddMoneyModal open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}

/**
 * Top-up card. While the processor isn't wired it's a GREY-FRAMED,
 * deliberately muted card (grey ring, grey icon wash, Soon pill) with a
 * one-tap Notify-me — unmistakably "not yet", but holding the top slot it
 * will own once live. With ONRAMP_ENABLED it's a real action card.
 */
function AddMoneyCard({ onBuy }: { onBuy: () => void }) {
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

  if (ONRAMP_ENABLED) {
    return (
      <div
        className={`relative flex items-center gap-3.5 overflow-hidden rounded-3xl bg-surface px-7 py-5 ring-1 ring-black/[0.04] ${CARD_SHADOW}`}
      >
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent">
          <HugeiconsIcon icon={CreditCardIcon} size={20} strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1 space-y-0.5">
          <span className="block text-[11px] font-medium uppercase tracking-[0.18em] text-fg-dim">
            On-ramp
          </span>
          <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-fg">
            Add money with a card
          </h2>
        </div>
        <button
          type="button"
          onClick={onBuy}
          className="inline-flex h-10 shrink-0 items-center justify-center rounded-full bg-accent-deep px-5 text-[14px] font-semibold text-white transition-transform duration-150 active:scale-[0.97]"
        >
          Buy USDsui
        </button>
      </div>
    );
  }

  // Unavailable: grey frame, grey washes, no green anywhere.
  return (
    <div className="relative flex flex-col overflow-hidden rounded-3xl bg-black/[0.015] p-7 ring-1 ring-black/[0.08] sm:p-9">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3.5">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-black/[0.04] text-fg-dim">
            <HugeiconsIcon icon={CreditCardIcon} size={20} strokeWidth={1.8} />
          </span>
          <div className="space-y-1">
            <span className="block text-[11px] font-medium uppercase tracking-[0.18em] text-fg-dim">
              On-ramp
            </span>
            <h2 className="flex items-center gap-2 text-[17px] font-semibold tracking-[-0.01em] text-fg-muted">
              Add money with a card
              <StatusPill label="Soon" tone="neutral" />
            </h2>
          </div>
        </div>
      </div>
      <p className="mt-3 max-w-md text-[13.5px] leading-relaxed text-fg-dim">
        Top up your balance with a card or bank transfer.
      </p>
      <div className="mt-6">
        <button
          type="button"
          onClick={notifyMe}
          disabled={notified}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-transparent px-6 text-[14px] font-semibold text-fg-muted ring-1 ring-black/[0.1] transition-colors duration-150 hover:bg-black/[0.03] hover:text-fg disabled:text-fg-dim disabled:ring-black/[0.06] disabled:hover:bg-transparent"
        >
          <HugeiconsIcon
            icon={notified ? Tick02Icon : Notification01Icon}
            size={15}
            strokeWidth={2}
          />
          {notified ? "On the list — we'll let you know" : "Notify me when it's live"}
        </button>
      </div>
    </div>
  );
}
