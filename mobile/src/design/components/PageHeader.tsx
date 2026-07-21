import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Eyebrow } from "@/design/components/text";
import { colors, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

/**
 * PageHeader — eyebrow + title(26, semibold, kerning -0.5) with an optional
 * trailing accessory. Padding: horizontal 24, top 24, bottom 16 (iOS PageHeader).
 */
export function PageHeader({
  eyebrow,
  title,
  trailing,
}: {
  eyebrow: string;
  title: string;
  trailing?: ReactNode;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.col}>
        <Eyebrow>{eyebrow}</Eyebrow>
        <Text style={styles.title}>{title}</Text>
      </View>
      {trailing ? <View>{trailing}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
  },
  col: { gap: spacing.sm, flexShrink: 1 },
  title: {
    fontFamily: family.sans,
    fontSize: 26,
    fontWeight: "600",
    letterSpacing: -0.5,
    color: colors.fg,
  },
});
