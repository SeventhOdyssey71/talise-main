import { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Slider from "@react-native-community/slider";

import { earnApi, type YieldComparison } from "@/api/earn";
import { rewardsApi, type RewardsSummary, type SavingsGoal } from "@/api/rewards";
import { Divider } from "@/design/components/Divider";
import { SectionHeader } from "@/design/components/text";
import { Icon } from "@/design/Icon";
import { colors, radius, spacing } from "@/design/tokens";
import { family } from "@/design/typography";
import { local2 } from "@/lib/format";

/** EarnView — the Invest tab root. Earn venue + Perps rows, Round-up, Goals. */
export default function FinanceScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [comparison, setComparison] = useState<YieldComparison | null>(null);
  const [summary, setSummary] = useState<RewardsSummary | null>(null);
  const [goals, setGoals] = useState<SavingsGoal[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    await Promise.allSettled([
      earnApi.comparison().then(setComparison),
      rewardsApi.summary().then(setSummary),
      rewardsApi.goals().then((g) => setGoals(g.filter((x) => !x.archived))),
    ]);
  }, []);
  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load])); // refresh after goal/earn actions
  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const best = comparison?.best ?? comparison?.venues?.[0] ?? null;
  const supplied = best?.supplied ?? 0;
  const apy = best?.apy ?? 0;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + spacing.lg, paddingHorizontal: 22, paddingBottom: 120, gap: 28 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.fgMuted} />}
      >
        <View style={{ gap: spacing.md }}>
          <SectionHeader>Where your money earns</SectionHeader>
          <View style={styles.venueCard}>
            <Pressable style={styles.venueRow} onPress={() => router.push(`/earn-manage?apy=${apy}&supplied=${supplied}&venue=${best?.venue ?? "navi"}`)}>
              <View style={[styles.venueIcon, { backgroundColor: supplied > 0 ? "rgba(121,217,108,0.18)" : colors.surface2 }]}>
                <Icon name="leaf.fill" size={17} color={supplied > 0 ? colors.accent : colors.fg} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.venueTitle}>Earn</Text>
                <Text style={styles.venueSub}>{supplied > 0 ? `Supplied ${local2(supplied)}` : "Tap to add money"}</Text>
              </View>
              <View style={styles.bestPill}><Text style={styles.bestText}>BEST</Text></View>
              <Text style={styles.apy}>{apy >= 0.0001 ? `${apy.toFixed(2)}%` : "—"}</Text>
              <Icon name="chevron.right" size={13} color={colors.fgDim} />
            </Pressable>
            <Divider inset={16} />
            <Pressable style={styles.venueRow} onPress={() => router.push("/perps")}>
              <View style={[styles.venueIcon, { backgroundColor: "rgba(121,217,108,0.18)" }]}>
                <Icon name="arrow.up.arrow.down" size={17} color={colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.venueTitle}>Perps</Text>
                <Text style={styles.venueSub}>Trade with leverage · gasless</Text>
              </View>
              <View style={styles.newPill}><Text style={styles.newText}>NEW</Text></View>
              <Icon name="chevron.right" size={13} color={colors.fgDim} />
            </Pressable>
          </View>
        </View>

        <RoundupCard summary={summary} onChange={load} />

        <GoalsSection goals={goals} onNew={() => router.push("/new-goal")} onOpen={(g) => router.push(`/goal-action?id=${g.id}`)} />
      </ScrollView>
    </View>
  );
}

/* ─── Round-up ───────────────────────────────────────────── */
function RoundupCard({ summary, onChange }: { summary: RewardsSummary | null; onChange: () => void }) {
  const [enabled, setEnabled] = useState(false);
  const [pct, setPct] = useState(5);
  const savedUsd = summary?.roundupSavedUsd ?? 0;

  useEffect(() => {
    if (summary?.roundup) { setEnabled(summary.roundup.enabled); setPct(summary.roundup.percentage); }
  }, [summary]);

  const toggle = async (on: boolean) => {
    setEnabled(on);
    try { await rewardsApi.roundup({ enabled: on }); onChange(); } catch { setEnabled(!on); }
  };
  const commitPct = async (v: number) => {
    try { await rewardsApi.roundup({ percentage: Math.round(v) }); onChange(); } catch { /* ignore */ }
  };

  return (
    <View style={[styles.roundup, { opacity: enabled ? 1 : 0.92 }]}>
      <View style={styles.roundupHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.roundupEyebrow}>ROUND-UP &amp; SAVE</Text>
          <Text style={styles.roundupSub}>Auto-save {pct}% of every send and earn on the saved balance</Text>
        </View>
        <Switch value={enabled} onValueChange={toggle} trackColor={{ true: colors.accent, false: colors.surface2 }} thumbColor="#fff" />
      </View>
      {enabled ? (
        <>
          <Divider inset={0} />
          <View style={styles.sliderBlock}>
            <View style={styles.sliderHead}>
              <Text style={styles.roundupEyebrow}>SAVE PERCENTAGE</Text>
              <Text style={styles.pct}>{pct}%</Text>
            </View>
            <Slider minimumValue={1} maximumValue={10} step={1} value={pct} onValueChange={setPct} onSlidingComplete={commitPct} minimumTrackTintColor={colors.accent} maximumTrackTintColor={colors.surface2} thumbTintColor={colors.accent} />
          </View>
          <View style={styles.savedLine}>
            <View>
              <Text style={styles.roundupEyebrow}>SAVED VIA ROUND-UP</Text>
              <Text style={styles.savedValue}>{local2(savedUsd)}</Text>
            </View>
            <Icon name="leaf.fill" size={16} color={colors.accent} />
          </View>
        </>
      ) : (
        <Text style={styles.roundupFoot}>Funds stay in your wallet and earn 5 pts per $1 saved.</Text>
      )}
    </View>
  );
}

/* ─── Goals ──────────────────────────────────────────────── */
function GoalsSection({ goals, onNew, onOpen }: { goals: SavingsGoal[]; onNew: () => void; onOpen: (g: SavingsGoal) => void }) {
  return (
    <View style={{ gap: spacing.md }}>
      <SectionHeader>Savings goals</SectionHeader>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md, paddingRight: 22 }}>
        {goals.map((g) => {
          const progress = g.targetUsd > 0 ? Math.min(1, g.currentUsd / g.targetUsd) : 0;
          return (
            <Pressable key={g.id} style={styles.goalCard} onPress={() => onOpen(g)}>
              <View style={styles.goalTop}>
                <Text style={styles.goalName} numberOfLines={1}>{g.name}</Text>
                <Text style={styles.goalPct}>{Math.round(progress * 100)}%</Text>
              </View>
              <View style={styles.goalBarTrack}><View style={[styles.goalBarFill, { width: `${progress * 100}%` }]} /></View>
              <Text style={styles.goalValue}>{local2(g.currentUsd)}</Text>
              <Text style={styles.goalTarget}>of {local2(g.targetUsd)}</Text>
            </Pressable>
          );
        })}
        <Pressable style={styles.newGoal} onPress={onNew}>
          <View style={styles.newGoalPlus}><Icon name="plus" size={18} color={colors.fg} /></View>
          <Text style={styles.goalName}>New goal</Text>
          <Text style={styles.goalTarget}>Name a bucket</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  venueCard: { backgroundColor: colors.surface, borderRadius: 20, overflow: "hidden", paddingHorizontal: 18, paddingVertical: 4 },
  venueRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 16 },
  venueIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  venueTitle: { fontFamily: family.sans, fontSize: 16, fontWeight: "500", color: colors.fg },
  venueSub: { fontFamily: family.sans, fontSize: 12.5, color: colors.fgMuted, marginTop: 2 },
  bestPill: { backgroundColor: "rgba(121,217,108,0.15)", borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3 },
  bestText: { fontFamily: family.mono, fontSize: 9, color: colors.accent, letterSpacing: 0.5 },
  apy: { fontFamily: family.sans, fontSize: 22, fontWeight: "500", color: colors.accent },
  newPill: { backgroundColor: "rgba(121,217,108,0.15)", borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3 },
  newText: { fontFamily: family.mono, fontSize: 9, color: colors.accent, letterSpacing: 0.5 },

  roundup: { backgroundColor: colors.surface, borderRadius: 20, padding: spacing.lg, gap: spacing.md },
  roundupHead: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  roundupEyebrow: { fontFamily: family.mono, fontSize: 10, letterSpacing: 2, color: colors.fgMuted },
  roundupSub: { fontFamily: family.sans, fontSize: 12.5, color: colors.fgMuted, marginTop: 4 },
  roundupFoot: { fontFamily: family.sans, fontSize: 12.5, color: colors.fgDim },
  sliderBlock: { gap: 4 },
  sliderHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  pct: { fontFamily: family.sans, fontSize: 22, fontWeight: "600", color: colors.fg },
  savedLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  savedValue: { fontFamily: family.sans, fontSize: 20, fontWeight: "600", color: colors.accent, marginTop: 4 },

  goalCard: { width: 168, height: 148, backgroundColor: colors.surface, borderRadius: 20, padding: spacing.lg, justifyContent: "space-between" },
  goalTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  goalName: { fontFamily: family.sans, fontSize: 15, fontWeight: "500", color: colors.fg, flex: 1 },
  goalPct: { fontFamily: family.sans, fontSize: 13, fontWeight: "600", color: colors.accent },
  goalBarTrack: { height: 5, borderRadius: 3, backgroundColor: colors.surface2, overflow: "hidden" },
  goalBarFill: { height: 5, borderRadius: 3, backgroundColor: colors.accent },
  goalValue: { fontFamily: family.sans, fontSize: 18, fontWeight: "600", color: colors.fg },
  goalTarget: { fontFamily: family.sans, fontSize: 12, color: colors.fgMuted },
  newGoal: { width: 168, height: 148, borderRadius: 20, borderWidth: 1, borderStyle: "dashed", borderColor: "rgba(121,217,108,0.35)", padding: spacing.lg, justifyContent: "center", gap: 8 },
  newGoalPlus: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" },
});
