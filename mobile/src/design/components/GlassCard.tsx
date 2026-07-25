import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { colors, radius } from "@/design/tokens";

/**
 * TaliseGlass card (.taliseGlass()) — flat surface fill, optional tint wash
 * (capped at 0.10), 1px `line` border, continuous corner radius (default 25).
 * Glassmorphism is retired on iOS: no blur, no shadow.
 */
export function GlassCard({
  children,
  cornerRadius = radius.xl,
  tint,
  disabled,
  style,
}: {
  children: ReactNode;
  cornerRadius?: number;
  tint?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        styles.base,
        { borderRadius: cornerRadius, opacity: disabled ? 0.6 : 1 },
        style,
      ]}
    >
      {tint ? (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: tint, opacity: 0.1, borderRadius: cornerRadius }]}
        />
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
});
