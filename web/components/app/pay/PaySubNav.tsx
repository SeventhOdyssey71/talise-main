"use client";

/**
 * PaySubNav — the sub-navigation pill row for the Pay area.
 *
 * The Pay landing (/app/pay) is the Send flow; Request, Cheques (claimable
 * links) and Stream (streamed payouts) live on sibling routes that previously
 * had NO in-app entry point. This row makes all four reachable, matching the
 * AppShell glass-pill nav style (talise-glass rounded-full, accent-soft active
 * state). Active state is derived from the current pathname.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDataTransferHorizontalIcon,
  ArrowDownLeft01Icon,
  Invoice01Icon,
  FlashIcon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";

type Item = { label: string; href: string; icon: IconSvgElement; exact?: boolean };

const ITEMS: Item[] = [
  { label: "Send", href: "/app/pay", icon: ArrowDataTransferHorizontalIcon as IconSvgElement, exact: true },
  { label: "Request", href: "/app/pay/request", icon: ArrowDownLeft01Icon as IconSvgElement },
  { label: "Cheques", href: "/app/pay/cheques", icon: Invoice01Icon as IconSvgElement },
  { label: "Stream", href: "/app/pay/stream", icon: FlashIcon as IconSvgElement },
];

function isActive(pathname: string, item: Item): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(item.href + "/");
}

export function PaySubNav() {
  const pathname = usePathname() ?? "/app/pay";
  return (
    // MOBILE-ONLY: on desktop the sidebar already expands Pay into the same
    // Send/Request/Cheques/Stream children, so this pill row would be redundant
    // (lg:hidden). On mobile the sidebar is hidden and the bottom-nav doesn't
    // expand Pay, so this is the only sub-nav.
    <nav className="mb-5 flex w-full justify-center sm:justify-start lg:hidden">
      <div className="talise-glass flex items-center gap-1 rounded-full px-1.5 py-1.5">
        {ITEMS.map((item) => {
          const active = isActive(pathname, item);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${
                active ? "bg-accent-soft text-accent" : "text-fg-muted hover:bg-accent-soft"
              }`}
            >
              <HugeiconsIcon
                icon={item.icon}
                size={16}
                strokeWidth={active ? 2.2 : 1.8}
                color={active ? "var(--color-accent)" : undefined}
                className={active ? "" : "text-fg-muted"}
              />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export default PaySubNav;
