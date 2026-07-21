import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { walletApi, type ActivityEntry } from "@/api/wallet";
import { HistoryRow } from "@/components/wallet/HistoryRow";
import { Icon } from "@/design/Icon";
import { MicroLabel } from "@/design/components/text";
import { colors, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

/** HistoryView — all activity + filter chips. Exact from ios Home/HistoryView.swift. */
const FILTERS = ["All", "Sent", "Received", "Earn", "Swap"] as const;
type Filter = (typeof FILTERS)[number];

function matches(f: Filter, t: ActivityEntry): boolean {
  switch (f) {
    case "Sent": return t.direction === "sent";
    case "Received": return t.direction === "received";
    case "Earn": return t.direction === "invest" || t.direction === "withdraw";
    case "Swap": return t.direction === "swap" || t.direction === "autoswap";
    default: return true;
  }
}

export default function HistoryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("All");

  useEffect(() => {
    walletApi.activity(50).then(setEntries).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const rows = entries.filter((t) => matches(filter, t));

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.md, paddingHorizontal: spacing.xl, gap: 18, paddingBottom: 40 }}>
        <View style={styles.headerRow}>
          <View>
            <MicroLabel style={{ letterSpacing: 1.5, color: colors.fgDim }}>HISTORY</MicroLabel>
            <Text style={styles.h1}>All activity</Text>
          </View>
          <Pressable onPress={() => router.back()} style={styles.close} hitSlop={8}>
            <Icon name="xmark" size={16} color={colors.fg} />
          </Pressable>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {FILTERS.map((f) => {
            const on = f === filter;
            return (
              <Pressable
                key={f}
                onPress={() => setFilter(f)}
                style={[styles.chip, { backgroundColor: on ? colors.fg : colors.surface2 }]}
              >
                <Text style={[styles.chipText, { color: on ? colors.bg : colors.fg }]}>{f}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {rows.length === 0 ? (
          <View style={styles.empty}>
            <Icon name="tray" size={28} color={colors.fgDim} />
            <Text style={styles.emptyText}>{loading ? "Loading…" : `No ${filter === "All" ? "" : filter.toLowerCase() + " "}activity yet`}</Text>
          </View>
        ) : (
          <View style={styles.card}>
            {rows.map((t, i) => (
              <View key={t.digest}>
                {i > 0 ? <View style={styles.sep} /> : null}
                <HistoryRow entry={t} onPress={() => router.push(`/receipt?digest=${t.digest}`)} />
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  headerRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  h1: { fontFamily: family.sans, fontSize: 26, fontWeight: "500", color: colors.fg, letterSpacing: -0.8, marginTop: 4 },
  close: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" },
  chips: { flexDirection: "row", gap: 8, paddingRight: spacing.xl },
  chip: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999 },
  chipText: { fontFamily: family.sans, fontSize: 12, fontWeight: "500" },
  card: { backgroundColor: colors.surface, borderRadius: 22, overflow: "hidden", paddingVertical: 4 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginLeft: 64 },
  empty: { alignItems: "center", gap: spacing.md, paddingVertical: spacing.xxxl },
  emptyText: { fontFamily: family.sans, fontSize: 14, fontWeight: "300", color: colors.fgDim },
});
