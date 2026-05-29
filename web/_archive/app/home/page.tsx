import { redirect } from "next/navigation";
import { userById } from "@/lib/db";
import { readSessionEntryId } from "@/lib/session";
import { getSuiBalance, getUsdsuiBalance } from "@/lib/sui";
import { getSuiUsdcPrice } from "@/lib/deepbook";
import { getEarnSnapshot } from "@/lib/yield";
import { getOwnedCoins } from "@/lib/coins";
import { isUsdsui } from "@/lib/usdsui";
import {
  findTaliseSubnameForOwner,
  findAllTaliseSubnamesForOwner,
} from "@/lib/suins-lookup";
import { FixSubnameBanner } from "@/components/FixSubnameBanner";
import { AutoConvertBanner } from "@/components/AutoConvertBanner";
import { NetworkBanner } from "@/components/NetworkBanner";
import { OnrampSuccessToast } from "@/components/OnrampSuccessToast";
import { getRecentActivity, type ActivityEntry } from "@/lib/activity";
import { formatLocal } from "@/lib/fx";
import { AppShell } from "@/components/talise-app/AppShell";
import { BalanceCard } from "@/components/talise-app/BalanceCard";
import { HistoryRow } from "@/components/talise-app/HistoryRow";
import Link from "next/link";

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
    usdsui,
    suiPrice,
    earnSnapshot,
    ownedCoins,
    subname,
    allSubnames,
    activity,
  ] = await Promise.all([
    getSuiBalance(user.sui_address),
    getUsdsuiBalance(user.sui_address),
    getSuiUsdcPrice(),
    getEarnSnapshot(user.sui_address).catch(() => ({
      supplied: 0,
      apy: 0,
      dailyYield: 0,
      pending: [],
      totalPendingUsd: 0,
    })),
    getOwnedCoins(user.sui_address).catch(() => []),
    findTaliseSubnameForOwner(user.sui_address),
    findAllTaliseSubnamesForOwner(user.sui_address),
    getRecentActivity(user.sui_address, 20).catch(() => [] as ActivityEntry[]),
  ]);

  const staleSubnames = allSubnames.filter((s) => !s.targetAddress);
  const nonUsdsui = ownedCoins.filter((c) => !isUsdsui(c.coinType));

  const suiUsd = balance.sui * (suiPrice || 0);
  const totalUsd = suiUsd + usdsui.usdsui;
  const firstName = displayName(user.name);
  const primaryDisplay = formatLocal(totalUsd, "NGN");
  const secondaryDisplay = `${usdsui.usdsui.toFixed(2)} USDsui`;
  const apyText =
    earnSnapshot.apy > 0
      ? `Earn ${(earnSnapshot.apy * 100).toFixed(1)}%`
      : "Earn up to 11%";

  return (
    <AppShell active="home">
      <OnrampSuccessToast show={onrampSuccess} />

      {/* Greeting — light, low-volume label, matches mobile. */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="text-[12px] uppercase tracking-[0.18em] text-[var(--color-fg-dim)]">
            Hi, {firstName}
          </div>
          {subname?.fullName && (
            <div className="mt-0.5 font-mono text-[11px] text-[var(--color-fg-muted)]">
              {subname.fullName}
            </div>
          )}
        </div>
        <Link
          href="/settings"
          aria-label="Profile"
          className="grid w-10 h-10 place-items-center rounded-full bg-[var(--color-surface-2)] text-[var(--color-fg)] text-[14px]"
        >
          {firstName.slice(0, 1).toUpperCase()}
        </Link>
      </div>

      {/* Alerts only render when there's a problem to surface — keep the
          healthy home page clean. */}
      <div className="space-y-2 empty:hidden mb-4">
        <FixSubnameBanner
          stale={staleSubnames.map((s) => ({ nftId: s.nftId, fullName: s.fullName }))}
          userAddress={user.sui_address}
        />
        <AutoConvertBanner coins={nonUsdsui} suiUsdPrice={suiPrice ?? 0} />
        <NetworkBanner />
      </div>

      <BalanceCard
        usdsui={totalUsd}
        primaryDisplay={primaryDisplay}
        secondaryDisplay={`${secondaryDisplay} · ${apyText}`}
      />

      {/* Subname suggestion — single quiet line, only when missing. */}
      {!subname && (
        <Link
          href="/claim"
          className="talise-glass mt-6 flex items-center justify-between rounded-2xl px-4 py-3 text-[13px]"
        >
          <span>
            Claim <span className="font-mono text-[var(--color-accent)]">@username</span> — get paid at{" "}
            <span className="font-mono">name@talise</span>
          </span>
          <span className="text-[var(--color-fg-muted)]">→</span>
        </Link>
      )}

      {/* Activity — the main feed. Compact mobile rows. */}
      <section className="mt-8">
        <div className="mb-3 flex items-end justify-between">
          <h2 className="text-[15px] text-[var(--color-fg)]">Activity</h2>
          <Link
            href={`https://suiscan.xyz/mainnet/account/${user.sui_address}`}
            target="_blank"
            rel="noreferrer noopener"
            className="text-[11px] font-mono text-[var(--color-fg-muted)]"
          >
            See all
          </Link>
        </div>
        {activity.length === 0 ? (
          <EmptyActivity />
        ) : (
          <ul className="space-y-2">
            {activity.map((e) => (
              <li key={e.digest}>
                <HistoryRow entry={e} currency="NGN" />
              </li>
            ))}
          </ul>
        )}
      </section>
    </AppShell>
  );
}

function EmptyActivity() {
  return (
    <div className="talise-glass rounded-2xl p-8 text-center">
      <div className="text-[14px] text-[var(--color-fg)]">No payments yet.</div>
      <div className="mt-1 text-[12px] text-[var(--color-fg-muted)]">
        Send to a friend in seconds — no fees, instant.
      </div>
      <Link
        href="/send"
        className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-[var(--color-accent)] px-4 py-2 text-[12px] font-medium text-[var(--color-bg)]"
      >
        Send your first payment →
      </Link>
    </div>
  );
}

function displayName(raw: string | null | undefined): string {
  const n = (raw ?? "").trim().split(/\s+/)[0];
  if (!n) return "friend";
  return n[0].toUpperCase() + n.slice(1).toLowerCase();
}
