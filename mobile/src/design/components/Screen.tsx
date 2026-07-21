import type { ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, spacing } from "@/design/tokens";

type Props = {
  children: ReactNode;
  /** Scrollable body (default) vs a fixed full-height view. */
  scroll?: boolean;
  /** Extra bottom padding so content clears the floating pill tab bar. */
  tabBarSpace?: boolean;
};

/**
 * Standard dark screen container: black ground, top safe-area inset, consistent
 * horizontal gutters, and room at the bottom for the floating pill nav.
 */
export function Screen({ children, scroll = true, tabBarSpace = true }: Props) {
  const insets = useSafeAreaInsets();
  const pad = {
    paddingTop: insets.top + spacing.sm,
    paddingBottom: tabBarSpace ? 120 : insets.bottom + spacing.base,
  };

  if (!scroll) {
    return <View style={[styles.base, styles.gutter, pad]}>{children}</View>;
  }
  return (
    <ScrollView
      style={styles.base}
      contentContainerStyle={[styles.gutter, pad]}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  base: { flex: 1, backgroundColor: colors.bg },
  gutter: { paddingHorizontal: spacing.base },
});
