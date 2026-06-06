"use client";

/**
 * The responsive app chrome.
 *
 *   lg+   →  240px fixed left sidebar (logo, primary nav, divider, secondary
 *            nav, footer account chip + currency picker) + a max-w content
 *            column with a slim topbar (page title, balance chip, account).
 *   <lg   →  a top mini-bar (logo, balance chip, avatar menu) + content + a
 *            floating bottom glass nav pill with the 5 primary items.
 *
 * When `me == null` it renders a centered sign-in screen instead of the app.
 * Mounts <CurrencyProvider> + <ToastProvider> for everything beneath it.
 */

import { type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Home09Icon,
  ArrowDataTransferHorizontalIcon,
  Plant02Icon,
  Briefcase01Icon,
  Analytics01Icon,
  Settings01Icon,
  CreditCardIcon,
  GoogleIcon,
  Logout01Icon,
  UserIcon,
  Invoice01Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { CurrencyProvider, useCurrency } from "./data/currency";
import { Flag } from "./ui";
import { ToastProvider } from "./data/toast";
import { useBalances, seedResource, type Me, type Balances } from "./data";
import { triggerOauthSignIn } from "@/lib/zkclient";
import { Diamond } from "@/components/Diamond";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { IconSvgElement } from "@hugeicons/react";

type NavItem = { label: string; href: string; icon: IconSvgElement };

const PRIMARY: NavItem[] = [
  { label: "Home", href: "/app", icon: Home09Icon as IconSvgElement },
  { label: "Pay", href: "/app/pay", icon: ArrowDataTransferHorizontalIcon as IconSvgElement },
  { label: "Earn", href: "/app/earn", icon: Plant02Icon as IconSvgElement },
  { label: "Work", href: "/app/work", icon: Briefcase01Icon as IconSvgElement },
  { label: "Activity", href: "/app/activity", icon: Analytics01Icon as IconSvgElement },
];

const PAGE_TITLES: Record<string, string> = {
  "/app": "Home",
  "/app/pay": "Pay",
  "/app/earn": "Earn",
  "/app/work": "Work",
  "/app/activity": "Activity",
  "/app/ramps": "Ramps",
  "/app/settings": "Settings",
};

/**
 * Nav configuration — lets one shell drive two surfaces: the consumer wallet
 * (/app) and the business workspace (/business). Everything route-specific
 * (brand target, primary nav, ramps/settings links, page titles, sign-in
 * return) lives here so the chrome stays identical and in sync.
 */
export type NavConfig = {
  brandHref: string;
  primary: NavItem[];
  rampsHref: string;
  settingsHref: string;
  titles: Record<string, string>;
  signInReturnTo: string;
};

export const CONSUMER_NAV: NavConfig = {
  brandHref: "/app",
  primary: PRIMARY,
  rampsHref: "/app/ramps",
  settingsHref: "/app/settings",
  titles: PAGE_TITLES,
  signInReturnTo: "/app",
};

export const BUSINESS_NAV: NavConfig = {
  brandHref: "/business/dashboard",
  primary: [
    { label: "Dashboard", href: "/business/dashboard", icon: Home09Icon as IconSvgElement },
    { label: "Invoices", href: "/business/invoices", icon: Invoice01Icon as IconSvgElement },
    { label: "Team", href: "/business/team", icon: UserGroupIcon as IconSvgElement },
    { label: "Pay", href: "/business/pay", icon: ArrowDataTransferHorizontalIcon as IconSvgElement },
    { label: "Activity", href: "/business/activity", icon: Analytics01Icon as IconSvgElement },
  ],
  rampsHref: "/business/ramps",
  settingsHref: "/business/settings",
  titles: {
    "/business/dashboard": "Dashboard",
    "/business/invoices": "Invoices",
    "/business/team": "Team",
    "/business/pay": "Pay",
    "/business/activity": "Activity",
    "/business/ramps": "Ramps",
    "/business/settings": "Settings",
  },
  signInReturnTo: "/business/dashboard",
};

function isActive(pathname: string, href: string, brandHref: string): boolean {
  if (href === brandHref) return pathname === brandHref;
  return pathname === href || pathname.startsWith(href + "/");
}

// ── Brand mark ─────────────────────────────────────────────────────────────

function Logo({ compact = false, homeHref = "/app" }: { compact?: boolean; homeHref?: string }) {
  // The real Talise brand mark (the pinwheel from public/symbol.svg), forest-
  // tinted via --color-accent — identical to the landing TopBar wordmark.
  return (
    <Link href={homeHref} className="inline-flex items-center gap-2">
      <Diamond />
      {!compact && (
        <span className="font-display text-[18px] font-semibold lowercase tracking-[-0.02em] text-fg">
          talise
        </span>
      )}
    </Link>
  );
}

// ── Balance chip ─────────────────────────────────────────────────────────────

function BalanceChip({ homeHref = "/app" }: { homeHref?: string }) {
  const { data, loading, error } = useBalances();
  const { formatUsd } = useCurrency();
  return (
    <Link
      href={homeHref}
      className="talise-glass inline-flex items-center gap-2 rounded-full px-3 py-1.5 transition-colors hover:border-[color-mix(in_srgb,var(--color-accent-deep)_40%,var(--color-line))]"
    >
      <span className="size-1.5 rounded-full" style={{ background: "var(--color-accent-deep)" }} />
      <span className="text-[13px] font-semibold tabular-nums text-fg" style={{ letterSpacing: "-0.01em" }}>
        {!data && (loading || error) ? "—" : formatUsd(data?.totalUsd ?? 0)}
      </span>
    </Link>
  );
}

// ── Currency select ─────────────────────────────────────────────────────────

function CurrencySelect() {
  const { currency, setCurrency, currencies } = useCurrency();
  return (
    <Select value={currency} onValueChange={setCurrency}>
      <SelectTrigger
        aria-label="Display currency"
        className="h-auto w-fit max-w-full self-start rounded-full border-line bg-surface px-3 py-1.5 font-mono text-[11px] font-medium uppercase tracking-wider text-fg-muted shadow-none"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="talise-glass max-h-72 rounded-xl">
        {currencies.map((c) => (
          <SelectItem
            key={c.code}
            value={c.code}
            className="font-mono text-[12px] uppercase tracking-wide"
          >
            <Flag code={c.code} size={15} className="mr-1.5 align-middle" /> {c.code} · {c.symbol}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ── Account chip / avatar ─────────────────────────────────────────────────────

function Avatar({ me, size = 28 }: { me: Me; size?: number }) {
  const initial = (me.name ?? me.email ?? "?").trim().charAt(0).toUpperCase();
  if (me.picture) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={me.picture}
        alt={me.name ?? "Account"}
        width={size}
        height={size}
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="flex items-center justify-center rounded-full text-[12px] font-semibold text-white"
      style={{ width: size, height: size, background: "var(--color-accent-deep)" }}
    >
      {initial}
    </span>
  );
}

function accountLabel(me: Me): string {
  if (me.taliseHandle) return `@${me.taliseHandle}`;
  return me.name ?? me.email;
}

// ── Sidebar nav item (lg+) ─────────────────────────────────────────────────────

function SidebarItem({ item, active, dimmed, badge }: { item: NavItem; active: boolean; dimmed?: boolean; badge?: string }) {
  const content = (
    <>
      <HugeiconsIcon
        icon={item.icon}
        size={19}
        strokeWidth={active ? 2.2 : 1.8}
        color={active ? "var(--color-accent)" : undefined}
        className={active ? "" : "text-fg-muted"}
      />
      <span className={`flex-1 text-[14px] font-medium ${active ? "text-accent" : "text-fg-muted"}`}>
        {item.label}
      </span>
      {badge && (
        <span className="rounded-full border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-dim">
          {badge}
        </span>
      )}
    </>
  );
  const cls = `flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${
    active ? "bg-accent-soft" : "hover:bg-accent-soft"
  } ${dimmed ? "opacity-55" : ""}`;
  if (dimmed) {
    return (
      <div className={cls} aria-disabled>
        {content}
      </div>
    );
  }
  return (
    <Link href={item.href} className={cls}>
      {content}
    </Link>
  );
}

// ── Sign-in screen ─────────────────────────────────────────────────────────────

function SignInScreen({ returnTo = "/app" }: { returnTo?: string }) {
  return (
    <div className="app-clean talise-appshell relative min-h-screen overflow-hidden text-fg">
      <div className="talise-top-glow" />
      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6">
        <div className="talise-glass w-full max-w-sm rounded-xl px-7 py-9 text-center">
          <div className="mx-auto mb-6 flex scale-[1.4] justify-center">
            <Logo compact />
          </div>
          <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-fg">Talise</h1>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.22em] text-accent">Beta</p>
          <p className="mx-auto mt-4 max-w-[16rem] text-[14px] leading-relaxed text-fg-muted">
            A gasless dollar wallet on Sui. Sign in to send, save, and get paid — no gas, no seed phrase.
          </p>
          <button
            type="button"
            onClick={() => triggerOauthSignIn({ returnTo })}
            className="mt-7 inline-flex w-full items-center justify-center gap-3 rounded-full bg-accent-deep px-5 py-3 text-[15px] font-semibold text-white shadow-[0_6px_18px_-6px_rgba(35,78,20,0.45)] transition-[transform,background] duration-150 hover:bg-[color-mix(in_srgb,var(--color-accent-deep)_88%,white)] active:scale-[0.98]"
          >
            <HugeiconsIcon icon={GoogleIcon} size={20} color="#ffffff" />
            Continue with Google
          </button>
        </div>
        <p className="mt-6 text-center text-[12px] text-fg-dim">Invite-only beta · by Talise</p>
      </div>
    </div>
  );
}

// ── Account dropdown (Radix DropdownMenu) ──────────────────────────────────────

function AccountMenu({
  me,
  size = 32,
  settingsHref = "/app/settings",
  rampsHref = "/app/ramps",
}: {
  me: Me;
  size?: number;
  settingsHref?: string;
  rampsHref?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        className="rounded-full outline-none ring-1 ring-line transition-transform active:scale-95 focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--color-accent-deep)_45%,transparent)]"
      >
        <Avatar me={me} size={size} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="talise-glass w-56 rounded-xl">
        <DropdownMenuLabel className="flex items-center gap-3 px-2 py-1.5">
          <Avatar me={me} size={34} />
          <div className="min-w-0">
            <div className="truncate text-[14px] font-medium text-fg">{accountLabel(me)}</div>
            <div className="truncate text-[12px] font-normal text-fg-dim">{me.email}</div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={settingsHref}>
            <HugeiconsIcon icon={Settings01Icon} size={18} strokeWidth={1.8} /> Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={rampsHref}>
            <HugeiconsIcon icon={CreditCardIcon} size={18} strokeWidth={1.8} /> Ramps
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href="/auth/logout">
            <HugeiconsIcon icon={Logout01Icon} size={18} strokeWidth={1.8} /> Sign out
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Shell body (inside providers) ─────────────────────────────────────────────

function ShellBody({ me, nav, children }: { me: Me; nav: NavConfig; children: ReactNode }) {
  const pathname = usePathname() ?? nav.brandHref;

  return (
    <div className="app-clean talise-appshell relative min-h-screen text-fg">
      <div className="talise-top-glow" />

      {/* ── Desktop sidebar (lg+) ── */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line px-4 py-5 lg:flex">
        <div className="px-2">
          <Logo homeHref={nav.brandHref} />
        </div>
        <nav className="mt-7 flex flex-1 flex-col gap-1">
          {nav.primary.map((item) => (
            <SidebarItem key={item.href} item={item} active={isActive(pathname, item.href, nav.brandHref)} />
          ))}
          <div className="my-3 h-px bg-line" />
          <SidebarItem
            item={{ label: "Ramps", href: nav.rampsHref, icon: CreditCardIcon as IconSvgElement }}
            active={isActive(pathname, nav.rampsHref, nav.brandHref)}
          />
          <SidebarItem
            item={{ label: "Settings", href: nav.settingsHref, icon: Settings01Icon as IconSvgElement }}
            active={isActive(pathname, nav.settingsHref, nav.brandHref)}
          />
        </nav>
        <div className="mt-4 flex flex-col gap-3">
          <CurrencySelect />
          <Link
            href={nav.settingsHref}
            className="talise-glass flex items-center gap-2.5 rounded-xl px-3 py-2.5 transition-colors hover:border-[color-mix(in_srgb,var(--color-accent-deep)_40%,var(--color-line))]"
          >
            <Avatar me={me} size={30} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-fg">{accountLabel(me)}</div>
              <div className="truncate font-mono text-[10px] text-fg-dim">
                {me.suiAddress.slice(0, 6)}…{me.suiAddress.slice(-4)}
              </div>
            </div>
          </Link>
        </div>
      </aside>

      {/* ── Main area ── (no desktop topbar — the sidebar shows the active
          page; content leads, Wise-style) */}
      <div className="relative z-10 lg:pl-60">
        {/* Mobile mini-bar — transparent, sits on the mint gradient and scrolls
            away with the content (no bar background / border). */}
        <header className="relative z-30 flex items-center justify-between px-4 pb-1 pt-3 lg:hidden">
          <Logo homeHref={nav.brandHref} />
          <div className="flex items-center gap-2.5">
            <BalanceChip homeHref={nav.brandHref} />
            <AccountMenu me={me} settingsHref={nav.settingsHref} rampsHref={nav.rampsHref} />
          </div>
        </header>

        {/* Content column */}
        <main className="mx-auto w-full max-w-[1040px] px-4 pb-32 pt-4 sm:px-6 lg:px-8 lg:pb-12 lg:pt-16">
          {children}
        </main>
      </div>

      {/* ── Mobile bottom nav ── */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-4 lg:hidden">
        <div className="talise-glass flex items-center gap-1 rounded-full px-2 py-2" style={{ borderRadius: 999 }}>
          {nav.primary.map((item) => {
            const active = isActive(pathname, item.href, nav.brandHref);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
                className={`flex flex-col items-center gap-0.5 rounded-full px-3.5 py-1.5 transition-colors ${
                  active ? "bg-accent-soft" : ""
                }`}
              >
                <HugeiconsIcon
                  icon={item.icon}
                  size={20}
                  strokeWidth={active ? 2.2 : 1.8}
                  color={active ? "var(--color-accent)" : undefined}
                  className={active ? "" : "text-fg-muted"}
                />
                <span className={`text-[10px] font-medium ${active ? "text-accent" : "text-fg-dim"}`}>
                  {item.label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

// ── Public AppShell ─────────────────────────────────────────────────────────

export type AppShellProps = {
  me: Me | null;
  initialBalances?: Balances | null;
  /** Drives consumer (/app) vs business (/business) chrome. Default: consumer. */
  nav?: NavConfig;
  children: ReactNode;
};

export function AppShell({ me, initialBalances, nav = CONSUMER_NAV, children }: AppShellProps) {
  if (!me) {
    return <SignInScreen returnTo={nav.signInReturnTo} />;
  }
  // Seed the client caches from what the layout already resolved server-side, so
  // useMe()/useBalances() render correct values INSTANTLY with no round-trip on
  // load (the @handle + the balance hero). Idempotent; the client still
  // revalidates fresh afterwards.
  seedResource("/api/me", me);
  if (initialBalances) seedResource("/api/balances", initialBalances);
  return (
    <CurrencyProvider>
      <ToastProvider>
        <ShellBody me={me} nav={nav}>{children}</ShellBody>
      </ToastProvider>
    </CurrencyProvider>
  );
}

export default AppShell;
