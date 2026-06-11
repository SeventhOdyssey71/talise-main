"use client";

/**
 * SecondaryActions — the compact row under the Home balance card. The two
 * primary actions (Send / Request) live inline inside the BalanceCard; this row
 * keeps the remaining quick actions (Add money, Receive) reachable without
 * adding weight to the card. Receive opens the QR/handle sheet inline; Add money
 * links to the on/off ramps. Soft-mint quiet buttons.
 */

import { useState } from "react";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { CreditCardIcon, QrCode01Icon } from "@hugeicons/core-free-icons";
import { type Me } from "@/components/app";
import { ReceiveSheet } from "./ReceiveSheet";

const BTN =
  "inline-flex items-center justify-center gap-2 rounded-full border border-line bg-surface px-5 py-2.5 text-[13px] font-medium text-fg-muted transition-colors hover:border-[color-mix(in_srgb,var(--color-accent-deep)_35%,var(--color-line))] hover:text-fg active:scale-[0.98] outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--color-accent-deep)_45%,transparent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]";

export function SecondaryActions({ me }: { me: Me | null }) {
  const [receiveOpen, setReceiveOpen] = useState(false);

  return (
    <>
      <div className="grid grid-cols-2 gap-2.5 sm:flex sm:flex-wrap">
        <Link href="/app/ramps" className={BTN}>
          <HugeiconsIcon icon={CreditCardIcon} size={16} strokeWidth={2} color="currentColor" />
          Add money
        </Link>
        <button type="button" onClick={() => setReceiveOpen(true)} className={BTN}>
          <HugeiconsIcon icon={QrCode01Icon} size={16} strokeWidth={2} color="currentColor" />
          Receive
        </button>
      </div>
      <ReceiveSheet open={receiveOpen} onClose={() => setReceiveOpen(false)} me={me} />
    </>
  );
}
