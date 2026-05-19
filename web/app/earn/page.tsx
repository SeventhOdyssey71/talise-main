import { redirect } from "next/navigation";
import { userById, hasBusiness } from "@/lib/db";
import { readSessionEntryId } from "@/lib/session";
import { getSuiBalance, getUsdsuiBalance, network } from "@/lib/sui";
import { getMarginPoolInfo } from "@/lib/deepbook";
import { EarnStrategyPicker } from "@/components/EarnStrategyPicker";
import { AppShell, navForAccount } from "@/components/AppShell";

export const dynamic = "force-dynamic";

export default async function EarnPage({
  searchParams,
}: {
  searchParams: Promise<{ strategy?: string }>;
}) {
  const id = await readSessionEntryId();
  if (!id) redirect("/");
  const user = await userById(id);
  if (!user) redirect("/");
  if (!user.account_type) redirect("/onboarding");

  const params = await searchParams;
  const initial = params.strategy === "margin" ? "margin" : "spot";

  const [sui, usdsui, marginUsdc] = await Promise.all([
    getSuiBalance(user.sui_address),
    getUsdsuiBalance(user.sui_address),
    getMarginPoolInfo("USDC"),
  ]);

  return (
    <AppShell
      email={user.email}
      picture={user.picture}
      currentContext={user.account_type === "business" ? "business" : "personal"}
      hasBusinessContext={hasBusiness(user)}
      navItems={navForAccount(user.account_type, "/earn")}
      pageEyebrow={`Earn · ${network()}`}
      pageTitle="Idle USDsui, working"
    >
      <p className="max-w-2xl text-[14px] text-[var(--color-fg-muted)]">
        Two DeepBook strategies. Pick the one that fits your risk appetite.
        Both run as a single signed PTB and stay non-custodial; the position
        object lives in your wallet.
      </p>

      <div className="mt-10">
        <EarnStrategyPicker
          initial={initial}
          senderAddress={user.sui_address}
          availableUsdsui={usdsui.usdsui}
          availableSui={sui.sui}
          marginSupplyApr={marginUsdc?.supplyApr ?? 0}
          marginUtilization={marginUsdc?.utilization ?? 0}
          existingBmId={user.spot_bm_id ?? null}
        />
      </div>
    </AppShell>
  );
}
