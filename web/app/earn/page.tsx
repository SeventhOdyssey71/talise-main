import { redirect } from "next/navigation";
import { userById, hasBusiness } from "@/lib/db";
import { readSessionEntryId } from "@/lib/session";
import { getUsdsuiBalance, network } from "@/lib/sui";
import { getEarnSnapshot } from "@/lib/yield";
import { EarnDashboard } from "@/components/EarnDashboard";
import { AppShell, navForAccount } from "@/components/AppShell";

export const dynamic = "force-dynamic";

export default async function EarnPage() {
  const id = await readSessionEntryId();
  if (!id) redirect("/");
  const user = await userById(id);
  if (!user) redirect("/");
  if (!user.account_type) redirect("/onboarding");

  const [usdsui, snapshot] = await Promise.all([
    getUsdsuiBalance(user.sui_address),
    getEarnSnapshot(user.sui_address).catch(() => ({
      supplied: 0,
      apy: 0,
      dailyYield: 0,
      pending: [],
      totalPendingUsd: 0,
    })),
  ]);

  return (
    <AppShell
      email={user.email}
      picture={user.picture}
      currentContext={user.account_type === "business" ? "business" : "personal"}
      hasBusinessContext={hasBusiness(user)}
      navItems={navForAccount(user.account_type, "/earn")}
      pageEyebrow={`Earn · ${network()}`}
      pageTitle="Your savings"
    >
      <p className="max-w-2xl text-[14px] text-[var(--color-fg-muted)]">
        Idle USDsui earns yield in NAVI&apos;s lending market. Withdraw any
        time. No lockup, no minimum, gas is on us.
      </p>

      <div className="mt-8">
        <EarnDashboard
          senderAddress={user.sui_address}
          availableUsdsui={usdsui.usdsui}
          supplied={snapshot.supplied}
          apy={snapshot.apy}
          dailyYield={snapshot.dailyYield}
          pending={snapshot.pending}
          totalPendingUsd={snapshot.totalPendingUsd}
        />
      </div>
    </AppShell>
  );
}
