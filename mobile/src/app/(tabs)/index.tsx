import { TabPlaceholder } from "@/design/components/TabPlaceholder";

/**
 * Home tab — port of iOS Home/HomeView.swift. Built for real in Phase 4 (balance
 * hero + actions + live activity from GET /api/balances & /api/activity). Shows
 * the foundation shell until then — no mock data, per the exact-replication plan.
 */
export default function HomeScreen() {
  return (
    <TabPlaceholder
      title="Home"
      subtitle="Wallet"
      icon="house.fill"
      note="Balance hero, quick actions and live activity land here in Phase 4, wired to the real wallet API — not mocked."
    />
  );
}
