import { TabPlaceholder } from "@/design/components/TabPlaceholder";

/** Rewards tab — port of iOS Rewards/RewardsView.swift (points, tier, referrals, redemptions). */
export default function RewardsScreen() {
  return (
    <TabPlaceholder
      title="Rewards"
      subtitle="Points · Referrals"
      icon="gift.fill"
      note="Points, tier, referral sharing, earning history and redemptions land here as the Rewards module is ported from iOS."
    />
  );
}
