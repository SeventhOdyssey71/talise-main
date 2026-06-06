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
  return (
    <>
      <div className="flex flex-wrap items-center gap-2.5">
        <Link href="/app/pay" className={`${BASE} ${PRIMARY}`}>
          <HugeiconsIcon icon={SentIcon as IconSvgElement} size={17} strokeWidth={2} color="currentColor" />
          Send
        </Link>
        <button type="button" onClick={() => setReceiveOpen(true)} className={`${BASE} ${SECONDARY}`}>
          <HugeiconsIcon icon={QrCode01Icon as IconSvgElement} size={17} strokeWidth={2} color="currentColor" />
          Receive
        </button>
        <Link href="/app/ramps" className={`${BASE} ${SECONDARY}`}>
          <HugeiconsIcon icon={CreditCardIcon as IconSvgElement} size={17} strokeWidth={2} color="currentColor" />
          Add money
        </Link>
        <Link href="/app/pay/request" className={`${BASE} ${SECONDARY}`}>
          <HugeiconsIcon icon={MoneyReceive02Icon as IconSvgElement} size={17} strokeWidth={2} color="currentColor" />
          Request
        </Link>
      </div>
      <ReceiveSheet open={receiveOpen} onClose={() => setReceiveOpen(false)} me={me} />
    </>
  );
}
