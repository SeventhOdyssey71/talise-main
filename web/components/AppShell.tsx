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
            className={`flex flex-col items-center justify-center gap-1 py-2.5 font-mono text-[10px] uppercase tracking-wider ${
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
      className={`group flex items-center gap-3 rounded-md px-3 py-2 font-mono text-[12px] uppercase tracking-[0.06em] transition ${
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

export const NavIcons = {
  home: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11l9-8 9 8M5 10v10h14V10" />
    </svg>
  ),
  send: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 17L17 7M9 7h8v8" />
    </svg>
  ),
  receive: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 7L7 17M15 17H7V9" />
    </svg>
  ),
  pay: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10" />
    </svg>
  ),
  earn: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
    </svg>
  ),
  invoice: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h4" />
    </svg>
  ),
  payroll: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="9" r="3" />
      <circle cx="17" cy="11" r="2.2" />
      <path d="M3 19c0-3 2.5-5 6-5s6 2 6 5M14 19c.2-1.7 1.5-3 3-3s2.8 1.2 3 3" />
    </svg>
  ),
  activity: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12h4l2-6 4 12 2-6h6" />
    </svg>
  ),
  settings: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  rewards: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="8" width="18" height="5" rx="1" />
      <path d="M12 8v13M5 13v8h14v-8M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5" />
    </svg>
  ),
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
      { href: "/rewards", label: "Rewards", icon: NavIcons.rewards, active: currentPath === "/rewards" },
    ];
  }
  return [
    { href: "/home", label: "Dashboard", icon: NavIcons.home, active: currentPath === "/home" },
    { href: "/send", label: "Send", icon: NavIcons.send, active: currentPath === "/send" },
    { href: "/receive", label: "Receive", icon: NavIcons.receive, active: currentPath === "/receive" },
    { href: "/pay", label: "Pay", icon: NavIcons.pay, active: currentPath.startsWith("/pay") },
    { href: "/earn", label: "Earn", icon: NavIcons.earn, active: currentPath === "/earn" },
    { href: "/rewards", label: "Rewards", icon: NavIcons.rewards, active: currentPath === "/rewards" },
  ];
}
