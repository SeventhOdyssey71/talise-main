import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { payrollApi, TEAM_STREAM_INTERVALS, type Team } from "@/api/payroll";
import { fmtUsd, moneyErrorCopy } from "@/api/money";
import { FlowHeader } from "@/components/wallet/FlowHeader";
import { LabeledField, FieldInput } from "@/components/wallet/FormField";
import { SlideToConfirm } from "@/design/components/SlideToConfirm";
import { SuccessfulTxView } from "@/components/wallet/SuccessfulTxView";
import { Eyebrow } from "@/design/components/text";
import { Icon } from "@/design/Icon";
import { colors, radius, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

const peopleWord = (n: number) => (n === 1 ? "person" : "people");

/** TeamStreamSetupView — fund a pot once; everyone gets an equal share on a schedule. */
export default function TeamStreamScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [team, setTeam] = useState<Team | null>(null);
  const [loading, setLoading] = useState(true);
  const [amountRaw, setAmountRaw] = useState("");
  const [numTranches, setNumTranches] = useState(1);
  const [intervalIdx, setIntervalIdx] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    payrollApi
      .teams()
      .then((teams) => setTeam(teams.find((t) => t.id === id) ?? null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  const interval = TEAM_STREAM_INTERVALS[intervalIdx];
  const totalUsd = parseFloat(amountRaw) || 0;
  const memberCount = team?.members.length ?? 0;
  const perMemberPerPayout = memberCount > 0 && numTranches > 0 ? totalUsd / numTranches / memberCount : 0;
  const perMemberUsd = memberCount > 0 ? totalUsd / memberCount : 0;

  const validation =
    totalUsd <= 0
      ? "Enter an amount to stream."
      : memberCount === 0
      ? "This team has no one to pay yet."
      : perMemberPerPayout < 0.01
      ? "Each share is too small — add more or use fewer payouts (min $0.01 each)."
      : null;
  const valid = validation === null;

  const start = async () => {
    if (!valid || !team) return;
    setErr(null);
    try {
      await payrollApi.createStream({ teamId: team.id, totalUsd, numTranches, intervalMinutes: interval.minutes });
      setDone(true);
    } catch (e) {
      setErr(moneyErrorCopy(e, "Couldn't start the stream. Please try again."));
    }
  };

  if (loading)
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator color={colors.fgMuted} />
      </View>
    );

  if (done)
    return (
      <SuccessfulTxView
        title="Streaming started"
        subtitle={`${memberCount} ${peopleWord(memberCount)} will each receive ${fmtUsd(perMemberUsd)} per ${interval.unit}, ${numTranches} times.`}
        onDone={() => router.back()}
      />
    );

  if (!team)
    return (
      <View style={[styles.screen, styles.center]}>
        <Text style={styles.err}>Couldn&apos;t load this team.</Text>
      </View>
    );

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + spacing.md, padding: spacing.xl, gap: 22 }}
        keyboardShouldPersistTaps="handled"
      >
        <FlowHeader eyebrow="Stream to team" title={`Stream to ${team.name}`} onClose={() => router.back()} />
        <Text style={styles.lede}>
          Fund a pot once. Everyone gets an equal share on a schedule — automatically and gaslessly.
        </Text>

        <LabeledField label="Amount to stream">
          <FieldInput value={amountRaw} onChangeText={setAmountRaw} keyboardType="decimal-pad" placeholder="10.00" />
        </LabeledField>

        <View style={{ gap: spacing.md }}>
          <Eyebrow>Payouts</Eyebrow>
          <View style={styles.stepper}>
            <Pressable
              style={styles.stepBtn}
              onPress={() => setNumTranches((n) => Math.max(1, n - 1))}
              disabled={numTranches <= 1}
            >
              <Text style={[styles.stepSign, { color: numTranches <= 1 ? colors.fgDim : colors.fg }]}>−</Text>
            </Pressable>
            <Text style={styles.stepValue}>{numTranches}</Text>
            <Pressable style={styles.stepBtn} onPress={() => setNumTranches((n) => n + 1)}>
              <Text style={[styles.stepSign, { color: colors.fg }]}>+</Text>
            </Pressable>
          </View>
        </View>

        <View style={{ gap: spacing.md }}>
          <Eyebrow>How often</Eyebrow>
          <View style={styles.chips}>
            {TEAM_STREAM_INTERVALS.map((iv, i) => (
              <Chip key={iv.label} label={iv.label} on={i === intervalIdx} onPress={() => setIntervalIdx(i)} />
            ))}
          </View>
        </View>

        {validation ? (
          <Text style={styles.validation}>{validation}</Text>
        ) : (
          <View style={styles.preview}>
            <View style={styles.previewIcon}>
              <Icon name="bolt.fill" size={16} color={colors.accent} />
            </View>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={styles.previewLine1}>
                {memberCount} {peopleWord(memberCount)} each get {fmtUsd(perMemberPerPayout)} per {interval.unit}
              </Text>
              <Text style={styles.previewLine2}>
                {numTranches} payouts · {fmtUsd(totalUsd)} total
              </Text>
            </View>
          </View>
        )}

        {err ? <Text style={styles.err}>{err}</Text> : null}
      </ScrollView>
      <View style={[styles.slideWrap, { paddingBottom: insets.bottom + spacing.md, opacity: valid ? 1 : 0.5 }]}>
        <SlideToConfirm title="Slide to start streaming" onConfirm={valid ? start : async () => {}} />
      </View>
    </View>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Text
      onPress={onPress}
      style={[
        styles.chip,
        on
          ? { backgroundColor: "rgba(121,217,108,0.16)", borderColor: colors.accent, color: colors.accent }
          : { backgroundColor: colors.surface2, borderColor: colors.line, color: colors.fgMuted },
      ]}
    >
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: "center", justifyContent: "center" },
  lede: { fontFamily: family.sans, fontSize: 14, color: colors.fgMuted, lineHeight: 20 },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  stepBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  stepSign: { fontFamily: family.sans, fontSize: 20, fontWeight: "400", lineHeight: 22 },
  stepValue: { fontFamily: family.sans, fontSize: 18, fontWeight: "500", color: colors.fg, minWidth: 32, textAlign: "center" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    fontFamily: family.sans,
    fontSize: 13,
    fontWeight: "500",
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    overflow: "hidden",
  },
  validation: { fontFamily: family.sans, fontSize: 13, color: colors.fgMuted, lineHeight: 19 },
  preview: {
    flexDirection: "row",
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    padding: spacing.lg,
  },
  previewIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(121,217,108,0.14)",
    alignItems: "center",
    justifyContent: "center",
  },
  previewLine1: { fontFamily: family.sans, fontSize: 15, fontWeight: "500", color: colors.fg },
  previewLine2: { fontFamily: family.mono, fontSize: 12, color: colors.accent, lineHeight: 18 },
  err: { fontFamily: family.sans, fontSize: 13, color: colors.danger, lineHeight: 19 },
  slideWrap: { paddingHorizontal: spacing.xl, paddingTop: spacing.md },
});
