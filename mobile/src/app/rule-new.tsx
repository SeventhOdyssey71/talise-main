import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { rulesApi, RULE_CADENCES, type RuleCadenceKind } from "@/api/rules";
import { fmtUsd, moneyErrorCopy, type ResolvedRecipient } from "@/api/money";
import { FlowHeader } from "@/components/wallet/FlowHeader";
import { LabeledField, FieldInput } from "@/components/wallet/FormField";
import { RecipientField } from "@/components/wallet/RecipientField";
import { SlideToConfirm } from "@/design/components/SlideToConfirm";
import { Icon } from "@/design/Icon";
import { colors, radius, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

/** ordinal(n) — 1→"1st", 2→"2nd", 3→"3rd", else "{n}th", with 11/12/13 → "th". */
function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/** RuleEditView — create a rule. One signature funds the rule's own pot; payouts release gaslessly. */
export default function RuleNewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [name, setName] = useState("");
  const [recipientInput, setRecipientInput] = useState("");
  const [resolved, setResolved] = useState<ResolvedRecipient | null>(null);
  const [amountRaw, setAmountRaw] = useState("");
  const [cadenceIdx, setCadenceIdx] = useState(0);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [prefundPayments, setPrefundPayments] = useState(1);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const cadence = RULE_CADENCES[cadenceIdx];
  const kind: RuleCadenceKind = cadence.kind;
  const amountUsd = parseFloat(amountRaw) || 0;
  const totalPrefunded = amountUsd * prefundPayments;

  const recipientDisplay = resolved?.display ?? "";
  const cadenceLine = useMemo(() => {
    if (kind === "monthly") return `on the ${ordinal(dayOfMonth)} of each month`;
    if (kind === "weekly") return "every week";
    return "every day";
  }, [kind, dayOfMonth]);

  const previewText = `${fmtUsd(amountUsd)} to ${recipientDisplay || "someone"}, ${cadenceLine}.`;
  const amountTooSmall = amountUsd > 0 && amountUsd < 0.01;

  const canCreate = !!resolved && name.trim().length > 0 && amountUsd >= 0.01;

  const create = async () => {
    setErr(null);
    try {
      await rulesApi.create({
        name: name.trim(),
        toRecipient: resolved!.address,
        amountUsd,
        prefundUsd: amountUsd * prefundPayments,
        intervalMinutes: kind !== "monthly" ? cadence.intervalMinutes : undefined,
        dayOfMonth: kind === "monthly" ? dayOfMonth : undefined,
      });
      setDone(true);
    } catch (e) {
      setErr(moneyErrorCopy(e, "Couldn't create that rule."));
      throw e;
    }
  };

  if (done) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.successBody}>
          <View style={styles.successCircle}>
            <Icon name="checkmark" size={40} color={colors.accent} />
          </View>
          <Text style={styles.successHeading}>Rule created</Text>
          <Text style={styles.successSub}>
            {fmtUsd(amountUsd)} to {recipientDisplay} · {cadenceLine}
          </Text>
          <View style={styles.infoCard}>
            <Text style={styles.infoLabel}>POT LOADED</Text>
            <Text style={styles.infoValue}>
              {fmtUsd(totalPrefunded)} loaded — {prefundPayments} payment{prefundPayments === 1 ? "" : "(s)"}
            </Text>
            <Text style={styles.infoNote}>
              Payouts are pulled from this rule&apos;s own pot. You own it — the remaining balance is refunded if you cancel.
            </Text>
          </View>
        </View>
        <View style={{ paddingHorizontal: spacing.xl, paddingBottom: insets.bottom + spacing.md }}>
          <Pressable style={styles.doneBtn} onPress={() => router.back()}>
            <Text style={styles.doneBtnText}>Done</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: spacing.xl, paddingBottom: insets.bottom + spacing.xxl, gap: spacing.xl }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: spacing.md }}>
          <FlowHeader eyebrow="NEW RULE" title="Create a rule" onClose={() => router.back()} />
          <Text style={styles.subtitle}>
            Send a fixed amount to someone on a schedule. It runs by itself from its own pot until you pause or cancel it.
          </Text>
        </View>

        <LabeledField label="RULE NAME">
          <FieldInput value={name} onChangeText={setName} placeholder="e.g. Rent" />
        </LabeledField>

        <LabeledField label="PAY TO">
          <RecipientField
            value={recipientInput}
            onChangeText={setRecipientInput}
            onResolved={setResolved}
            placeholder="@handle, name.talise.sui or 0x…"
          />
        </LabeledField>

        <LabeledField label="AMOUNT EACH TIME">
          <FieldInput value={amountRaw} onChangeText={setAmountRaw} keyboardType="decimal-pad" placeholder="10.00" />
        </LabeledField>

        <LabeledField label="HOW OFTEN">
          <View style={styles.chipRow}>
            {RULE_CADENCES.map((c, i) => {
              const on = i === cadenceIdx;
              return (
                <Pressable
                  key={c.label}
                  onPress={() => setCadenceIdx(i)}
                  style={[styles.cadenceChip, { backgroundColor: on ? "rgba(121,217,108,0.16)" : colors.surface2, borderColor: on ? colors.accent : colors.line }]}
                >
                  <Text style={[styles.cadenceChipText, { color: on ? colors.accent : colors.fgMuted }]}>{c.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </LabeledField>

        {kind === "monthly" ? (
          <LabeledField label="DAY OF MONTH">
            <Stepper value={dayOfMonth} min={1} max={28} onChange={setDayOfMonth} display={String(dayOfMonth)} />
          </LabeledField>
        ) : null}

        <LabeledField
          label="LOAD THE POT"
          hint={`Funds the rule's pot — ${prefundPayments} ${prefundPayments === 1 ? "payment" : "payments"} of ${fmtUsd(amountUsd)} (${fmtUsd(totalPrefunded)} total).`}
        >
          <Stepper
            value={prefundPayments}
            min={1}
            max={60}
            onChange={setPrefundPayments}
            display={`${prefundPayments} ${prefundPayments === 1 ? "payment" : "payments"}`}
          />
        </LabeledField>

        <View style={{ gap: spacing.sm }}>
          <Text style={styles.previewLabel}>PREVIEW</Text>
          <View style={styles.previewCard}>
            <Text style={styles.previewText}>{previewText}</Text>
            {amountTooSmall ? <Text style={styles.previewDanger}>The amount must be at least $0.01.</Text> : null}
          </View>
        </View>

        {err ? <Text style={styles.err}>{err}</Text> : null}

        <View style={{ opacity: canCreate ? 1 : 0.5 }} pointerEvents={canCreate ? "auto" : "none"}>
          <SlideToConfirm title="Slide to create rule" tint={colors.accent} onConfirm={create} />
        </View>
        <Text style={styles.sliderHelper}>
          One signature funds the rule&apos;s own pot. Payouts release automatically — gaslessly, no signing each time — and the remaining balance is refunded if you cancel.
        </Text>
      </ScrollView>
    </View>
  );
}

function Stepper({ value, min, max, onChange, display }: {
  value: number; min: number; max: number; onChange: (n: number) => void; display: string;
}) {
  return (
    <View style={styles.stepper}>
      <Pressable
        style={[styles.stepBtn, { opacity: value <= min ? 0.35 : 1 }]}
        disabled={value <= min}
        onPress={() => onChange(Math.max(min, value - 1))}
        hitSlop={8}
      >
        <Text style={styles.stepSign}>−</Text>
      </Pressable>
      <Text style={styles.stepValue}>{display}</Text>
      <Pressable
        style={[styles.stepBtn, { opacity: value >= max ? 0.35 : 1 }]}
        disabled={value >= max}
        onPress={() => onChange(Math.min(max, value + 1))}
        hitSlop={8}
      >
        <Text style={styles.stepSign}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  subtitle: { fontFamily: family.sans, fontSize: 14, fontWeight: "300", color: colors.fgMuted, lineHeight: 20 },

  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  cadenceChip: { paddingHorizontal: spacing.lg, paddingVertical: 10, borderRadius: radius.md, borderWidth: 1 },
  cadenceChipText: { fontFamily: family.sans, fontSize: 13, fontWeight: "500" },

  stepper: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  stepBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" },
  stepSign: { fontFamily: family.sans, fontSize: 22, fontWeight: "500", color: colors.fg, lineHeight: 24 },
  stepValue: { fontFamily: family.sans, fontSize: 16, fontWeight: "500", color: colors.fg },

  previewLabel: { fontFamily: family.mono, fontSize: 10, letterSpacing: 2.0, color: colors.fgDim },
  previewCard: {
    backgroundColor: colors.surfaceGlass, borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, padding: spacing.lg, gap: spacing.sm,
  },
  previewText: { fontFamily: family.sans, fontSize: 15, color: colors.fg, lineHeight: 22 },
  previewDanger: { fontFamily: family.sans, fontSize: 13, color: colors.danger },

  err: { fontFamily: family.sans, fontSize: 13, color: colors.danger },
  sliderHelper: { fontFamily: family.mono, fontSize: 11, fontWeight: "300", color: colors.fgDim, lineHeight: 17 },

  successBody: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl, gap: spacing.md },
  successCircle: { width: 92, height: 92, borderRadius: 46, backgroundColor: "rgba(121,217,108,0.16)", alignItems: "center", justifyContent: "center" },
  successHeading: { fontFamily: family.sans, fontSize: 26, fontWeight: "500", color: colors.fg, letterSpacing: -0.6, marginTop: spacing.sm, textAlign: "center" },
  successSub: { fontFamily: family.sans, fontSize: 14, color: colors.fgMuted, textAlign: "center", lineHeight: 20 },
  infoCard: {
    alignSelf: "stretch", backgroundColor: colors.surfaceGlass, borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, padding: spacing.lg, gap: spacing.sm, marginTop: spacing.md,
  },
  infoLabel: { fontFamily: family.mono, fontSize: 10, letterSpacing: 2.0, color: colors.fgDim },
  infoValue: { fontFamily: family.sans, fontSize: 15, fontWeight: "500", color: colors.fg },
  infoNote: { fontFamily: family.sans, fontSize: 12.5, fontWeight: "300", color: colors.fgMuted, lineHeight: 18 },
  doneBtn: { height: 52, borderRadius: radius.md, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  doneBtnText: { fontFamily: family.sans, fontSize: 16, fontWeight: "600", color: colors.bg },
});
