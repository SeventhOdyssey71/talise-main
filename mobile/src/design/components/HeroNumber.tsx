import { StyleSheet, Text, View } from "react-native";

import { GlassCard } from "@/design/components/GlassCard";
import { Eyebrow } from "@/design/components/text";
import { colors, radius, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

/**
 * HeroNumber — the big balance figure. fontSize 66 (compact) / 92 (regular);
 * value display(size, semibold) kerning -size*0.03, single line auto-shrinking
 * to 0.5. Optional eyebrow above and sub below (body 13, fgMuted).
 */
export function HeroNumber({
  value,
  eyebrow,
  sub,
  compact = true,
}: {
  value: string;
  eyebrow?: string;
  sub?: string;
  compact?: boolean;
}) {
  const size = compact ? 66 : 92;
  return (
    <View style={styles.wrap}>
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.5}
        style={[styles.value, { fontSize: size, letterSpacing: -size * 0.03 }]}
      >
        {value}
      </Text>
      {sub ? <Text style={styles.sub}>{sub}</Text> : null}
    </View>
  );
}

/** StatCard — eyebrow + value(heading 20) + optional sub, inside a glass card. */
export function StatCard({ eyebrow, value, sub }: { eyebrow: string; value: string; sub?: string }) {
  return (
    <GlassCard cornerRadius={radius.lg} style={styles.stat}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={styles.statValue}>
        {value}
      </Text>
      {sub ? <Text style={styles.sub}>{sub}</Text> : null}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.lg - 2, alignItems: "flex-start" }, // ~14
  value: { fontFamily: family.sans, fontWeight: "600", color: colors.fg },
  sub: { fontFamily: family.sans, fontSize: 13, color: colors.fgMuted },
  stat: { padding: spacing.lg, gap: 6, alignItems: "flex-start" },
  statValue: { fontFamily: family.sans, fontSize: 20, fontWeight: "500", color: colors.fg, letterSpacing: -0.8 },
});
