import { StyleSheet, Text, View } from "react-native";

import { Img } from "@/design/assets";
import { GlassCard } from "@/design/components/GlassCard";
import { PageHeader } from "@/design/components/PageHeader";
import { Screen } from "@/design/components/Screen";
import { TopGlow } from "@/design/components/TopGlow";
import { Icon } from "@/design/Icon";
import { colors, radius, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

/**
 * Foundation shell for a not-yet-ported feature area — built entirely from the
 * real design system + ported assets (TopGlow, TaliseLogo, PageHeader, GlassCard,
 * SF-symbol Icon). Replaced by the real screen as each phase lands. No mock data.
 */
export function TabPlaceholder({
  title,
  subtitle,
  icon,
  note,
}: {
  title: string;
  subtitle: string;
  icon: string;
  note: string;
}) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <TopGlow />
      <Screen>
        <Img name="TaliseLogo" style={styles.logo} />
        <PageHeader eyebrow={subtitle} title={title} />
        <GlassCard cornerRadius={radius.lg} style={styles.card}>
          <View style={styles.iconWrap}>
            <Icon name={icon} size={26} color={colors.greenMint} />
          </View>
          <Text style={styles.note}>{note}</Text>
        </GlassCard>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  logo: { width: 96, height: 26, resizeMode: "contain", marginBottom: spacing.md },
  card: { padding: spacing.xl, alignItems: "center", gap: spacing.lg, marginTop: spacing.sm },
  iconWrap: {
    width: 60,
    height: 60,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  note: { color: colors.fgMuted, fontSize: 14, lineHeight: 21, textAlign: "center", fontFamily: family.sans },
});
