import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { payrollApi, type Team, type TeamMember } from "@/api/payroll";
import { moneyErrorCopy, type ResolvedRecipient } from "@/api/money";
import { FlowHeader } from "@/components/wallet/FlowHeader";
import { LabeledField, FieldInput } from "@/components/wallet/FormField";
import { RecipientField } from "@/components/wallet/RecipientField";
import { TaliseButton } from "@/design/components/TaliseButton";
import { Eyebrow } from "@/design/components/text";
import { Icon } from "@/design/Icon";
import { colors, radius, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

type Draft = { recipient: string; amount: string; label: string };

const emptyDraft = (): Draft => ({ recipient: "", amount: "", label: "" });

/** TeamEditView — create or edit a saved team. Add people, set/confirm amounts later. */
export default function TeamEditScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string }>();

  const [team, setTeam] = useState<Team | null>(null);
  const [loading, setLoading] = useState(!!id);
  const [name, setName] = useState("");
  const [members, setMembers] = useState<Draft[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    payrollApi
      .teams()
      .then((teams) => {
        const found = teams.find((t) => t.id === id) ?? null;
        setTeam(found);
        if (found) {
          setName(found.name);
          setMembers(
            found.members.map((m) => ({
              recipient: m.recipient,
              amount: m.amount != null ? String(m.amount) : "",
              label: m.label ?? "",
            })),
          );
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  const update = (i: number, patch: Partial<Draft>) =>
    setMembers((prev) => prev.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  const remove = (i: number) => setMembers((prev) => prev.filter((_, idx) => idx !== i));
  const add = () => setMembers((prev) => [...prev, emptyDraft()]);

  const validMembers = members.filter((m) => m.recipient.trim().length > 0);
  const canSave = name.trim().length > 0 && validMembers.length >= 1 && !saving;

  const save = async () => {
    if (!canSave) return;
    setErr(null);
    setSaving(true);
    try {
      const payload: TeamMember[] = validMembers.map((m) => {
        const amt = parseFloat(m.amount);
        return {
          recipient: m.recipient.trim(),
          amount: Number.isFinite(amt) && amt > 0 ? amt : null,
          label: m.label.trim() || null,
        };
      });
      await payrollApi.saveTeam({ name: name.trim(), members: payload, chainObjectId: team?.chainObjectId });
      router.back();
    } catch (e) {
      setErr(moneyErrorCopy(e, "Couldn't save the team. Please try again."));
    } finally {
      setSaving(false);
    }
  };

  if (loading)
    return (
      <View style={[styles.screen, styles.loadingCenter]}>
        <ActivityIndicator color={colors.fgMuted} />
      </View>
    );

  const editing = !!id && !!team;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + spacing.md, padding: spacing.xl, gap: 22 }}
        keyboardShouldPersistTaps="handled"
      >
        <FlowHeader
          eyebrow={editing ? "Edit team" : "New team"}
          title={editing ? team.name : "Create a team"}
          onClose={() => router.back()}
        />
        <Text style={styles.lede}>Add the people you pay together. You&apos;ll set or confirm amounts when you pay.</Text>

        <LabeledField label="Team name">
          <FieldInput value={name} onChangeText={setName} placeholder="e.g. Design team" autoCapitalize="words" />
        </LabeledField>

        <View style={{ gap: spacing.md }}>
          <Eyebrow>People</Eyebrow>
          {members.length === 0 ? (
            <Text style={styles.emptyPeople}>No one added yet — tap Add person to start.</Text>
          ) : (
            members.map((m, i) => (
              <MemberRow
                key={i}
                draft={m}
                onRecipient={(recipient) => update(i, { recipient })}
                onAmount={(amount) => update(i, { amount })}
                onLabel={(label) => update(i, { label })}
                onRemove={() => remove(i)}
              />
            ))
          )}
          <TaliseButton title="Add person" variant="secondary" size="md" icon="plus" onPress={add} />
        </View>

        {err ? <Text style={styles.err}>{err}</Text> : null}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <TaliseButton
          title={saving ? "Saving…" : "Save team"}
          variant="primary"
          size="lg"
          loading={saving}
          disabled={!canSave}
          onPress={save}
        />
      </View>
    </View>
  );
}

function MemberRow({
  draft,
  onRecipient,
  onAmount,
  onLabel,
  onRemove,
}: {
  draft: Draft;
  onRecipient: (t: string) => void;
  onAmount: (t: string) => void;
  onLabel: (t: string) => void;
  onRemove: () => void;
}) {
  // Resolution is advisory here; the recipient string is what we persist.
  const [, setResolved] = useState<ResolvedRecipient | null>(null);
  return (
    <View style={styles.memberCard}>
      <View style={styles.memberHead}>
        <View style={{ flex: 1 }}>
          <RecipientField
            value={draft.recipient}
            onChangeText={onRecipient}
            onResolved={setResolved}
            placeholder="@handle, name.talise.sui or 0x…"
          />
        </View>
        <Pressable hitSlop={10} style={styles.removeBtn} onPress={onRemove}>
          <Icon name="xmark" size={13} color={colors.fgMuted} />
        </Pressable>
      </View>
      <View style={styles.amountRow}>
        <View style={styles.prefix}>
          <Text style={styles.prefixText}>$</Text>
        </View>
        <FieldInput
          value={draft.amount}
          onChangeText={onAmount}
          keyboardType="decimal-pad"
          placeholder="Amount"
          style={{ flex: 1 }}
        />
      </View>
      <FieldInput value={draft.label} onChangeText={onLabel} placeholder="Label (optional)" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  loadingCenter: { alignItems: "center", justifyContent: "center" },
  lede: { fontFamily: family.sans, fontSize: 14, color: colors.fgMuted, lineHeight: 20 },
  emptyPeople: { fontFamily: family.sans, fontSize: 13, color: colors.fgMuted, lineHeight: 19 },
  memberCard: {
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    padding: spacing.lg,
  },
  memberHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  removeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  amountRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  prefix: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  prefixText: { fontFamily: family.sans, fontSize: 16, color: colors.fgMuted },
  err: { fontFamily: family.sans, fontSize: 13, color: colors.danger, lineHeight: 19 },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
});
