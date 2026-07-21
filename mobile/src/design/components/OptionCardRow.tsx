import { Pressable, StyleSheet, Text, View } from "react-native";

import { GlassCard } from "@/design/components/GlassCard";
import { Icon } from "@/design/Icon";
import { colors } from "@/design/tokens";
import { family } from "@/design/typography";

/**
 * OptionCardRow — icon badge (42 circle, accent@16 fill + accent@28 hairline) +
 * title(heading 15, medium) with optional pill badge + subtitle(body 12, fgMuted)
 * + chevron. Padding 16, glass card radius 18. Matches ios OptionCardRow.swift.
 */
export function OptionCardRow({
  icon,
  title,
  subtitle,
  badge,
  accent = colors.accent,
  onPress,
}: {
  icon: string;
  title: string;
  subtitle?: string;
  badge?: string;
  accent?: string;
  onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}>
      <GlassCard cornerRadius={18} style={styles.card}>
        <View style={[styles.badge, { borderColor: withAlpha(accent, 0.28), backgroundColor: withAlpha(accent, 0.16) }]}>
          <Icon name={icon} size={16} color={accent} />
        </View>
        <View style={styles.mid}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>{title}</Text>
            {badge ? (
              <View style={[styles.pill, { backgroundColor: withAlpha(accent, 0.15) }]}>
                <Text style={[styles.pillText, { color: accent }]}>{badge}</Text>
              </View>
            ) : null}
          </View>
          {subtitle ? (
            <Text style={styles.sub} numberOfLines={2}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <Icon name="chevron.right" size={13} color={colors.fgDim} />
      </GlassCard>
    </Pressable>
  );
}

/** Overlay an alpha onto a #RRGGBB hex. */
function withAlpha(hex: string, a: number): string {
  if (!hex.startsWith("#") || hex.length !== 7) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16 },
  badge: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  mid: { flex: 1, gap: 3 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontFamily: family.sans, fontSize: 15, fontWeight: "500", color: colors.fg },
  pill: { borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 },
  pillText: { fontFamily: family.mono, fontSize: 9, letterSpacing: 0.4 },
  sub: { fontFamily: family.sans, fontSize: 12, color: colors.fgMuted, lineHeight: 17 },
});
