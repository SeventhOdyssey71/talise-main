import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { colors, radius, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

/**
 * Minimal structural type for the props expo-router's <Tabs tabBar> passes.
 * Declared locally (not imported from @react-navigation/bottom-tabs) to avoid a
 * dual-copy react-navigation type clash between expo-router's bundled types and
 * the standalone package.
 */
type TabBarProps = {
  state: { index: number; routes: { key: string; name: string }[] };
  navigation: {
    emit: (e: { type: "tabPress"; target: string; canPreventDefault: true }) => { defaultPrevented: boolean };
    navigate: (name: string) => void;
  };
};

/** Tab → icon (filled when active). Matches the iOS 4-tab pill nav. */
const ICONS: Record<string, { on: keyof typeof Ionicons.glyphMap; off: keyof typeof Ionicons.glyphMap; label: string }> = {
  index: { on: "home", off: "home-outline", label: "Home" },
  finance: { on: "trending-up", off: "trending-up-outline", label: "Finance" },
  rewards: { on: "gift", off: "gift-outline", label: "Rewards" },
  profile: { on: "person", off: "person-outline", label: "Profile" },
};

/**
 * Custom floating pill tab bar — the iOS app uses a bespoke BottomNavPill, not a
 * native UITabBar. A dark rounded pill sits above the home indicator with four
 * icon+label items; the active item glows mint.
 */
export function PillTabBar({ state, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
      <View style={styles.pill}>
        {state.routes.map((route, i) => {
          const cfg = ICONS[route.name];
          if (!cfg) return null;
          const focused = state.index === i;
          const onPress = () => {
            const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
          };
          return (
            <Pressable key={route.key} onPress={onPress} style={styles.item} hitSlop={8}>
              <Ionicons
                name={focused ? cfg.on : cfg.off}
                size={22}
                color={focused ? colors.greenMint : colors.fgMuted}
              />
              <Text style={[styles.label, { color: focused ? colors.greenMint : colors.fgMuted }]}>
                {cfg.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
  },
  pill: {
    flexDirection: "row",
    backgroundColor: colors.surface2,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  item: {
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    paddingHorizontal: spacing.base,
    paddingVertical: 6,
    minWidth: 68,
  },
  label: {
    fontFamily: family.sans,
    fontSize: 11,
    fontWeight: "600",
  },
});
