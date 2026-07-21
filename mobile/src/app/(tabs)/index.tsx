import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { Screen } from "@/design/components/Screen";
import { colors, radius, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

/**
 * Home tab — port of iOS Home/HomeView.swift. Balance hero + primary actions +
 * recent activity. Data is placeholder until the session/API layer is wired
 * (GET /api/balances, GET /api/activity); the layout mirrors the iOS screen.
 */

const ACTIONS = [
  { key: "add", label: "Add money", icon: "add" as const },
  { key: "send", label: "Send", icon: "arrow-up" as const },
  { key: "scan", label: "Scan", icon: "scan" as const },
  { key: "cashout", label: "Cash out", icon: "cash-outline" as const },
];

const ACTIVITY = [
  { id: "1", dir: "received", who: "ada@talise", sub: "Received", amount: "+$120.00", ts: "2h ago" },
  { id: "2", dir: "sent", who: "0x9a…4cf8", sub: "Sent", amount: "-$18.40", ts: "5h ago" },
  { id: "3", dir: "swap", who: "USDC → USDsui", sub: "Swap", amount: "$50.00", ts: "Yesterday" },
  { id: "4", dir: "withdraw", who: "GTBank ••• 0231", sub: "Cash out", amount: "-$40.00", ts: "2d ago" },
];

export default function HomeScreen() {
  return (
    <Screen>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>WELCOME BACK</Text>
          <Text style={styles.name}>Sele</Text>
        </View>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>S</Text>
        </View>
      </View>

      {/* Balance hero */}
      <View style={styles.hero}>
        <Text style={styles.heroLabel}>TOTAL BALANCE</Text>
        <Text style={styles.heroAmount}>$1,248.60</Text>
        <View style={styles.heroPill}>
          <View style={styles.dot} />
          <Text style={styles.heroPillText}>USDsui · gasless</Text>
        </View>
      </View>

      {/* Primary actions */}
      <View style={styles.actions}>
        {ACTIONS.map((a) => (
          <Pressable key={a.key} style={styles.action} hitSlop={6}>
            <View style={styles.actionIcon}>
              <Ionicons name={a.icon} size={22} color={colors.greenMint} />
            </View>
            <Text style={styles.actionLabel}>{a.label}</Text>
          </Pressable>
        ))}
      </View>

      {/* Recent activity */}
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>Activity</Text>
        <Text style={styles.sectionLink}>See all</Text>
      </View>
      <View style={styles.card}>
        {ACTIVITY.map((t, i) => (
          <View key={t.id} style={[styles.row, i > 0 && styles.rowDivider]}>
            <View style={[styles.badge, badgeStyle(t.dir)]}>
              <Ionicons name={dirIcon(t.dir)} size={16} color={colors.fg} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowWho} numberOfLines={1}>{t.who}</Text>
              <Text style={styles.rowSub}>{t.sub} · {t.ts}</Text>
            </View>
            <Text style={[styles.rowAmount, t.amount.startsWith("+") && { color: colors.accent }]}>
              {t.amount}
            </Text>
          </View>
        ))}
      </View>
    </Screen>
  );
}

function dirIcon(dir: string): keyof typeof Ionicons.glyphMap {
  switch (dir) {
    case "received": return "arrow-down";
    case "sent": return "arrow-up";
    case "swap": return "swap-horizontal";
    case "withdraw": return "cash-outline";
    default: return "ellipse";
  }
}
function badgeStyle(dir: string) {
  switch (dir) {
    case "received": return { backgroundColor: colors.badgeReceived };
    case "sent":
    case "withdraw": return { backgroundColor: colors.badgeSent };
    default: return { backgroundColor: colors.badgeNeutral };
  }
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.lg,
  },
  eyebrow: {
    fontFamily: family.mono,
    fontSize: 11,
    letterSpacing: 1.6,
    color: colors.fgDim,
    marginBottom: 4,
  },
  name: {
    fontFamily: family.sans,
    fontSize: 22,
    fontWeight: "600",
    color: colors.fg,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface2,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  avatarText: { color: colors.fg, fontWeight: "700", fontFamily: family.sans },

  hero: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  heroLabel: {
    fontFamily: family.mono,
    fontSize: 11,
    letterSpacing: 1.6,
    color: colors.fgDim,
    marginBottom: spacing.sm,
  },
  heroAmount: {
    fontFamily: family.sans,
    fontSize: 44,
    fontWeight: "700",
    color: colors.fg,
    letterSpacing: -1,
  },
  heroPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: spacing.md,
    alignSelf: "flex-start",
    backgroundColor: colors.surface2,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.accent },
  heroPillText: { color: colors.fgMuted, fontSize: 12, fontFamily: family.sans, fontWeight: "500" },

  actions: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.xl,
  },
  action: { alignItems: "center", gap: 8, flex: 1 },
  actionIcon: {
    width: 54,
    height: 54,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
  },
  actionLabel: { color: colors.fgMuted, fontSize: 12, fontFamily: family.sans, fontWeight: "500" },

  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  sectionTitle: { color: colors.fg, fontSize: 18, fontWeight: "600", fontFamily: family.sans },
  sectionLink: { color: colors.accent, fontSize: 13, fontWeight: "600", fontFamily: family.sans },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    overflow: "hidden",
  },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.base },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  badge: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  rowWho: { color: colors.fg, fontSize: 15, fontWeight: "500", fontFamily: family.sans },
  rowSub: { color: colors.fgDim, fontSize: 12, marginTop: 2, fontFamily: family.sans },
  rowAmount: { color: colors.fg, fontSize: 15, fontWeight: "600", fontFamily: family.sans },
});
