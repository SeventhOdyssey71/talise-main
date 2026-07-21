import { TabPlaceholder } from "@/design/components/TabPlaceholder";

/** Finance tab — port of iOS Earn/EarnView.swift (Earn venue, Perps, Roundup, Goals, Insights). */
export default function FinanceScreen() {
  return (
    <TabPlaceholder
      title="Finance"
      subtitle="Earn · Invest"
      icon="leaf.fill"
      note="Earn, Perps, round-ups, goals and insights land here as the Finance module is ported from iOS."
    />
  );
}
