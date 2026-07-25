import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { streamsApi, STREAM_DURATIONS, STREAM_INTERVALS, planTranches } from "@/api/streams";
import { fmtUsd, moneyErrorCopy, type ResolvedRecipient } from "@/api/money";
import { FlowHeader } from "@/components/wallet/FlowHeader";
import { LabeledField, FieldInput } from "@/components/wallet/FormField";
import { RecipientField } from "@/components/wallet/RecipientField";
import { SlideToConfirm } from "@/design/components/SlideToConfirm";
import { SuccessfulTxView } from "@/components/wallet/SuccessfulTxView";
import { Icon } from "@/design/Icon";
import { colors, radius, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

/** StreamSetupView — set up a money-over-time stream. Recipient → total → duration/interval → slide to start. */
export default function StreamNewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [recipientRaw, setRecipientRaw] = useState("");
  const [resolved, setResolved] = useState<ResolvedRecipient | null>(null);
  const [amountRaw, setAmountRaw] = useState("");
  const [durationIdx, setDurationIdx] = useState(1);
  const [intervalIdx, setIntervalIdx] = useState(2);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const duration = STREAM_DURATIONS[durationIdx];
  const interval = STREAM_INTERVALS[intervalIdx];
  const totalUsd = parseFloat(amountRaw) || 0;

  const plan = useMemo(
    () => planTranches(totalUsd, duration.minutes, interval.minutes),
    [totalUsd, duration.minutes, interval.minutes],
  );
  const { numTranches, trancheUsd, intervalMs } = plan;

  const validation = !resolved
    ? "Enter a recipient we can find before streaming."
    : totalUsd <= 0
    ? "Enter an amount to stream."
    : trancheUsd < 0.01
    ? `Each payment works out to ${fmtUsd(trancheUsd)} — below the $0.01 minimum. Raise the total or stream less often.`
    : numTranches > 5000
    ? `That's ${numTranches} payments — too many. Stream less often or over a shorter window.`
    : null;
  const valid = validation === null;

  const start = async () => {
    if (!valid || !resolved) return;
    setErr(null);
    try {
      await streamsApi.create({
        recipientAddress: resolved.address,
        recipientHandle: recipientRaw.trim() || undefined,
        totalUsd,
        intervalMs,
        numTranches,
      });
      setDone(true);
    } catch (e) {
      setErr(moneyErrorCopy(e, "Couldn't start the stream. Please try again."));
    }
  };

  if (done)
    return (
      <SuccessfulTxView
        title="Streaming started"
        subtitle={`${fmtUsd(totalUsd)} to ${resolved?.display ?? recipientRaw} · ${numTranches} payments`}
        onDone={() => router.back()}
      />
    );

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.md, padding: spacing.xl, gap: 22 }}>
        <FlowHeader eyebrow="Stream a payment" title="Money over time" onClose={() => router.back()} />
        <Text style={styles.lede}>Drip a salary, an allowance, a payout — no network fee, Talise sponsors the gas.</Text>

        <LabeledField label="To">
          <RecipientField value={recipientRaw} onChangeText={setRecipientRaw} onResolved={setResolved} />
        </LabeledField>

        <LabeledField label="Total (USDsui)">
          <FieldInput value={amountRaw} onChangeText={setAmountRaw} keyboardType="decimal-pad" placeholder="0.00" />
        </LabeledField>

        <View style={{ gap: 8 }}>
          <Text style={styles.eyebrow}>OVER</Text>
          <View style={styles.chips}>
            {STREAM_DURATIONS.map((d, i) => (
              <Chip key={d.label} label={d.label} on={i === durationIdx} onPress={() => setDurationIdx(i)} />
            ))}
          </View>
        </View>

        <View style={{ gap: 8 }}>
          <Text style={styles.eyebrow}>EVERY</Text>
          <View style={styles.chips}>
            {STREAM_INTERVALS.map((iv, i) => (
              <Chip key={iv.label} label={iv.label} on={i === intervalIdx} onPress={() => setIntervalIdx(i)} />
            ))}
          </View>
        </View>

        {validation ? (
          <Text style={styles.validation}>{validation}</Text>
        ) : (
          <View style={styles.preview}>
            <View style={styles.previewIcon}><Icon name="bolt.fill" size={16} color={colors.accent} /></View>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={styles.previewLine1}>{numTranches} payments of {fmtUsd(trancheUsd)}</Text>
              <Text style={styles.previewLine2}>one every {interval.label}, finishing in {duration.label}. First payment fires now.</Text>
              <Text style={styles.previewLine3}>{fmtUsd(totalUsd)} total — no network fee, Talise sponsors the gas.</Text>
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
  lede: { fontFamily: family.sans, fontSize: 14, color: colors.fgMuted, lineHeight: 20 },
  eyebrow: { fontFamily: family.mono, fontSize: 10, letterSpacing: 2.0, color: colors.fgDim },
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
  previewLine2: { fontFamily: family.sans, fontSize: 13, color: colors.fgMuted, lineHeight: 19 },
  previewLine3: { fontFamily: family.mono, fontSize: 12, color: colors.accent, lineHeight: 18 },
  err: { fontFamily: family.sans, fontSize: 13, color: colors.danger },
  slideWrap: { paddingHorizontal: spacing.xl, paddingTop: spacing.md },
});
