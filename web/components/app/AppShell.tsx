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

import { useMemo, useState, type ReactNode } from "react";
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
} from "@hugeicons/core-free-icons";
import { CurrencyProvider, useCurrency } from "./data/currency";
import { ToastProvider } from "./data/toast";
import { useBalances, seedResource, type Me } from "./data";
import { triggerOauthSignIn } from "@/lib/zkclient";
import { Diamond } from "@/components/Diamond";
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

function isActive(pathname: string, href: string): boolean {
  if (href === "/app") return pathname === "/app";
  return pathname === href || pathname.startsWith(href + "/");
}

// ── Brand mark ─────────────────────────────────────────────────────────────

function Logo({ compact = false }: { compact?: boolean }) {
  // The real Talise brand mark (the pinwheel from public/symbol.svg), forest-
  // tinted via --color-accent — identical to the landing TopBar wordmark.
  return (
    <Link href="/app" className="inline-flex items-center gap-2">
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

function BalanceChip() {
  const { data, loading } = useBalances();
  const { formatUsd } = useCurrency();
  return (
    <Link
      href="/app"
      className="talise-glass inline-flex items-center gap-2 rounded-full px-3 py-1.5 transition-colors hover:border-[color-mix(in_srgb,var(--color-accent-deep)_40%,var(--color-line))]"
    >
      <span className="size-1.5 rounded-full" style={{ background: "var(--color-accent-deep)" }} />
      <span className="text-[13px] font-semibold tabular-nums text-fg" style={{ letterSpacing: "-0.01em" }}>
        {loading && !data ? "—" : formatUsd(data?.totalUsd ?? 0)}
      </span>
    </Link>
  );
}

// ── Currency select ─────────────────────────────────────────────────────────

function CurrencySelect() {
  const { currency, setCurrency, currencies } = useCurrency();
  return (
    <select
      value={currency}
      onChange={(e) => setCurrency(e.target.value)}
      aria-label="Display currency"
      className="w-fit max-w-full cursor-pointer self-start rounded-full border border-line bg-surface px-3 py-1.5 font-mono text-[11px] font-medium uppercase tracking-wider text-fg-muted outline-none transition-colors hover:border-[color-mix(in_srgb,var(--color-accent-deep)_40%,var(--color-line))] focus:ring-1 focus:ring-[color-mix(in_srgb,var(--color-accent-deep)_45%,transparent)]"
    >
      {currencies.map((c) => (
        <option key={c.code} value={c.code} className="bg-surface text-fg">
          {c.code} · {c.symbol}
        </option>
      ))}
    </select>
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
  const cls = `flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors ${
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

function SignInScreen() {
  return (
    <div className="landing-mint talise-appshell relative min-h-screen overflow-hidden text-fg">
      <div className="talise-top-glow" />
      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6">
        <div className="talise-glass w-full max-w-sm rounded-[28px] px-7 py-9 text-center">
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
            onClick={() => triggerOauthSignIn({ returnTo: "/app" })}
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

// ── Mobile avatar menu ─────────────────────────────────────────────────────────

function MobileMenu({ me, open, onClose }: { me: Me; open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <>
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className="fixed inset-0 z-40 lg:hidden"
      />
      <div className="talise-glass absolute right-4 top-14 z-50 w-56 overflow-hidden rounded-2xl py-1.5 lg:hidden">
        <div className="flex items-center gap-3 px-4 py-3">
          <Avatar me={me} size={36} />
          <div className="min-w-0">
            <div className="truncate text-[14px] font-medium text-fg">{accountLabel(me)}</div>
            <div className="truncate text-[12px] text-fg-dim">{me.email}</div>
          </div>
        </div>
        <div className="my-1 h-px bg-line" />
        <Link href="/app/settings" onClick={onClose} className="flex items-center gap-3 px-4 py-2.5 text-[14px] text-fg-muted transition-colors hover:bg-accent-soft hover:text-fg">
          <HugeiconsIcon icon={Settings01Icon} size={18} strokeWidth={1.8} /> Settings
        </Link>
        <Link href="/app/ramps" onClick={onClose} className="flex items-center justify-between px-4 py-2.5 text-[14px] text-fg-muted transition-colors hover:bg-accent-soft hover:text-fg">
          <span className="flex items-center gap-3">
            <HugeiconsIcon icon={CreditCardIcon} size={18} strokeWidth={1.8} /> Ramps
          </span>
          <span className="rounded-full border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-dim">Soon</span>
        </Link>
        <div className="my-1 h-px bg-line" />
        <a href="/auth/logout" className="flex items-center gap-3 px-4 py-2.5 text-[14px] text-fg-muted transition-colors hover:bg-accent-soft hover:text-fg">
          <HugeiconsIcon icon={Logout01Icon} size={18} strokeWidth={1.8} /> Sign out
        </a>
      </div>
    </>
  );
}

// ── Shell body (inside providers) ─────────────────────────────────────────────

function ShellBody({ me, children }: { me: Me; children: ReactNode }) {
  const pathname = usePathname() ?? "/app";
  const [menuOpen, setMenuOpen] = useState(false);
  const title = useMemo(() => {
    const matched = Object.keys(PAGE_TITLES)
      .filter((k) => isActive(pathname, k))
      .sort((a, b) => b.length - a.length)[0];
    return matched ? PAGE_TITLES[matched] : "Talise";
  }, [pathname]);

  return (
    <div className="landing-mint talise-appshell relative min-h-screen text-fg">
      <div className="talise-top-glow" />

      {/* ── Desktop sidebar (lg+) ── */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line px-4 py-5 lg:flex">
        <div className="px-2">
          <Logo />
        </div>
        <nav className="mt-7 flex flex-1 flex-col gap-1">
          {PRIMARY.map((item) => (
            <SidebarItem key={item.href} item={item} active={isActive(pathname, item.href)} />
          ))}
          <div className="my-3 h-px bg-line" />
          <SidebarItem
            item={{ label: "Ramps", href: "/app/ramps", icon: CreditCardIcon as IconSvgElement }}
            active={false}
            dimmed
            badge="Soon"
          />
          <SidebarItem
            item={{ label: "Settings", href: "/app/settings", icon: Settings01Icon as IconSvgElement }}
            active={isActive(pathname, "/app/settings")}
          />
        </nav>
        <div className="mt-4 flex flex-col gap-3">
          <CurrencySelect />
          <Link
            href="/app/settings"
            className="talise-glass flex items-center gap-2.5 rounded-2xl px-3 py-2.5 transition-colors hover:border-[color-mix(in_srgb,var(--color-accent-deep)_40%,var(--color-line))]"
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

      {/* ── Main area ── */}
      <div className="relative z-10 lg:pl-60">
        {/* Desktop topbar */}
        <header className="sticky top-0 z-20 hidden items-center justify-between border-b border-line bg-[color-mix(in_srgb,var(--color-bg)_82%,transparent)] px-8 py-3 backdrop-blur-xl lg:flex">
          <h1 className="text-[18px] font-semibold tracking-[-0.02em] text-fg">{title}</h1>
          <div className="flex items-center gap-3">
            <BalanceChip />
          </div>
        </header>

        {/* Mobile mini-bar — transparent, sits on the mint gradient and scrolls
            away with the content (no bar background / border). */}
        <header className="relative z-30 flex items-center justify-between px-4 pb-1 pt-3 lg:hidden">
          <Logo />
          <div className="flex items-center gap-2.5">
            <BalanceChip />
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Account menu"
              aria-expanded={menuOpen}
              className="rounded-full ring-1 ring-line transition-transform active:scale-95"
            >
              <Avatar me={me} size={32} />
            </button>
          </div>
          <MobileMenu me={me} open={menuOpen} onClose={() => setMenuOpen(false)} />
        </header>

        {/* Content column */}
        <main className="mx-auto w-full max-w-[1040px] px-4 pb-32 pt-4 sm:px-6 lg:px-8 lg:pb-12 lg:pt-6">
          {children}
        </main>
      </div>

      {/* ── Mobile bottom nav ── */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-4 lg:hidden">
        <div className="talise-glass flex items-center gap-1 rounded-full px-2 py-2" style={{ borderRadius: 999 }}>
          {PRIMARY.map((item) => {
            const active = isActive(pathname, item.href);
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

export type AppShellProps = { me: Me | null; children: ReactNode };

export function AppShell({ me, children }: AppShellProps) {
  if (!me) {
    return <SignInScreen />;
  }
  // Seed the client me-cache from the session the layout already resolved, so
  // useMe() in any page is correct (real @handle) + instant, with no /api/me
  // round-trip on load. Idempotent; a later client fetch can still update it.
  seedResource("/api/me", me);
  return (
    <CurrencyProvider>
      <ToastProvider>
        <ShellBody me={me}>{children}</ShellBody>
      </ToastProvider>
    </CurrencyProvider>
  );
}

export default AppShell;
