"use client";

/**
 * /app/ramps — Cash in & cash out (coming soon).
 *
 * Two intentional sections, each a glass card that sells the value rather
 * than dead-ending:
 *   • On-ramp  — buy USDsui with a card or bank, powered by Stripe.
 *   • Off-ramp — cash out to your bank, NGN via Paga first.
 *
 * Both backends exist (see /api/onramp/* and /api/offramp/paga/*); this page
 * is the waiting-room UI until they're switched on for beta. The "Notify me"
 * CTA records intent locally and confirms with a toast — no spammy email
 * gate, and the choice persists per device.
 */

import { useEffect, useState, type ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CreditCardIcon,
  BankIcon,
  MoneyReceive02Icon,
  Tick02Icon,
  Notification01Icon,
  FlashIcon,
  Exchange01Icon,
  Shield01Icon,
} from "@hugeicons/core-free-icons";
import { GlassCard, Eyebrow, StatusPill, useToast } from "@/components/app";

const NOTIFY_PREFIX = "talise:ramp-notify:";

export default function RampsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-7 pb-8">
      {/* Hero */}
      <header className="space-y-2.5 pt-1">
        <Eyebrow>Cash in &amp; cash out</Eyebrow>
        <h1 className="text-[26px] font-medium leading-tight tracking-[-0.03em] text-fg">
          Move between cash and USDsui — at the real rate.
        </h1>
        <p className="max-w-xl text-[15px] leading-relaxed text-fg-muted">
          Top up from your card or bank, and cash out straight to your bank
          account. No hidden spreads buried in the price — you see the live
          mid-market rate and a single, upfront fee.
        </p>
      </header>

      {/* On-ramp */}
      <RampCard
        eyebrow="On-ramp"
        icon={<HugeiconsIcon icon={CreditCardIcon} size={22} strokeWidth={1.8} />}
        title="Buy USDsui with a card or bank"
        blurb="Instant top-ups powered by Stripe. Funds land as USDsui in your wallet — ready to send, save, or earn the moment they arrive."
        notifyKey="onramp"
        features={[
          {
            icon: <HugeiconsIcon icon={FlashIcon} size={16} strokeWidth={1.8} />,
            text: "Card payments clear in seconds",
          },
          {
            icon: <HugeiconsIcon icon={Exchange01Icon} size={16} strokeWidth={1.8} />,
            text: "Live mid-market FX, no padded spread",
          },
          {
            icon: <HugeiconsIcon icon={Shield01Icon} size={16} strokeWidth={1.8} />,
            text: "PCI-compliant checkout, you stay in control",
          },
        ]}
      />

      {/* Off-ramp */}
      <RampCard
        eyebrow="Off-ramp"
        icon={<HugeiconsIcon icon={BankIcon} size={22} strokeWidth={1.8} />}
        title="Cash out to your bank"
        blurb="Withdraw USDsui to your local bank account — NGN via Paga at launch, with more currencies and rails rolling out right after."
        notifyKey="offramp"
        features={[
          {
            icon: (
              <HugeiconsIcon icon={MoneyReceive02Icon} size={16} strokeWidth={1.8} />
            ),
            text: "Direct deposit to your bank account",
          },
          {
            icon: <HugeiconsIcon icon={Exchange01Icon} size={16} strokeWidth={1.8} />,
            text: "Quote the rate before you confirm — no surprises",
          },
          {
            icon: <HugeiconsIcon icon={BankIcon} size={16} strokeWidth={1.8} />,
            text: "NGN via Paga now · GHS, KES & more next",
          },
        ]}
      />

      {/* Footnote */}
      <p className="text-center text-[12px] leading-relaxed text-fg-dim">
        Until ramps go live, you can already receive USDsui from anyone with a
        Talise handle, and send anywhere in seconds. Balances are always 1:1
        with the US dollar.
      </p>
    </div>
  );
}

type Feature = { icon: ReactNode; text: string };

function RampCard({
  eyebrow,
  icon,
  title,
  blurb,
  notifyKey,
  features,
}: {
  eyebrow: string;
  icon: ReactNode;
  title: string;
  blurb: string;
  notifyKey: string;
  features: Feature[];
}) {
  const { toast } = useToast();
  const [notified, setNotified] = useState(false);

  useEffect(() => {
    try {
      setNotified(localStorage.getItem(NOTIFY_PREFIX + notifyKey) === "1");
    } catch {
      /* storage blocked — default off */
    }
  }, [notifyKey]);

  function notifyMe() {
    if (notified) return;
    setNotified(true);
    try {
      localStorage.setItem(NOTIFY_PREFIX + notifyKey, "1");
    } catch {
      /* ignore */
    }
    toast("You're on the list — we'll let you know the moment it's live.", "success");
  }

  return (
    <GlassCard className="space-y-5 p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className="flex size-12 shrink-0 items-center justify-center rounded-2xl text-accent"
            style={{
              background:
                "color-mix(in srgb, var(--color-accent) 12%, transparent)",
            }}
          >
            {icon}
          </span>
          <div>
            <Eyebrow>{eyebrow}</Eyebrow>
            <h2 className="mt-1 text-[18px] font-medium tracking-[-0.02em] text-fg">
              {title}
            </h2>
          </div>
        </div>
        <StatusPill label="Soon" tone="pending" />
      </div>

      <p className="text-[14px] leading-relaxed text-fg-muted">{blurb}</p>

      <ul className="space-y-2.5">
        {features.map((f, i) => (
          <li key={i} className="flex items-center gap-3">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white/[0.05] text-accent">
              {f.icon}
            </span>
            <span className="text-[14px] text-fg">{f.text}</span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={notifyMe}
        disabled={notified}
        className={`inline-flex w-full items-center justify-center gap-2 rounded-full px-6 py-3 text-[15px] font-semibold transition-[transform,background,opacity] active:scale-[0.98] sm:w-auto ${
          notified
            ? "talise-glass cursor-default text-fg-muted"
            : "bg-accent-deep text-white shadow-[0_10px_30px_-12px_rgba(75,138,55,0.7)] hover:brightness-110"
        }`}
      >
        <HugeiconsIcon
          icon={notified ? Tick02Icon : Notification01Icon}
          size={17}
          strokeWidth={2}
        />
        {notified ? "We'll notify you" : "Notify me when it's live"}
      </button>
    </GlassCard>
  );
}
