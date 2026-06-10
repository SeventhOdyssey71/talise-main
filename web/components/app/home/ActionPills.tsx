"use client";

/**
 * Primary money actions, Wise-style: a single row of soft rounded pills directly
 * under the balance. Send is the forest-filled primary; Receive / Add money /
 * Request are soft-mint secondaries. Receive opens the QR/handle sheet inline;
 * the rest are links. This is the ONE action row on Home — no redundant tiles.
 */

import { useState } from "react";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import {
  SentIcon,
  QrCode01Icon,
  CreditCardIcon,
  MoneyReceive02Icon,
} from "@hugeicons/core-free-icons";
import { type Me } from "@/components/app";
import { ReceiveSheet } from "./ReceiveSheet";

const SECONDARY =
  "bg-accent-soft text-accent hover:bg-[color-mix(in_srgb,var(--color-accent-deep)_14%,#ffffff)]";
const PRIMARY =
  "bg-accent-deep text-white shadow-[0_6px_18px_-8px_rgba(35,78,20,0.45)] hover:bg-[color-mix(in_srgb,var(--color-accent-deep)_88%,white)]";
const BASE =
  "inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[14px] font-medium transition-colors active:scale-[0.98]";

export function ActionPills({ me }: { me: Me | null }) {
  const [receiveOpen, setReceiveOpen] = useState(false);

  const actions: {
    label: string;
    icon: IconSvgElement;
    primary?: boolean;
    href?: string;
    onClick?: () => void;
  }[] = [
    { label: "Send", icon: SentIcon as IconSvgElement, primary: true, href: "/app/pay" },
    { label: "Receive", icon: QrCode01Icon as IconSvgElement, onClick: () => setReceiveOpen(true) },
    { label: "Add money", icon: CreditCardIcon as IconSvgElement, href: "/app/ramps" },
    { label: "Request", icon: MoneyReceive02Icon as IconSvgElement, href: "/app/pay/request" },
  ];

  return (
    <>
      {/* MOBILE — app-style 4-up icon tiles (icon disc + small label). The
          wrapping pill row read as 3 + 1 orphan on narrow screens. */}
      <div className="grid grid-cols-4 gap-2 sm:hidden">
        {actions.map((a) => {
          const inner = (
            <>
              <span
                className={`flex size-12 items-center justify-center rounded-full transition-transform active:scale-95 ${
                  a.primary
                    ? "bg-accent-deep text-white shadow-[0_6px_18px_-8px_rgba(35,78,20,0.45)]"
                    : "bg-accent-soft text-accent"
                }`}
              >
                <HugeiconsIcon icon={a.icon} size={19} strokeWidth={2} color="currentColor" />
              </span>
              <span className="text-[12px] font-medium text-fg">{a.label}</span>
            </>
          );
          const cls = "flex flex-col items-center gap-1.5";
          return a.href ? (
            <Link key={a.label} href={a.href} className={cls}>
              {inner}
            </Link>
          ) : (
            <button key={a.label} type="button" onClick={a.onClick} className={cls}>
              {inner}
            </button>
          );
        })}
      </div>

      {/* DESKTOP/TABLET — the Wise-style pill row. */}
      <div className="hidden flex-wrap items-center gap-2.5 sm:flex">
        {actions.map((a) => {
          const cls = `${BASE} ${a.primary ? PRIMARY : SECONDARY}`;
          const inner = (
            <>
              <HugeiconsIcon icon={a.icon} size={17} strokeWidth={2} color="currentColor" />
              {a.label}
            </>
          );
          return a.href ? (
            <Link key={a.label} href={a.href} className={cls}>
              {inner}
            </Link>
          ) : (
            <button key={a.label} type="button" onClick={a.onClick} className={cls}>
              {inner}
            </button>
          );
        })}
      </div>
      <ReceiveSheet open={receiveOpen} onClose={() => setReceiveOpen(false)} me={me} />
    </>
  );
}
