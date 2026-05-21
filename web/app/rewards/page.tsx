import { redirect } from "next/navigation";
import { AppShell, navForAccount } from "@/components/AppShell";
import { RewardsPanel } from "@/components/RewardsPanel";
import { RewardsHero } from "@/components/RewardsHero";
import {
  getRewardsSummary,
  hasBusiness,
  userById,
} from "@/lib/db";
import { readSessionEntryId } from "@/lib/session";
import { getRecentActivity, type ActivityEntry } from "@/lib/activity";
import { findTaliseSubnameForOwner } from "@/lib/suins-lookup";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function RewardsPage() {
  const id = await readSessionEntryId();
  if (!id) redirect("/");
  const user = await userById(id);
  if (!user) redirect("/");
  if (!user.account_type) redirect("/onboarding");

  const [summary, activity, subname] = await Promise.all([
    getRewardsSummary(user.id),
    getRecentActivity(user.sui_address, 50).catch(
      () => [] as ActivityEntry[]
    ),
    findTaliseSubnameForOwner(user.sui_address).catch(() => null),
  ]);

  // Sent count + USDsui volume from on-chain activity. Source of truth lives
  // on-chain so this matches what the home page surfaces.
  let sentCount = 0;
  let sentVolumeUsd = 0;
  for (const e of activity) {
    if (e.direction !== "sent") continue;
    sentCount += 1;
    if (typeof e.amountUsdsui === "number") sentVolumeUsd += e.amountUsdsui;
  }

  const ctx = user.account_type === "business" ? "business" : "personal";
  const nav = navForAccount(ctx, "/rewards");

  return (
    <AppShell
      email={user.email}
      picture={user.picture}
      currentContext={ctx}
      hasBusinessContext={hasBusiness(user)}
      navItems={nav}
      pageEyebrow="Rewards"
      pageTitle="Refer & earn"
    >
      <RewardsHero
        pointsTotal={summary.pointsTotal}
        referralCount={summary.referralCount}
        sentCount={sentCount}
        sentVolumeUsd={sentVolumeUsd}
        subnameLabel={subname ? `${subname.username}@talise` : null}
      />

      <div className="mt-12">
        <RewardsPanel
          code={summary.code}
          recentEvents={summary.recentEvents}
        />
      </div>
    </AppShell>
  );
}
