import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { rewardsApi, type SavingsGoal } from "@/api/rewards";
import { Img } from "@/design/assets";
import { TaliseButton } from "@/design/components/TaliseButton";
import { Eyebrow, SectionHeader } from "@/design/components/text";
import { Icon } from "@/design/Icon";
import { colors, spacing } from "@/design/tokens";
import { family } from "@/design/typography";
import { local2 } from "@/lib/format";

/** GoalActionSheet — deposit/withdraw/archive a goal (DB tracking; vault falls back). */
export default function GoalActionScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [goal, setGoal] = useState<SavingsGoal | null>(null);
  const [mode, setMode] = useState<"add" | "withdraw">("add");
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"add" | "withdraw" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    rewardsApi.goals().then((gs) => setGoal(gs.find((g) => g.id === id) ?? null)).catch(() => {});
  }, [id]);

  const amount = Number(raw) || 0;
  const progress = goal && goal.targetUsd > 0 ? Math.min(1, goal.currentUsd / goal.targetUsd) : 0;

  const submit = async () => {
    if (!goal) return;
    setBusy(true); setErr(null);
    try {
      if (mode === "add") await rewardsApi.depositGoal(goal.id, amount);
      else await rewardsApi.withdrawGoal(goal.id, amount);
      setDone(mode);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't complete that just now — please try again."); }
    finally { setBusy(false); }
  };

  if (done) {
    return (
      <View style={styles.success}>
        <Img name="GoalTarget" style={styles.target} />
        <Text style={styles.successTitle}>{done === "add" ? "Getting closer to your target" : "Back in your balance"}</Text>
        <Text style={styles.successSub}>{done === "add" ? `${local2(amount)} added to ${goal?.name}.` : `${local2(amount)} withdrawn from ${goal?.name}.`}</Text>
        <Pressable style={styles.successBtn} onPress={() => router.back()}><Text style={styles.successBtnText}>Back to Invest</Text></Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.header}>
        <View style={styles.disc} />
        <Text style={styles.headerTitle} numberOfLines={1}>{goal?.name ?? "Goal"}</Text>
        <Pressable style={styles.disc} onPress={() => router.back()} hitSlop={8}><Icon name="xmark" size={15} color={colors.fgMuted} /></Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }}>
        {goal ? (
          <View style={styles.summary}>
            <Eyebrow>Saved so far</Eyebrow>
            <Text style={styles.saved}>{local2(goal.currentUsd)}</Text>
            <Text style={styles.ofTarget}>of {local2(goal.targetUsd)} target</Text>
            <View style={styles.barTrack}><View style={[styles.barFill, { width: `${progress * 100}%` }]} /></View>
          </View>
        ) : null}

        <View style={styles.modePicker}>
          {(["add", "withdraw"] as const).map((m) => (
            <Pressable key={m} style={[styles.modeTab, mode === m && styles.modeTabOn]} onPress={() => setMode(m)}>
              <Text style={[styles.modeText, { color: mode === m ? colors.inkOnAccent : colors.fg }]}>{m === "add" ? "Add money" : "Withdraw"}</Text>
            </Pressable>
          ))}
        </View>

        <View>
          <SectionHeader>{mode === "add" ? "Add to goal" : "Withdraw from goal"}</SectionHeader>
          <View style={styles.field}>
            <Text style={styles.dollar}>$</Text>
            <TextInput value={raw} onChangeText={setRaw} placeholder="0.00" placeholderTextColor={colors.fgDim} keyboardType="decimal-pad" style={styles.fieldInput} />
          </View>
          <Text style={styles.note}>
            {mode === "add" ? "Tracking only — funds stay in your earning balance and keep earning points + yield." : "Moves tracked savings back to your spendable balance."}
          </Text>
        </View>

        {err ? <Text style={styles.err}>{err}</Text> : null}
      </ScrollView>
      <View style={[styles.actionBar, { paddingBottom: insets.bottom + spacing.md }]}>
        <TaliseButton
          title={busy ? (mode === "add" ? "Adding…" : "Withdrawing…") : mode === "add" ? "Add to goal" : "Withdraw"}
          variant="primary"
          size="lg"
          loading={busy}
          disabled={amount <= 0}
          onPress={submit}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, height: 40 },
  disc: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceGlass, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontFamily: family.sans, fontSize: 16, fontWeight: "500", color: colors.fg, flex: 1, textAlign: "center" },
  summary: { backgroundColor: colors.surface, borderRadius: 20, padding: spacing.lg, gap: 6 },
  saved: { fontFamily: family.sans, fontSize: 34, fontWeight: "500", color: colors.fg, letterSpacing: -1 },
  ofTarget: { fontFamily: family.sans, fontSize: 13, color: colors.fgMuted },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: colors.surface2, overflow: "hidden", marginTop: spacing.sm },
  barFill: { height: 6, borderRadius: 3, backgroundColor: colors.accent },
  modePicker: { flexDirection: "row", backgroundColor: colors.surface2, borderRadius: 14, padding: 4 },
  modeTab: { flex: 1, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  modeTabOn: { backgroundColor: colors.accent },
  modeText: { fontFamily: family.sans, fontSize: 14, fontWeight: "500" },
  field: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.surface2, borderRadius: 16, paddingHorizontal: 16, height: 56, marginTop: spacing.md },
  dollar: { fontFamily: family.sans, fontSize: 22, color: colors.fgMuted },
  fieldInput: { flex: 1, fontFamily: family.sans, fontSize: 22, fontWeight: "500", color: colors.fg },
  note: { fontFamily: family.sans, fontSize: 12.5, color: colors.fgDim, lineHeight: 18, marginTop: spacing.sm },
  err: { fontFamily: family.sans, fontSize: 13, color: colors.danger },
  actionBar: { paddingHorizontal: spacing.xl, paddingTop: spacing.md },
  success: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  target: { width: 220, height: 220, resizeMode: "contain" },
  successTitle: { fontFamily: family.sans, fontSize: 28, fontWeight: "400", color: colors.fg, textAlign: "center" },
  successSub: { fontFamily: family.sans, fontSize: 14, color: colors.fgMuted, textAlign: "center" },
  successBtn: { marginTop: spacing.lg, height: 44, paddingHorizontal: 32, borderRadius: 22, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  successBtnText: { fontFamily: family.sans, fontSize: 15, fontWeight: "500", color: "#000" },
});
