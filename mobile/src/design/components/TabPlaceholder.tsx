import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { Screen } from "@/design/components/Screen";
import { colors, radius, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

/**
 * Temporary tab body used while feature areas are being ported from iOS. Keeps
 * the design language consistent; swapped for the real screen as each module
 * lands.
 */
export function TabPlaceholder({
  title,
  subtitle,
  icon,
  note,
}: {
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  note: string;
}) {
  return (
    <Screen>
      <Text style={styles.eyebrow}>{subtitle.toUpperCase()}</Text>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <Ionicons name={icon} size={28} color={colors.greenMint} />
        </View>
        <Text style={styles.note}>{note}</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  eyebrow: {
    fontFamily: family.mono,
    fontSize: 11,
    letterSpacing: 1.6,
    color: colors.fgDim,
    marginBottom: 6,
  },
  title: {
    fontFamily: family.sans,
    fontSize: 26,
    fontWeight: "700",
    color: colors.fg,
    marginBottom: spacing.lg,
    letterSpacing: -0.5,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    padding: spacing.lg,
    alignItems: "center",
    gap: spacing.base,
  },
  iconWrap: {
    width: 60,
    height: 60,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  note: {
    color: colors.fgMuted,
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
    fontFamily: family.sans,
  },
});
