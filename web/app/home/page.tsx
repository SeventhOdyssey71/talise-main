import { redirect } from "next/navigation";
import { userById, hasBusiness } from "@/lib/db";
import { readSessionEntryId } from "@/lib/session";
import {
  getSuiBalance,
  getUsdcBalance,
  getUsdsuiBalance,
  suiscanAccountUrl,
} from "@/lib/sui";
import { getSuiUsdcPrice } from "@/lib/deepbook";
import { getEarnSnapshot } from "@/lib/yield";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowUpRight01FreeIcons,
  ArrowDownLeft01FreeIcons,
  ArrowRight01FreeIcons,
  LinkSquare02FreeIcons,
  WavingHand02FreeIcons,
} from "@hugeicons/core-free-icons";
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
import {
  findTaliseSubnameForOwner,
  findAllTaliseSubnamesForOwner,
} from "@/lib/suins-lookup";
import { FixSubnameBanner } from "@/components/FixSubnameBanner";
import { TopUpButton } from "@/components/TopUpButton";
import { OnrampSuccessToast } from "@/components/OnrampSuccessToast";
import { getRecentActivity, type ActivityEntry } from "@/lib/activity";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ onramp?: string }>;
}) {
  const params = await searchParams;
  const onrampSuccess = params.onramp === "success";
  const id = await readSessionEntryId();
  if (!id) redirect("/");
  const user = await userById(id);
  if (!user) redirect("/");
  if (!user.account_type) redirect("/onboarding");
  if (user.account_type === "business") redirect("/business");

  const [
    balance,
    usdc,
    usdsui,
    suiPrice,
    earnSnapshot,
    ownedCoins,
    subname,
    allSubnames,
    activity,
  ] = await Promise.all([
    getSuiBalance(user.sui_address),
    // USDC is still fetched solely so the auto-convert banner can detect
    // legacy USDC and convert it to USDsui. It is NOT shown as a balance.
    getUsdcBalance(user.sui_address),
    getUsdsuiBalance(user.sui_address),
    getSuiUsdcPrice(),
    // Real NAVI supply APY + the user's current supplied position.
    // Same source as the /earn page so the strip is consistent.
    getEarnSnapshot(user.sui_address).catch(() => ({
      supplied: 0,
      apy: 0,
      dailyYield: 0,
      pending: [],
      totalPendingUsd: 0,
    })),
    // Surface every coin type the user holds so the auto-convert banner
    // can sweep anything that isn't already USDsui into our canonical
    // stable. Failures here shouldn't block the page from rendering.
    getOwnedCoins(user.sui_address).catch(() => []),
    // Reverse-lookup the user's `*.talise.sui` subname directly from chain.
    // Authoritative — no DB.
    findTaliseSubnameForOwner(user.sui_address),
    // All owned `*.talise.sui` NFTs (with their current SuiNS target).
    // Used to surface stale ones (target == null) for one-tap repair.
    findAllTaliseSubnamesForOwner(user.sui_address),
    // On-chain activity feed — sent + received, with counterparty handles
    // resolved when available. Authoritative; doesn't depend on our DB.
    getRecentActivity(user.sui_address, 12).catch(() => [] as ActivityEntry[]),
  ]);

  const staleSubnames = allSubnames.filter((s) => !s.targetAddress);

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
    { href: "/chat", label: "Talise", icon: NavIcons.assistant },
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
        <div className="flex items-center gap-4">
          <TopUpButton compact />
          <div className="flex items-center gap-2 text-[12px] text-[var(--color-fg-muted)]">
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[#21A179]" />
            live
          </div>
        </div>
      }
    >
      <OnrampSuccessToast show={onrampSuccess} />

      {/* 1. Alerts — banners that demand attention, all in one stack so
             they don't visually fragment the top of the page. */}
      <div className="space-y-2">
        <FixSubnameBanner
          stale={staleSubnames.map((s) => ({
            nftId: s.nftId,
            fullName: s.fullName,
          }))}
          userAddress={user.sui_address}
        />
        <AutoConvertBanner coins={nonUsdsui} suiUsdPrice={suiPrice ?? 0} />
        <NetworkBanner />
      </div>

      {/* 2. Balance — the hero of the dashboard. */}
      <section className="mt-2">
        <PersonalBalanceCard
          totalUsd={totalUsd}
          usdsui={usdsui.usdsui}
          sui={balance.sui}
          suiUsd={suiUsd}
        />
      </section>

      {/* 3. Quick actions — the four primary verbs. */}
      <section className="mt-6">
        <PaymentActions />
      </section>

      {/* 4. Identity — username + address, lightweight reference. */}
      <section className="mt-10">
        <SectionRow title="Your identity" />
        <div className="mt-4 space-y-2">
          {subname ? (
            <UsernameCard
              username={subname.username}
              address={user.sui_address}
              size="sm"
            />
          ) : (
            <a
              href="/claim"
              className="group flex items-center justify-between rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-5 py-4 transition hover:border-[var(--color-fg)]"
            >
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-fg-dim)]">
                  New
                </div>
                <div className="mt-1 text-[14px] text-[var(--color-fg)]">
                  Claim your <span className="font-mono">@username</span> —
                  get paid at <span className="font-mono">name@talise</span>.
                </div>
              </div>
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[var(--color-line)] bg-white text-[var(--color-fg)] transition group-hover:border-[var(--color-fg)]">
                <HugeiconsIcon
                  icon={ArrowRight01FreeIcons}
                  size={14}
                  strokeWidth={1.8}
                  color="currentColor"
                />
              </span>
            </a>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-5 py-3.5">
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-fg-dim)]">
                Wallet
              </div>
              <div className="mt-1 truncate text-[13px] text-[var(--color-fg)]">
                {user.email}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <CopyAddress address={user.sui_address} />
              <a
                href={suiscanAccountUrl(user.sui_address)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 font-mono text-[11px] text-[var(--color-fg-dim)] underline-offset-4 hover:text-[var(--color-fg)] hover:underline"
                title={user.sui_address}
              >
                {shortAddress(user.sui_address, 4, 4)}
                <HugeiconsIcon
                  icon={LinkSquare02FreeIcons}
                  size={11}
                  strokeWidth={1.8}
                  color="currentColor"
                />
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* 5. Earn — quick at-a-glance yield. */}
      <section className="mt-10">
        <SectionRow title="Earn" />
        <div className="mt-4">
          <EarnStrip apy={earnSnapshot.apy} supplied={earnSnapshot.supplied} />
        </div>
      </section>

      {/* 6. Activity — historical record. */}
      <section className="mt-10">
        <SectionRow title="Activity" />
        {activity.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-[var(--color-line)] bg-[var(--color-surface-2)] p-12 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-[var(--color-line)] bg-white text-[var(--color-fg-muted)]">
              <HugeiconsIcon
                icon={WavingHand02FreeIcons}
                size={20}
                strokeWidth={1.6}
                color="currentColor"
              />
            </div>
            <p className="mt-5 text-[15px] font-medium text-[var(--color-fg)]">
              You have no payments yet.
            </p>
            <p className="mt-1 text-[12px] text-[var(--color-fg-muted)]">
              Send money to a friend in seconds. No fees, instant delivery.
            </p>
            <a
              href="/send"
              className="mt-5 inline-flex items-center gap-1.5 rounded-md bg-[var(--color-fg)] px-4 py-2 text-[13px] font-medium text-[var(--color-bg)] transition hover:bg-[var(--color-accent-soft)]"
            >
              Send your first payment
              <HugeiconsIcon
                icon={ArrowRight01FreeIcons}
                size={14}
                strokeWidth={2}
                color="currentColor"
              />
            </a>
          </div>
        ) : (
          <ul className="mt-4 space-y-2">
            {activity.map((e) => (
              <ActivityRow key={e.digest} entry={e} />
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

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const sent = entry.direction === "sent";
  const amount =
    entry.amountUsdsui !== null
      ? `$${entry.amountUsdsui.toFixed(2)}`
      : entry.amountSui !== null
        ? `${entry.amountSui.toFixed(4)} SUI`
        : "—";
  const counterparty =
    entry.counterpartyName ??
    (entry.counterparty
      ? `${entry.counterparty.slice(0, 6)}…${entry.counterparty.slice(-4)}`
      : "—");
  const when = entry.timestampMs
    ? new Date(entry.timestampMs).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
  return (
    <li className="flex items-center justify-between rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-4 py-3.5 text-[13px]">
      <div className="flex items-center gap-3">
        <span
          className={`flex h-8 w-8 items-center justify-center rounded-full border border-[var(--color-line)] ${
            sent
              ? "bg-white text-[var(--color-fg-muted)]"
              : "bg-white text-[#0f6f4d]"
          }`}
          aria-hidden
        >
          <HugeiconsIcon
            icon={sent ? ArrowUpRight01FreeIcons : ArrowDownLeft01FreeIcons}
            size={14}
            strokeWidth={1.8}
            color="currentColor"
          />
        </span>
        <div className="min-w-0">
          <div className="text-[var(--color-fg)]">
            {sent ? "Sent" : "Received"} {amount}{" "}
            <span className="text-[var(--color-fg-muted)]">
              {sent ? "to" : "from"}
            </span>{" "}
            <span
              className={
                entry.counterpartyName
                  ? "font-mono text-[var(--color-fg)]"
                  : "font-mono text-[var(--color-fg-muted)]"
              }
              title={entry.counterparty ?? undefined}
            >
              {counterparty}
            </span>
          </div>
          {when && (
            <div className="font-mono text-[11px] text-[var(--color-fg-dim)]">
              {when}
            </div>
          )}
        </div>
      </div>
      <a
        href={`https://suiscan.xyz/mainnet/tx/${entry.digest}`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 text-[12px] text-[var(--color-fg-muted)] underline-offset-4 hover:text-[var(--color-fg)] hover:underline"
      >
        receipt
        <HugeiconsIcon
          icon={LinkSquare02FreeIcons}
          size={12}
          strokeWidth={1.8}
          color="currentColor"
        />
      </a>
    </li>
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
