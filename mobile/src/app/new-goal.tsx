import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { rewardsApi } from "@/api/rewards";
import { TaliseButton } from "@/design/components/TaliseButton";
import { MicroLabel } from "@/design/components/text";
import { Icon } from "@/design/Icon";
import { colors, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

/** NewGoalScreen — create a savings goal (tracking-only DB goal). */
export default function NewGoalScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const targetUsd = Number(target) || 0;
  const valid = name.trim().length > 0 && targetUsd > 0;

  const create = async () => {
    setBusy(true); setErr(null);
    try {
      await rewardsApi.createGoal(name.trim(), targetUsd);
      router.back();
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't create that goal."); setBusy(false); }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.header}>
        <Pressable style={styles.disc} onPress={() => router.back()} hitSlop={8}><Icon name="xmark" size={15} color={colors.fgMuted} /></Pressable>
        <MicroLabel style={{ letterSpacing: 2, color: colors.fgMuted }}>New goal</MicroLabel>
        <View style={styles.disc} />
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}><Icon name="flag.fill" size={26} color={colors.accent} /></View>
          <Text style={styles.title}>Name a savings bucket</Text>
          <Text style={styles.sub}>Set a target and watch it fill up.</Text>
        </View>
        <View style={styles.fields}>
          <TextInput value={name} onChangeText={setName} placeholder="Goal name (e.g. Laptop fund)" placeholderTextColor={colors.fgDim} style={styles.input} />
          <View style={styles.divider} />
          <TextInput value={target} onChangeText={setTarget} placeholder="Target amount (USD)" placeholderTextColor={colors.fgDim} keyboardType="decimal-pad" style={styles.input} />
        </View>
        <Text style={styles.note}>Tracking only — your money stays in your earning balance and keeps earning yield + points toward the target.</Text>
        {err ? <Text style={styles.err}>{err}</Text> : null}
      </ScrollView>
      <View style={[styles.actionBar, { paddingBottom: insets.bottom + spacing.md }]}>
        <TaliseButton title={busy ? "Creating…" : "Create goal"} variant="primary" size="lg" loading={busy} disabled={!valid} onPress={create} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, height: 40 },
  disc: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceGlass, alignItems: "center", justifyContent: "center" },
  hero: { alignItems: "center", gap: spacing.sm },
  heroIcon: { width: 68, height: 68, borderRadius: 34, backgroundColor: "rgba(121,217,108,0.14)", alignItems: "center", justifyContent: "center" },
  title: { fontFamily: family.sans, fontSize: 22, fontWeight: "500", color: colors.fg, marginTop: spacing.sm },
  sub: { fontFamily: family.sans, fontSize: 14, color: colors.fgMuted },
  fields: { backgroundColor: colors.surface, borderRadius: 22, paddingHorizontal: spacing.lg },
  input: { fontFamily: family.sans, fontSize: 16, color: colors.fg, height: 56 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line },
  note: { fontFamily: family.sans, fontSize: 12.5, color: colors.fgDim, lineHeight: 18 },
  err: { fontFamily: family.sans, fontSize: 13, color: colors.danger },
  actionBar: { paddingHorizontal: spacing.xl, paddingTop: spacing.md },
});
