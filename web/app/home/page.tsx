import { redirect } from "next/navigation";
import { userById, userTxs, hasBusiness } from "@/lib/db";
import { readSessionEntryId } from "@/lib/session";
import {
  getSuiBalance,
  getUsdcBalance,
  getUsdsuiBalance,
  suiscanAccountUrl,
  suiscanTxUrl,
} from "@/lib/sui";
import { getSuiUsdcPrice, getMarginPoolInfo } from "@/lib/deepbook";
import { CopyAddress } from "@/components/CopyAddress";
import { AppShell, NavIcons } from "@/components/AppShell";
import { PersonalBalanceCard } from "@/components/PersonalBalanceCard";
import { PaymentActions } from "@/components/PaymentActions";
import { EarnStrip } from "@/components/EarnStrip";
import { NetworkBanner } from "@/components/NetworkBanner";
import { AutoConvertBanner } from "@/components/AutoConvertBanner";
import { UsernameCard } from "@/components/UsernameCard";
import { getOwnedCoins } from "@/lib/coins";
import { isUsdsui } from "@/lib/usdsui";
import { shortAddress } from "@/lib/format";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HomePage() {
  const id = await readSessionEntryId();
  if (!id) redirect("/");
  const user = await userById(id);
  if (!user) redirect("/");
  if (!user.account_type) redirect("/onboarding");
  if (user.account_type === "business") redirect("/business");

  const [balance, usdc, usdsui, suiPrice, marginUsdc, txs, ownedCoins] =
    await Promise.all([
      getSuiBalance(user.sui_address),
      // USDC is still fetched solely so the auto-convert banner can detect
      // legacy USDC and convert it to USDsui. It is NOT shown as a balance.
      getUsdcBalance(user.sui_address),
      getUsdsuiBalance(user.sui_address),
      getSuiUsdcPrice(),
      getMarginPoolInfo("USDC"),
      userTxs(user.id, 10),
      // Surface every coin type the user holds so the auto-convert banner
      // can sweep anything that isn't already USDsui into our canonical
      // stable. Failures here shouldn't block the page from rendering.
      getOwnedCoins(user.sui_address).catch(() => []),
    ]);

  const nonUsdsui = ownedCoins.filter((c) => !isUsdsui(c.coinType));
  // Mark `usdc` as intentionally read for the auto-convert path. We do not
  // surface USDC as a balance — USDsui is the canonical "Dollars" balance.
  void usdc;

  const suiUsd = balance.sui * (suiPrice || 0);
  const totalUsd = suiUsd + usdsui.usdsui;
  const firstName = displayName(user.name);

  const nav = [
    { href: "/home", label: "Dashboard", icon: NavIcons.home, active: true },
    { href: "/send", label: "Send", icon: NavIcons.send },
    { href: "/receive", label: "Receive", icon: NavIcons.receive },
    { href: "/pay", label: "Pay", icon: NavIcons.pay },
    { href: "/earn", label: "Earn", icon: NavIcons.earn },
  ];

  return (
    <AppShell
      email={user.email}
      picture={user.picture}
      currentContext="personal"
      hasBusinessContext={hasBusiness(user)}
      navItems={nav}
      pageEyebrow="Personal account"
      pageTitle={`Welcome, ${firstName}.`}
      pageHeaderRight={
        <div className="flex items-center gap-2 text-[12px] text-[var(--color-fg-muted)]">
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[#21A179]" />
          live
        </div>
      }
    >
      {!user.talise_username && (
        <a
          href="/claim"
          className="mb-4 flex items-center justify-between rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-5 py-4 transition hover:border-[var(--color-fg)]"
        >
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-fg-dim)]">
              New
            </div>
            <div className="mt-1 text-[14px] text-[var(--color-fg)]">
              Claim your <span className="font-mono">@username</span> — get paid at{" "}
              <span className="font-mono">name@talise</span>.
            </div>
          </div>
          <span className="text-[12px] text-[var(--color-fg-muted)]">claim →</span>
        </a>
      )}

      <AutoConvertBanner
        coins={nonUsdsui}
        suiUsdPrice={suiPrice ?? 0}
      />

      <NetworkBanner />

      <div className="grid gap-4 md:grid-cols-[1.5fr,1fr]">
        <PersonalBalanceCard
          totalUsd={totalUsd}
          usdsui={usdsui.usdsui}
          sui={balance.sui}
          suiUsd={suiUsd}
        />
        {user.talise_username && (
          <UsernameCard
            username={user.talise_username}
            address={user.sui_address}
            size="sm"
          />
        )}
      </div>

      <div className="mt-6">
        <PaymentActions />
      </div>

      <section className="mt-12">
        <SectionRow title="Your account" />
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="text-[13px] text-[var(--color-fg)]">
              {user.email}
            </span>
            <span className="hidden text-[11px] text-[var(--color-fg-dim)] md:inline">
              your account ID is ready to share
            </span>
          </div>
          <div className="flex items-center gap-3">
            <CopyAddress address={user.sui_address} />
            <a
              href={suiscanAccountUrl(user.sui_address)}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-[var(--color-fg-dim)] underline-offset-4 hover:text-[var(--color-fg)] hover:underline"
              title={user.sui_address}
            >
              {shortAddress(user.sui_address, 4, 4)}
            </a>
          </div>
        </div>
      </section>

      <EarnStrip marginUsdc={marginUsdc} />

      <section className="mt-12">
        <SectionRow title="Activity" />
        {txs.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-[var(--color-line)] bg-[var(--color-surface-2)] p-12 text-center">
            <div className="mx-auto h-10 w-10 rounded-full border border-[var(--color-line)]" />
            <p className="mt-4 text-[14px] text-[var(--color-fg)]">
              You have no payments yet.
            </p>
            <p className="mt-1 text-[12px] text-[var(--color-fg-muted)]">
              Send money to a friend in seconds. No fees, instant delivery.
            </p>
            <a
              href="/send"
              className="mt-5 inline-block rounded-md bg-[var(--color-fg)] px-4 py-2 text-[13px] font-medium text-[var(--color-bg)] hover:bg-[var(--color-accent-soft)]"
            >
              Send your first payment →
            </a>
          </div>
        ) : (
          <ul className="mt-4 space-y-2">
            {txs.map((tx) => (
              <li
                key={tx.id}
                className="flex items-center justify-between rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-4 py-3.5 text-[13px]"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--color-line)] text-[var(--color-fg-muted)]">
                    ↗
                  </span>
                  <div>
                    <div className="text-[var(--color-fg)]">
                      Sent ${tx.amount}
                    </div>
                    <div className="font-mono text-[11px] text-[var(--color-fg-dim)]">
                      to {tx.recipient?.slice(0, 6)}…{tx.recipient?.slice(-4)}
                    </div>
                  </div>
                </div>
                <a
                  href={suiscanTxUrl(tx.digest)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[var(--color-fg-muted)] underline-offset-4 hover:text-[var(--color-fg)] hover:underline"
                >
                  receipt ↗
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="mt-16 border-t border-[var(--color-line)] pt-6 text-[11px] text-[var(--color-fg-dim)]">
        Your money. Always yours.
      </footer>
    </AppShell>
  );
}

function SectionRow({
  title,
  right,
}: {
  title: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-[11px] uppercase tracking-[0.2em] text-[var(--color-fg-dim)]">
        {title}
      </h2>
      {right}
    </div>
  );
}

function displayName(raw: string | null | undefined): string {
  const n = (raw ?? "").trim().split(/\s+/)[0];
  if (!n) return "friend";
  return n[0].toUpperCase() + n.slice(1).toLowerCase();
}
