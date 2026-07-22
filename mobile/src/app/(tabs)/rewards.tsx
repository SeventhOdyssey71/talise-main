import { useEffect, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import * as Clipboard from "expo-clipboard";

import { historyTitle, rewardsApi, type RewardsSummary } from "@/api/rewards";
import { GlassButton } from "@/design/components/GlassButton";
import { SectionHeader } from "@/design/components/text";
import { Icon } from "@/design/Icon";
import { colors, radius, spacing } from "@/design/tokens";
import { family } from "@/design/typography";
import { local2 } from "@/lib/format";

/** RewardsView — the Rewards tab root. Points hero, campaign, stats, share, history. */
export default function RewardsScreen() {
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<RewardsSummary | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const load = () => rewardsApi.summary().then(setData).catch(() => {});
  useEffect(() => { load(); }, []);
  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const points = data?.pointsTotal ?? 0;
  const tier = data?.tier?.label ?? "Bronze";
  const events = data?.recentEvents ?? [];
  const shown = showAll ? events : events.slice(0, 5);
  const referralUrl = data?.code ? `https://www.talise.io/r/${data.code}` : null;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + spacing.lg, paddingHorizontal: 22, paddingBottom: 120, gap: spacing.lg }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.fgMuted} />}
      >
        {/* Hero */}
        <LinearGradient colors={["#3A6E2A", "#224417"]} style={styles.hero}>
          <View style={styles.heroTop}>
            <Text style={styles.heroLabel}>REWARD POINTS</Text>
            <View style={styles.tierChip}><Text style={styles.tierText}>{tier}</Text></View>
          </View>
          <View style={styles.heroPoints}>
            <Text style={styles.pointsNum}>{points.toLocaleString("en-US")}</Text>
            <Text style={styles.pointsUnit}>pts</Text>
          </View>
          {data?.tier?.pointsToNext != null ? (
            <View style={styles.tierProgress}>
              <View style={styles.tierBarTrack}>
                <View style={[styles.tierBarFill, { width: `${Math.min(100, (points / (points + (data.tier.pointsToNext || 1))) * 100)}%` }]} />
              </View>
              <Text style={styles.toNext}>{data.tier.pointsToNext} pts to {data.tier.nextLabel ?? "next tier"}</Text>
            </View>
          ) : (
            <Text style={styles.toNext}>Top tier — every point still counts toward perks</Text>
          )}
        </LinearGradient>

        {/* Campaign (locked) */}
        <View style={styles.campaign}>
          <View style={styles.campaignHead}>
            <Text style={styles.campaignEyebrow}>CAMPAIGN</Text>
            <View style={styles.lockPill}><Icon name="lock.fill" size={9} color={colors.greenMint} /><Text style={styles.lockText}>LOCKED</Text></View>
          </View>
          <Text style={styles.pool}>$5,000</Text>
          <Text style={styles.poolLabel}>reward pool</Text>
          <Text style={styles.campaignBody}>
            A community rewards campaign is coming. Join to lock your spot — the more you move and refer, the more you share when it opens.
          </Text>
          <Pressable style={styles.joinBtn} onPress={() => Alert.alert("", "This campaign opens soon — you'll be the first to know.")}>
            <Icon name="lock.fill" size={13} color={colors.inkOnAccent} />
            <Text style={styles.joinText}>Join · opens soon</Text>
          </Pressable>
        </View>

        {/* Stat tiles */}
        <View style={styles.tiles}>
          <StatTile icon="person.2" label="Referrals" value={String(data?.referralCount ?? 0)} />
          <StatTile icon="paperplane" label="Sent with Talise" value={local2(data?.lifetimeSentUsd ?? 0)} />
        </View>

        {/* Share */}
        {referralUrl ? (
          <View style={{ gap: spacing.md }}>
            <View style={styles.codeRow}>
              <Text style={styles.code}>{data?.code}</Text>
              <Pressable onPress={() => Clipboard.setStringAsync(referralUrl)} style={styles.copyPill}>
                <Icon name="doc.on.doc" size={12} color={colors.fg} />
                <Text style={styles.copyText}>Copy</Text>
              </Pressable>
            </View>
            <GlassButton title="Share Talise" icon="square.and.arrow.up" tint={colors.greenMint} onPress={() => Share.share({ message: `Join me on Talise: ${referralUrl}` })} />
          </View>
        ) : null}

        {/* Info strip */}
        <View style={styles.infoStrip}>
          <Icon name="sparkles" size={15} color={colors.greenMint} />
          <Text style={styles.infoText}>Invite friends — you earn points when they join and start moving money.</Text>
        </View>

        {/* History */}
        {events.length > 0 ? (
          <View style={{ gap: spacing.md }}>
            <SectionHeader>Earning history</SectionHeader>
            <View style={styles.historyCard}>
              {shown.map((e, i) => (
                <View key={e.id} style={[styles.histRow, i > 0 && styles.histDivider]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.histTitle}>{historyTitle(e.kind)}</Text>
                    <Text style={styles.histDate}>{new Date(e.createdAt).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}</Text>
                  </View>
                  <Text style={styles.histPoints}>+{e.points}</Text>
                </View>
              ))}
              {events.length > 5 ? (
                <Pressable style={styles.seeAll} onPress={() => setShowAll((s) => !s)}>
                  <Text style={styles.seeAllText}>{showAll ? "Show less" : "See all"}</Text>
                  <Icon name="chevron.down" size={11} color={colors.greenMint} />
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function StatTile({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={styles.tile}>
      <Icon name={icon} size={18} color={colors.greenMint} />
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  hero: { borderRadius: 26, padding: spacing.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.08)", gap: spacing.md },
  heroTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  heroLabel: { fontFamily: family.mono, fontSize: 11, color: "rgba(255,255,255,0.75)", letterSpacing: 0.5 },
  tierChip: { backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  tierText: { fontFamily: family.sans, fontSize: 12, fontWeight: "600", color: colors.greenMint },
  heroPoints: { flexDirection: "row", alignItems: "flex-end", gap: 6 },
  pointsNum: { fontFamily: family.sans, fontSize: 44, fontWeight: "600", color: "#FFFFFF", letterSpacing: -1 },
  pointsUnit: { fontFamily: family.sans, fontSize: 16, color: "rgba(255,255,255,0.65)", marginBottom: 8 },
  tierProgress: { gap: 6 },
  tierBarTrack: { height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.16)", overflow: "hidden" },
  tierBarFill: { height: 6, borderRadius: 3, backgroundColor: colors.greenMint },
  toNext: { fontFamily: family.sans, fontSize: 12, color: "rgba(255,255,255,0.75)" },

  campaign: { borderRadius: 24, backgroundColor: colors.surface, borderWidth: 1, borderColor: "rgba(202,255,184,0.22)", padding: spacing.lg, gap: 6 },
  campaignHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  campaignEyebrow: { fontFamily: family.mono, fontSize: 10, letterSpacing: 2, color: colors.greenMint },
  lockPill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(202,255,184,0.12)", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  lockText: { fontFamily: family.mono, fontSize: 9, color: colors.greenMint, letterSpacing: 1 },
  pool: { fontFamily: family.sans, fontSize: 46, fontWeight: "500", color: colors.fg, letterSpacing: -1.5, marginTop: 6 },
  poolLabel: { fontFamily: family.sans, fontSize: 13, color: colors.fgMuted },
  campaignBody: { fontFamily: family.sans, fontSize: 13, color: colors.fgMuted, lineHeight: 19, marginTop: spacing.sm },
  joinBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 46, borderRadius: 23, backgroundColor: colors.greenMint, marginTop: spacing.md },
  joinText: { fontFamily: family.sans, fontSize: 14, fontWeight: "600", color: colors.inkOnAccent },

  tiles: { flexDirection: "row", gap: spacing.md },
  tile: { flex: 1, backgroundColor: colors.surface, borderRadius: 22, padding: spacing.lg, gap: 8 },
  tileValue: { fontFamily: family.sans, fontSize: 22, fontWeight: "600", color: colors.fg, letterSpacing: -0.5 },
  tileLabel: { fontFamily: family.sans, fontSize: 12, color: colors.fgMuted },

  codeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.surface, borderRadius: 16, paddingLeft: 18, paddingRight: 8, height: 52 },
  code: { fontFamily: family.mono, fontSize: 15, color: colors.fg, letterSpacing: 1 },
  copyPill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.surface2, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  copyText: { fontFamily: family.sans, fontSize: 13, fontWeight: "500", color: colors.fg },
  infoStrip: { flexDirection: "row", alignItems: "center", gap: 10 },
  infoText: { fontFamily: family.sans, fontSize: 13, color: colors.fgMuted, flex: 1, lineHeight: 18 },

  historyCard: { backgroundColor: colors.surface, borderRadius: 20, overflow: "hidden" },
  histRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14 },
  histDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  histTitle: { fontFamily: family.sans, fontSize: 15, color: colors.fg },
  histDate: { fontFamily: family.mono, fontSize: 11, color: colors.fgDim, marginTop: 2 },
  histPoints: { fontFamily: family.sans, fontSize: 15, fontWeight: "600", color: colors.accent },
  seeAll: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  seeAllText: { fontFamily: family.sans, fontSize: 13, fontWeight: "500", color: colors.greenMint },
});
