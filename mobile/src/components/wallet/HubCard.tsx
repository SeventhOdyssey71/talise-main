import { Pressable, StyleSheet, Text, View } from "react-native";

import { HugeIcon } from "@/design/assets";
import { Icon } from "@/design/Icon";
import { colors } from "@/design/tokens";
import { family } from "@/design/typography";

/**
 * A funding/move-money row — IconChip (42 mint wash + tinted HugeIcon) + title
 * (heading 16) + subtitle (12.5) + chevron, on a radius-24 surface card with a
 * faint hairline. `soon` dims it. Matches the iOS FundingPathCard / ActionTile.
 */
export function HubCard({
  icon,
  title,
  subtitle,
  soon = false,
  onPress,
}: {
  icon: string;
  title: string;
  subtitle: string;
  soon?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, { opacity: soon ? 0.75 : pressed ? 0.9 : 1 }]}
    >
      <View style={styles.chip}>
        <HugeIcon name={icon} size={20} color={colors.greenMint} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.sub}>{subtitle}</Text>
      </View>
      {soon ? (
        <Text style={styles.soon}>Soon</Text>
      ) : (
        <Icon name="chevron.right" size={14} color={colors.fgDim} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
    borderRadius: 24,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.05)",
  },
  chip: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(202,255,184,0.12)",
  },
  title: { fontFamily: family.sans, fontSize: 16, fontWeight: "600", color: colors.fg },
  sub: { fontFamily: family.sans, fontSize: 12.5, fontWeight: "300", color: colors.fgMuted, marginTop: 2 },
  soon: { fontFamily: family.mono, fontSize: 9, letterSpacing: 1, color: colors.fgDim, textTransform: "uppercase" },
});
