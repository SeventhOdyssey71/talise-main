import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { contractsApi, CONTRACT_CADENCES } from "@/api/contracts";
import { fmtUsd, moneyErrorCopy, type ResolvedRecipient } from "@/api/money";
import { FlowHeader } from "@/components/wallet/FlowHeader";
import { LabeledField, FieldInput } from "@/components/wallet/FormField";
import { RecipientField } from "@/components/wallet/RecipientField";
import { SlideToConfirm } from "@/design/components/SlideToConfirm";
import { SuccessfulTxView } from "@/components/wallet/SuccessfulTxView";
import { Icon } from "@/design/Icon";
import { colors, radius, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

/** NewContractView — hire & pay over time. Funds a stream upfront, released one period at a time. */
export default function ContractNewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [payeeRaw, setPayeeRaw] = useState("");
  const [payee, setPayee] = useState<ResolvedRecipient | null>(null);
  const [title, setTitle] = useState("");
  const [rateRaw, setRateRaw] = useState("");
  const [cadenceIdx, setCadenceIdx] = useState(3);
  const [periodsRaw, setPeriodsRaw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const cadence = CONTRACT_CADENCES[cadenceIdx];
  const rateUsd = parseFloat(rateRaw) || 0;
  const periods = parseInt(periodsRaw, 10) || 0;
  const totalUsd = rateUsd * periods;

  const valid = !!payee && title.trim().length > 0 && rateUsd >= 0.01 && periods >= 1;
  const showPreview = rateUsd > 0 && periods > 0;

  const start = async () => {
    if (!valid || !payee) return;
    setErr(null);
    try {
      await contractsApi.create({
        payeeAddress: payee.address,
        payeeHandle: payeeRaw.trim() || undefined,
        title: title.trim(),
        rateUsd,
        cadence: cadence.cadence,
        periods,
        intervalMs: cadence.minutes * 60_000,
      });
      setDone(true);
    } catch (e) {
      setErr(moneyErrorCopy(e, "Couldn't start the contract. Please try again."));
    }
  };

  if (done)
    return (
      <SuccessfulTxView
        title="Contract started"
        subtitle={`${fmtUsd(totalUsd)} to ${payee?.display ?? payeeRaw} · ${periods} periods`}
        onDone={() => router.back()}
      />
    );

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.md, padding: spacing.xl, gap: 22 }}>
        <FlowHeader eyebrow="New contract" title="Set up recurring pay" onClose={() => router.back()} />

        <LabeledField label="Payee">
          <RecipientField value={payeeRaw} onChangeText={setPayeeRaw} onResolved={setPayee} placeholder="@handle or 0x address" />
        </LabeledField>

        <LabeledField label="Role / title">
          <FieldInput value={title} onChangeText={setTitle} placeholder="e.g. Designer — Q3 retainer" autoCapitalize="sentences" />
        </LabeledField>

        <LabeledField label="Rate (USDsui per period)">
          <FieldInput value={rateRaw} onChangeText={setRateRaw} keyboardType="decimal-pad" placeholder="0.00" />
        </LabeledField>

        <View style={{ gap: 8 }}>
          <Text style={styles.eyebrow}>PER</Text>
          <View style={styles.chips}>
            {CONTRACT_CADENCES.map((c, i) => (
              <Chip key={c.cadence} label={c.label} on={i === cadenceIdx} onPress={() => setCadenceIdx(i)} />
            ))}
          </View>
        </View>

        <LabeledField label="Number of periods">
          <FieldInput value={periodsRaw} onChangeText={setPeriodsRaw} keyboardType="number-pad" placeholder="4" />
        </LabeledField>

        {showPreview ? (
          <View style={styles.preview}>
            <View style={styles.previewIcon}><Icon name="bolt.fill" size={16} color={colors.accent} /></View>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={styles.previewLine1}>{periods} payments of {fmtUsd(rateUsd)}</Text>
              <Text style={styles.previewLine2}>{fmtUsd(totalUsd)} total, funded upfront and released one period at a time. No network fee — Talise sponsors the gas.</Text>
            </View>
          </View>
        ) : null}

        {err ? <Text style={styles.err}>{err}</Text> : null}
      </ScrollView>
      <View style={[styles.slideWrap, { paddingBottom: insets.bottom + spacing.md, opacity: valid ? 1 : 0.5 }]}>
        <SlideToConfirm title="Slide to fund & sign" onConfirm={valid ? start : async () => {}} />
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
  eyebrow: { fontFamily: family.mono, fontSize: 10, letterSpacing: 2.0, color: colors.fgDim },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    fontFamily: family.sans,
    fontSize: 13,
    fontWeight: "500",
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    overflow: "hidden",
  },
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
  err: { fontFamily: family.sans, fontSize: 13, color: colors.danger },
  slideWrap: { paddingHorizontal: spacing.xl, paddingTop: spacing.md },
});
