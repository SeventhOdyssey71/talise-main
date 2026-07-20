"use client";

/**
 * /app/ramps, money in & money out.
 *
 * Order is top-up FIRST, cash-out SECOND (the funnel reads in → out). Top-up
 * isn't wired yet (no card processor keys), so it renders as a clearly
 * unavailable GREY-FRAMED card with a one-tap Notify-me; when
 * NEXT_PUBLIC_ONRAMP_ENABLED flips on it becomes a real "Buy USDsui" card
 * that opens <AddMoneyModal>.
 *
 * Cash-out (off-ramp) is the live action: NGN bank payout, capped server-side
 * ($200/account/day). Queued corridors (KES/GHS) collapse into a single
 * overlapped-flag stack row, greyscaled circles + one "Coming soon" pill.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  BankIcon,
  CreditCardIcon,
  Tick02Icon,
  Notification01Icon,
  ArrowRight01Icon,
} from "@hugeicons/core-free-icons";
import { StatusPill, useToast, useMe } from "@/components/app";
import { Flag } from "@/components/app/ui/Flag";
import { AddMoneyModal } from "@/components/app/AddMoneyModal";

const NOTIFY_KEY = "talise:ramp-notify:onramp";
// Off-ramp (cash-out) is OPEN in the web app. Exposure is bounded by the
// server-side daily cap (OFFRAMP_MAX_USD = $200/account/day, enforced on every
// order in lib/linq.ts). Set true to re-lock the cash-out card.
const OFFRAMP_LOCKED = false;
// Per-day cash-out cap, mirrored for a subtle UI note (keep in sync with
// OFFRAMP_MAX_USD in lib/linq.ts, that server value is the real enforcement).
const OFFRAMP_CAP_USD = 200;
// On-ramp (card top-up via Transak) is NOT live yet, keep it hard OFF so the
// top-up card stays the grey "notify me" state and never opens a checkout that
// can't complete. Restore the env check once the processor actually works:
//   const ONRAMP_ENABLED = process.env.NEXT_PUBLIC_ONRAMP_ENABLED === "true";
const ONRAMP_ENABLED = false;

/** Queued off-ramp corridors, rendered as one overlapped grey flag stack. */
const COMING_SOON_CORRIDORS: { cc: string; country: string }[] = [
  { cc: "ke", country: "Kenya" },
  { cc: "gh", country: "Ghana" },
  { cc: "id", country: "Indonesia" },
  { cc: "ph", country: "Philippines" },
];

export default function RampsPage() {
  const { me } = useMe();
  // Show the US corridor when the per-user flag is on. In local dev we always
  // surface it so the flow is testable without waiting on the env flag; every
  // US cash-out call is still server-gated (allowlist + KYC), so this only
  // controls whether the row/chooser is visible, never actual access.
  const usdEnabled =
    !!me?.features?.usdWithdrawal || process.env.NODE_ENV === "development";
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-7 pb-10 pt-1">
      {/* Hero */}
      <header className="space-y-3">
        <div className="font-mono text-[11px] uppercase tracking-[0.28em] text-[#3d7a29]">
          Ramps
        </div>
        <h1
          className="max-w-xl text-[clamp(26px,5vw,40px)] font-[500] leading-[1.02] tracking-[-0.05em] text-[#15300c]"
          style={{ fontFamily: '"TWK Everett", var(--font-display-v2), system-ui, sans-serif' }}
        >
          Money in, money out, at the real rate.
        </h1>
        <p className="max-w-md text-[15px] leading-relaxed text-[#3a5230]">
          {/* Short on phones; the fuller line reads on wider screens. */}
          <span className="sm:hidden">Cash out to your bank, settled in under a second.</span>
          <span className="hidden sm:inline">
            Cash out straight to your bank, a live rate, one clear fee,
            settled in under a second.
          </span>
        </p>
      </header>

      {/* TOP-UP (on-ramp), first in the funnel. Grey-framed while unavailable;
          a real action card the moment the processor keys land. */}
      <AddMoneyCard onBuy={() => setAddOpen(true)} />

      {/* CASH-OUT (off-ramp), the live action. */}
      <div
        className="relative flex flex-col overflow-hidden rounded-[28px] bg-[#f7fcf2] p-7 sm:p-9"
        style={{ boxShadow: "0 1px 2px rgba(18,26,15,0.04), 0 14px 34px -22px rgba(18,26,15,0.22)" }}
      >
        <div className="relative flex items-start justify-between gap-3">
          <div className="flex items-center gap-3.5">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#CAFFB8] text-[#15300c]">
              <HugeiconsIcon icon={BankIcon} size={20} strokeWidth={1.8} />
            </span>
            <div className="space-y-1">
              <span className="block font-mono text-[11px] uppercase tracking-[0.28em] text-[#3d7a29]">
                Off-ramp
              </span>
              <h2
                className="text-[20px] font-[500] tracking-[-0.05em] text-[#15300c]"
                style={{ fontFamily: '"TWK Everett", var(--font-display-v2), system-ui, sans-serif' }}
              >
                Cash out to your bank
              </h2>
            </div>
          </div>
        </div>

        <ul className="relative mt-6 divide-y divide-[#15300c]/10">
          {/* US corridor (Bridge), shown only when the per-user flag is on. */}
          {usdEnabled && (
            <CorridorRow href="/app/ramps/cashout/us" cc="us" country="United States" cur="USD" />
          )}
          {/* Nigeria, the original live corridor. */}
          {OFFRAMP_LOCKED ? (
            <li className="flex items-center justify-between gap-3 py-3.5 first:pt-0">
              <CorridorLabel cc="ng" country="Nigeria" cur="NGN" />
              <StatusPill label="Coming soon" tone="neutral" />
            </li>
          ) : (
            <CorridorRow href="/app/ramps/cashout/ng" cc="ng" country="Nigeria" cur="NGN" />
          )}
          {/* Queued corridors: one overlapped, greyscaled flag stack. */}
          <li className="flex items-center justify-between gap-3 py-3.5">
            <span className="flex items-center gap-3">
              <span className="flex shrink-0 -space-x-2.5">
                {COMING_SOON_CORRIDORS.map((c) => (
                  <span
                    key={c.cc}
                    className="flex size-7 items-center justify-center overflow-hidden rounded-full opacity-60 ring-2 ring-[#f7fcf2] grayscale"
                  >
                    <Flag code={c.cc} size={28} />
                  </span>
                ))}
              </span>
              <span className="text-[13px] text-[#3d7a29]">
                {COMING_SOON_CORRIDORS.map((c) => c.country).join(", ")} &amp; more
              </span>
            </span>
            <StatusPill label="Coming soon" tone="neutral" />
          </li>
        </ul>

        {!OFFRAMP_LOCKED && (
          <p className="relative mt-6 text-center font-mono text-[11px] text-[#3d7a29]">
            Pick a country to cash out · NGN capped at ${OFFRAMP_CAP_USD}/day while we scale.
          </p>
        )}
      </div>

      <p className="text-center text-[12px] leading-relaxed text-[#3d7a29]">
        Balances are always 1:1 with the US dollar, send and receive anytime.
      </p>

      <AddMoneyModal open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}

/** The flag + country + currency label used inside a corridor row. */
function CorridorLabel({ cc, country, cur }: { cc: string; country: string; cur: string }) {
  return (
    <span className="flex items-center gap-3">
      <span className="flex size-7 items-center justify-center overflow-hidden rounded-full ring-1 ring-[#15300c]/10">
        <Flag code={cc} size={28} />
      </span>
      <span className="flex items-baseline gap-1.5">
        <span className="text-[14px] font-medium text-[#15300c]">{country}</span>
        <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-[#3d7a29]">{cur}</span>
      </span>
    </span>
  );
}

/** A live, clickable corridor row that navigates to its full cash-out page. */
function CorridorRow({ href, cc, country, cur }: { href: string; cc: string; country: string; cur: string }) {
  return (
    <li>
      <Link
        href={href}
        className="group -mx-2 flex items-center justify-between gap-3 rounded-2xl px-2 py-3.5 transition-colors hover:bg-[#CAFFB8]/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3d7a29]/40"
      >
        <CorridorLabel cc={cc} country={country} cur={cur} />
        <span className="flex items-center gap-2">
          <StatusPill label="Live" tone="success" />
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            size={16}
            strokeWidth={2}
            className="text-[#3d7a29] transition-transform group-hover:translate-x-0.5"
          />
        </span>
      </Link>
    </li>
  );
}

/**
 * Top-up card. While the processor isn't wired it's a GREY-FRAMED,
 * deliberately muted card (grey ring, grey icon wash, Soon pill) with a
 * one-tap Notify-me, unmistakably "not yet", but holding the top slot it
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
    toast("You're on the list, we'll let you know the moment it's live.", "success");
  }

  if (ONRAMP_ENABLED) {
    return (
      <div
        className="relative flex items-center gap-3.5 overflow-hidden rounded-[28px] bg-[#f7fcf2] px-7 py-5"
        style={{ boxShadow: "0 1px 2px rgba(18,26,15,0.04), 0 14px 34px -22px rgba(18,26,15,0.22)" }}
      >
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#CAFFB8] text-[#15300c]">
          <HugeiconsIcon icon={CreditCardIcon} size={20} strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1 space-y-0.5">
          <span className="block font-mono text-[11px] uppercase tracking-[0.28em] text-[#3d7a29]">
            On-ramp
          </span>
          <h2
            className="text-[18px] font-[500] tracking-[-0.05em] text-[#15300c]"
            style={{ fontFamily: '"TWK Everett", var(--font-display-v2), system-ui, sans-serif' }}
          >
            Add money with a card
          </h2>
        </div>
        <button
          type="button"
          onClick={onBuy}
          className="inline-flex h-10 shrink-0 items-center justify-center rounded-full bg-[#15300c] px-5 text-[14px] font-semibold text-[#f7fcf2] transition-transform duration-150 hover:-translate-y-0.5 active:scale-[0.98]"
        >
          Buy USDsui
        </button>
      </div>
    );
  }

  // Unavailable: muted frame, no brand fill, clearly "not yet".
  return (
    <div className="relative flex flex-col overflow-hidden rounded-[28px] border border-dashed border-[#15300c]/20 bg-[#f7fcf2]/60 p-7 sm:p-9">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3.5">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#15300c]/[0.06] text-[#3d7a29]">
            <HugeiconsIcon icon={CreditCardIcon} size={20} strokeWidth={1.8} />
          </span>
          <div className="space-y-1">
            <span className="block font-mono text-[11px] uppercase tracking-[0.28em] text-[#3d7a29]">
              On-ramp
            </span>
            <h2
              className="flex items-center gap-2 text-[20px] font-[500] tracking-[-0.05em] text-[#3a5230]"
              style={{ fontFamily: '"TWK Everett", var(--font-display-v2), system-ui, sans-serif' }}
            >
              Add money with a card
              <StatusPill label="Soon" tone="neutral" />
            </h2>
          </div>
        </div>
      </div>
      <p className="mt-3 max-w-md text-[13.5px] leading-relaxed text-[#3d7a29]">
        Top up your balance with a card or bank transfer.
      </p>
      <div className="mt-6">
        <button
          type="button"
          onClick={notifyMe}
          disabled={notified}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full border-2 border-[#15300c] bg-transparent px-6 text-[14px] font-semibold text-[#15300c] transition-colors duration-150 hover:bg-[#15300c] hover:text-[#f7fcf2] disabled:border-[#15300c]/20 disabled:text-[#3d7a29] disabled:hover:bg-transparent disabled:hover:text-[#3d7a29]"
        >
          <HugeiconsIcon
            icon={notified ? Tick02Icon : Notification01Icon}
            size={15}
            strokeWidth={2}
          />
          {notified ? "On the list, we'll let you know" : "Notify me when it's live"}
        </button>
      </div>
    </div>
  );
}
