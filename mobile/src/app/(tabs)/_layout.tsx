import { Tabs } from "expo-router";

import { PillTabBar } from "@/components/PillTabBar";
import { colors } from "@/design/tokens";

/**
 * The four root tabs — Home · Finance · Rewards · Profile — matching the iOS
 * MainTabView. Rendered with a custom floating pill bar (PillTabBar) instead of
 * a native tab bar. Money flows (Send, Cash-out, Cheques, …) are NOT tabs; they
 * get pushed as screens on the root Stack as we port them.
 */
export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <PillTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="finance" options={{ title: "Finance" }} />
      <Tabs.Screen name="rewards" options={{ title: "Rewards" }} />
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />
    </Tabs>
  );
}
