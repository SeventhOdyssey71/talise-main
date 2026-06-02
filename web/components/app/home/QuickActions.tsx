"use client";

/**
 * Quick-actions row: Send, Receive, Scan, Add money. Each is a glass tile with
 * a mint-tinted icon disc. Send → the Pay flow. Receive & Scan both open the
 * Receive sheet (QR of the user's address). Add money → Ramps (coming soon).
 *
 * Desktop: a 4-up grid of tiles. Mobile: a 4-up grid that stays tidy on
 * narrow widths (icon over a short label).
 */

import { useState } from "react";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import {
  SentIcon,
  QrCode01Icon,
  ScanIcon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";
import { type Me } from "@/components/app";
import { ReceiveSheet } from "./ReceiveSheet";

type TileProps = {
  icon: IconSvgElement;
  label: string;
  sublabel: string;
  href?: string;
  onClick?: () => void;
  badge?: string;
};

function ActionTile({ icon, label, sublabel, href, onClick, badge }: TileProps) {
  const inner = (
    <>
      <span
        className="flex size-11 items-center justify-center rounded-2xl text-accent"
        style={{ background: "var(--color-accent-soft)" }}
      >
        <HugeiconsIcon icon={icon} size={21} strokeWidth={1.9} color="var(--color-accent)" />
      </span>
      <span className="mt-2.5 flex flex-col">
        <span className="text-[14px] font-semibold leading-tight text-fg">{label}</span>
        <span className="mt-0.5 text-[11px] leading-tight text-fg-dim">{sublabel}</span>
      </span>
      {badge && (
        <span className="absolute right-3 top-3 rounded-full border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-dim">
          {badge}
        </span>
      )}
    </>
  );

  const cls =
    "talise-glass relative flex flex-col items-start rounded-3xl px-3.5 py-4 text-left transition-[transform,border-color] duration-150 hover:-translate-y-0.5 hover:border-[color-mix(in_srgb,var(--color-accent-deep)_40%,var(--color-line))] active:translate-y-0 active:scale-[0.98]";

  if (href) {
    return (
      <Link href={href} className={cls} aria-label={label}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls} aria-label={label}>
      {inner}
    </button>
  );
}

export function QuickActions({ me }: { me: Me | null }) {
  const [receiveOpen, setReceiveOpen] = useState(false);

  return (
    <>
      <div className="grid grid-cols-4 gap-2.5 sm:gap-3">
        <ActionTile
          icon={SentIcon}
          label="Send"
          sublabel="Pay anyone"
          href="/app/pay"
        />
        <ActionTile
          icon={QrCode01Icon}
          label="Receive"
          sublabel="Get paid"
          onClick={() => setReceiveOpen(true)}
        />
        <ActionTile
          icon={ScanIcon}
          label="Scan"
          sublabel="QR to pay"
          onClick={() => setReceiveOpen(true)}
        />
        <ActionTile
          icon={PlusSignIcon}
          label="Add"
          sublabel="Top up"
          href="/app/ramps"
          badge="Soon"
        />
      </div>

      <ReceiveSheet open={receiveOpen} onClose={() => setReceiveOpen(false)} me={me} />
    </>
  );
}
