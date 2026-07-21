import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "@/design/Icon";
import { colors } from "@/design/tokens";
import { family } from "@/design/typography";

/**
 * LiquidGlassPill — small capsule chip. surface2 fill + optional tint@0.18 wash +
 * 1px line border. Icon(11/10) + title(body 12/11, kerning -0.1, fg). Compact
 * variant is smaller. Matches ios LiquidGlassPill.swift.
 */
export function Pill({
  title,
  icon,
  tint,
  compact = false,
  onPress,
}: {
  title: string;
  icon?: string;
  tint?: string;
  compact?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.97 : 1 }] })}>
      <View
        style={[
          styles.pill,
          {
            height: compact ? 24 : 30,
            paddingHorizontal: compact ? 10 : 14,
            backgroundColor: colors.surface2,
          },
        ]}
      >
        {tint ? (
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.wash, { backgroundColor: withAlpha(tint, 0.18) }]} />
        ) : null}
        {icon ? <Icon name={icon} size={compact ? 10 : 11} color={colors.fg} /> : null}
        <Text style={[styles.title, { fontSize: compact ? 11 : 12 }]}>{title}</Text>
      </View>
    </Pressable>
  );
}

function withAlpha(hex: string, a: number): string {
  if (!hex.startsWith("#") || hex.length !== 7) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: "hidden",
  },
  wash: { borderRadius: 999 },
  title: { fontFamily: family.sans, fontWeight: "500", letterSpacing: -0.1, color: colors.fg },
});
