import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "@/design/Icon";
import { colors, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

/**
 * Minimal structural type for the props expo-router's <Tabs tabBar> passes.
 * Declared locally (not imported from @react-navigation/bottom-tabs) to avoid a
 * dual-copy react-navigation type clash.
 */
type TabBarProps = {
  state: { index: number; routes: { key: string; name: string }[] };
  navigation: {
    emit: (e: { type: "tabPress"; target: string; canPreventDefault: true }) => { defaultPrevented: boolean };
    navigate: (name: string) => void;
  };
};

/** route → SF Symbol + label, matching ios AppRoot.swift MainTabView. */
const TABS: Record<string, { symbol: string; label: string }> = {
  index: { symbol: "house.fill", label: "Home" },
  finance: { symbol: "leaf.fill", label: "Finance" },
  rewards: { symbol: "gift.fill", label: "Rewards" },
  profile: { symbol: "person.crop.circle.fill", label: "Profile" },
};

/**
 * Bottom nav — the iOS BottomNavPill: a surfaceGlass capsule (height 64) with a
 * 1px line border + soft shadow; the active tab sits in a surfaceGlassStrong
 * capsule. Icons/labels are fg (icon 18, label body 10 kerning -0.36).
 */
export function PillTabBar({ state, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
      <View style={styles.bar}>
        {state.routes.map((route, i) => {
          const cfg = TABS[route.name];
          if (!cfg) return null;
          const focused = state.index === i;
          const onPress = () => {
            const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
          };
          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              hitSlop={6}
              style={[styles.item, focused && styles.itemActive]}
            >
              <Icon name={cfg.symbol} size={18} color={colors.fg} />
              <Text style={styles.label}>{cfg.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, bottom: 0, alignItems: "center" },
  bar: {
    flexDirection: "row",
    height: 64,
    alignItems: "center",
    backgroundColor: colors.surfaceGlass,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 6,
    gap: 2,
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 14,
  },
  item: {
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    paddingHorizontal: spacing.lg,
    height: 52,
    minWidth: 66,
    borderRadius: 26,
  },
  itemActive: { backgroundColor: colors.surfaceGlassStrong },
  label: { fontFamily: family.sans, fontSize: 10, letterSpacing: -0.36, color: colors.fg, fontWeight: "500" },
});
