import { Logo } from "./Logo";
import { AccountSwitcher } from "./AccountSwitcher";
import { SessionWatcher } from "./SessionWatcher";
import { ProofWarmer } from "./ProofWarmer";
import type { ReactNode } from "react";

export type NavItem = {
  href: string;
  label: string;
  icon: ReactNode;
  active?: boolean;
};

export function AppShell({
  email,
  picture,
  navItems,
  pageTitle,
  pageEyebrow,
  pageHeaderRight,
  currentContext,
  hasBusinessContext,
  children,
}: {
  email: string;
  picture: string | null;
  navItems: NavItem[];
  pageTitle?: string;
  pageEyebrow?: string;
  pageHeaderRight?: ReactNode;
  /** Which context the user is currently in (drives the switcher). */
  currentContext: "personal" | "business";
  /** Has the user completed business onboarding? Controls the +Business affordance. */
  hasBusinessContext: boolean;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      <SessionWatcher />
      <ProofWarmer />
      {/* Full-viewport layout: sidebar flush left, content fills the rest */}
      <div className="flex min-h-screen">
        {/* SIDEBAR */}
        <aside className="hidden w-[244px] shrink-0 border-r border-[var(--color-line)] bg-[var(--color-surface)] md:flex md:flex-col">
          <div className="sticky top-0 flex h-screen flex-col p-5">
            <Logo size={28} />

            <div className="mt-6">
              <AccountSwitcher
                current={currentContext}
                hasBusiness={hasBusinessContext}
              />
            </div>

            <nav className="mt-8 flex flex-1 flex-col gap-1">
              {navItems.map((it) => (
                <SidebarItem key={it.href} item={it} />
              ))}
            </nav>

            <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] p-3">
              <div className="flex items-center gap-3">
                {picture && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={picture}
                    alt=""
                    className="h-8 w-8 rounded-full border border-[var(--color-line)]"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-[12px] text-[var(--color-fg)]">
                    {email.split("@")[0]}
                  </div>
                  <div className="truncate text-[10px] text-[var(--color-fg-dim)]">
                    {email}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between text-[11px]">
                <a
                  href="/settings"
                  className="text-[var(--color-fg-muted)] underline-offset-4 hover:text-[var(--color-fg)] hover:underline"
                >
                  settings
                </a>
                <form action="/auth/logout" method="POST">
                  <button
                    type="submit"
                    className="text-[var(--color-fg-dim)] underline-offset-4 hover:text-[var(--color-fg)] hover:underline"
                  >
                    sign out
                  </button>
                </form>
              </div>
            </div>
          </div>
        </aside>

        {/* MAIN */}
        <main className="flex w-full min-w-0 flex-col">
          {/* Mobile top bar */}
          <div className="sticky top-0 z-20 flex items-center justify-between border-b border-[var(--color-line)] bg-[var(--color-surface)]/85 px-5 py-4 backdrop-blur-md md:hidden">
            <Logo size={26} />
            <div className="flex items-center gap-3 text-[12px] text-[var(--color-fg-muted)]">
              <a href="/settings" className="hover:text-[var(--color-fg)]">
                settings
              </a>
              <form action="/auth/logout" method="POST">
                <button type="submit" className="hover:text-[var(--color-fg)]">
                  sign out
                </button>
              </form>
            </div>
          </div>

          {/* Page header */}
          {(pageTitle || pageEyebrow || pageHeaderRight) && (
            <div className="border-b border-[var(--color-line)] px-6 py-8 md:px-10 md:py-10">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  {pageEyebrow && (
                    <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-[var(--color-fg-dim)]">
                      {pageEyebrow}
                    </div>
                  )}
                  {pageTitle && (
                    <h1 className="mt-2 text-[32px] font-semibold leading-[1.05] tracking-[-0.02em] text-[var(--color-fg)] md:text-[40px]">
                      {pageTitle}
                    </h1>
                  )}
                </div>
                {pageHeaderRight}
              </div>
            </div>
          )}

          {/* Content */}
          <div className="flex-1 px-6 py-10 pb-32 md:px-10 md:pb-16">
            {children}
          </div>
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-[var(--color-line)] bg-[var(--color-surface)]/95 backdrop-blur-md md:hidden">
        {navItems.slice(0, 5).map((it) => (
          <a
            key={it.href}
            href={it.href}
            className={`flex flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-medium tracking-[-0.005em] ${
              it.active
                ? "text-[var(--color-fg)]"
                : "text-[var(--color-fg-dim)]"
            }`}
          >
            <span className="h-[14px] w-[14px]">{it.icon}</span>
            {it.label}
          </a>
        ))}
      </nav>
    </div>
  );
}

function SidebarItem({ item }: { item: NavItem }) {
  return (
    <a
      href={item.href}
      className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium tracking-[-0.005em] transition ${
        item.active
          ? "bg-[var(--color-surface-2)] text-[var(--color-fg)]"
          : "text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
      }`}
    >
      <span
        className={`flex h-5 w-5 items-center justify-center ${
          item.active ? "text-[var(--color-fg)]" : "text-[var(--color-fg-dim)]"
        }`}
      >
        {item.icon}
      </span>
      {item.label}
    </a>
  );
}

import { HugeiconsIcon } from "@hugeicons/react";
import {
  Home09FreeIcons,
  MoneySendFreeIcons,
  MoneyReceiveFreeIcons,
  QrCodeFreeIcons,
  CoinsDollarFreeIcons,
  Invoice03FreeIcons,
  UserMultiple02FreeIcons,
  ChartLineData02FreeIcons,
  Settings03FreeIcons,
  GiftFreeIcons,
  AiChat02FreeIcons,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";

/**
 * Helper: wrap a HugeIcons icon in our consistent sidebar size + stroke.
 * Sidebar icons are rendered at 16px with a 1.6 stroke for an even
 * "weight" against the 13px label.
 */
function NavGlyph({ icon }: { icon: IconSvgElement }) {
  return (
    <HugeiconsIcon
      icon={icon}
      size={16}
      strokeWidth={1.6}
      color="currentColor"
    />
  );
}

export const NavIcons = {
  home: <NavGlyph icon={Home09FreeIcons} />,
  send: <NavGlyph icon={MoneySendFreeIcons} />,
  receive: <NavGlyph icon={MoneyReceiveFreeIcons} />,
  pay: <NavGlyph icon={QrCodeFreeIcons} />,
  earn: <NavGlyph icon={CoinsDollarFreeIcons} />,
  invoice: <NavGlyph icon={Invoice03FreeIcons} />,
  payroll: <NavGlyph icon={UserMultiple02FreeIcons} />,
  activity: <NavGlyph icon={ChartLineData02FreeIcons} />,
  settings: <NavGlyph icon={Settings03FreeIcons} />,
  rewards: <NavGlyph icon={GiftFreeIcons} />,
  assistant: <NavGlyph icon={AiChat02FreeIcons} />,
};

/**
 * Build a sidebar nav for the signed-in account, marking the active item by
 * checking the currentPath against each href.
 */
export function navForAccount(
  accountType: "personal" | "business" | null,
  currentPath: string
): NavItem[] {
  if (accountType === "business") {
    return [
      { href: "/business", label: "Dashboard", icon: NavIcons.home, active: currentPath === "/business" },
      { href: "/business/invoice", label: "Invoices", icon: NavIcons.invoice, active: currentPath.startsWith("/business/invoice") },
      { href: "/business/payroll", label: "Payroll", icon: NavIcons.payroll, active: currentPath.startsWith("/business/payroll") },
      { href: "/receive", label: "Receive", icon: NavIcons.receive, active: currentPath === "/receive" },
      { href: "/earn", label: "Earn", icon: NavIcons.earn, active: currentPath === "/earn" },
      { href: "/chat", label: "Talise", icon: NavIcons.assistant, active: currentPath === "/chat" },
      { href: "/rewards", label: "Rewards", icon: NavIcons.rewards, active: currentPath === "/rewards" },
    ];
  }
  return [
    { href: "/home", label: "Dashboard", icon: NavIcons.home, active: currentPath === "/home" },
    { href: "/send", label: "Send", icon: NavIcons.send, active: currentPath === "/send" },
    { href: "/receive", label: "Receive", icon: NavIcons.receive, active: currentPath === "/receive" },
    { href: "/pay", label: "Pay", icon: NavIcons.pay, active: currentPath.startsWith("/pay") },
    { href: "/earn", label: "Earn", icon: NavIcons.earn, active: currentPath === "/earn" },
    { href: "/chat", label: "Talise", icon: NavIcons.assistant, active: currentPath === "/chat" },
    { href: "/rewards", label: "Rewards", icon: NavIcons.rewards, active: currentPath === "/rewards" },
  ];
}
