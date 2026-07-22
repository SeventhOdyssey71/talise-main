import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { payrollApi, type Team } from "@/api/payroll";
import { fmtUsd, moneyErrorCopy, shortAddr } from "@/api/money";
import { FlowHeader } from "@/components/wallet/FlowHeader";
import { FieldInput } from "@/components/wallet/FormField";
import { SlideToConfirm } from "@/design/components/SlideToConfirm";
import { SuccessfulTxView } from "@/components/wallet/SuccessfulTxView";
import { TaliseButton } from "@/design/components/TaliseButton";
import { Icon } from "@/design/Icon";
import { colors, radius, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

type Row = { recipient: string; label: string; amount: string };

/** PayTeamView — confirm what each person gets, then pay everyone in one gasless tx. */
export default function PayTeamScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [team, setTeam] = useState<Team | null>(null);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ count: number; totalUsd: number } | null>(null);

  useEffect(() => {
    payrollApi
      .teams()
      .then((teams) => {
        const found = teams.find((t) => t.id === id) ?? null;
        setTeam(found);
        if (found)
          setRows(
            found.members.map((m) => ({
              recipient: m.recipient,
              label: m.label ?? "",
              amount: m.amount != null ? String(m.amount) : "",
            })),
          );
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  const amounts = rows.map((r) => parseFloat(r.amount) || 0);
  const total = amounts.reduce((sum, a) => sum + a, 0);
  const allPositive = rows.length > 0 && amounts.every((a) => a > 0);

  const pay = async () => {
    if (!allPositive || !team) return;
    setErr(null);
    try {
      const res = await payrollApi.payTeam({
        recipients: rows.map((r) => ({ to: r.recipient, amount: parseFloat(r.amount) || 0, label: r.label.trim() || null })),
        teamName: team.name,
        teamId: team.id,
      });
      setDone({ count: res.count, totalUsd: res.totalUsd });
    } catch (e) {
      setErr(moneyErrorCopy(e, "Couldn't pay the team. Please try again."));
    }
  };

  const confirmDelete = () => {
    if (!team) return;
    Alert.alert(`Delete ${team.name}?`, "This removes the saved team. It won't affect any payments already sent.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete team",
        style: "destructive",
        onPress: async () => {
          try {
            await payrollApi.deleteTeam(team.id);
            router.back();
          } catch (e) {
            setErr(moneyErrorCopy(e, "Couldn't delete the team. Please try again."));
          }
        },
      },
    ]);
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
        title="Team paid"
        subtitle={`Paid ${done.count} · ${fmtUsd(done.totalUsd)}`}
        onDone={() => router.back()}
      />
    );

  if (!team)
    return (
      <View style={[styles.screen, styles.center]}>
        <Text style={styles.err}>Couldn&apos;t load this team.</Text>
      </View>
    );

  const update = (i: number, amount: string) => setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, amount } : r)));

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + spacing.md, padding: spacing.xl, gap: 22 }}
        keyboardShouldPersistTaps="handled"
      >
        <FlowHeader
          eyebrow="Pay team"
          title={team.name}
          onClose={() => router.back()}
          trailing={
            <TaliseButton
              title="Edit team"
              variant="secondary"
              size="sm"
              onPress={() => router.push({ pathname: "/team-edit", params: { id: team.id } })}
            />
          }
        />
        <Text style={styles.lede}>Confirm what each person gets, then pay everyone at once.</Text>

        <View style={{ gap: spacing.md }}>
          {rows.map((r, i) => (
            <View key={i} style={styles.memberCard}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.memberName} numberOfLines={1}>
                  {r.label.trim() || displayRecipient(r.recipient)}
                </Text>
                <Text style={styles.memberSub} numberOfLines={1}>
                  {displayRecipient(r.recipient)}
                </Text>
              </View>
              <View style={styles.amountRow}>
                <View style={styles.prefix}>
                  <Text style={styles.prefixText}>$</Text>
                </View>
                <FieldInput
                  value={r.amount}
                  onChangeText={(t) => update(i, t)}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  style={styles.amountInput}
                />
              </View>
            </View>
          ))}
        </View>

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>{fmtUsd(total)}</Text>
        </View>

        <View style={styles.gasless}>
          <View style={styles.gaslessIcon}>
            <Icon name="bolt.fill" size={15} color={colors.accent} />
          </View>
          <Text style={styles.gaslessText}>Paid in one transaction — no network fee, Talise sponsors the gas.</Text>
        </View>

        {!allPositive ? <Text style={styles.warn}>Enter a positive amount for everyone before paying.</Text> : null}
        {err ? <Text style={styles.err}>{err}</Text> : null}

        <TaliseButton
          title="Stream over time instead"
          variant="secondary"
          size="md"
          onPress={() => router.push({ pathname: "/team-stream", params: { id: team.id } })}
        />
        <TaliseButton title="Delete team" variant="danger" size="md" onPress={confirmDelete} />
      </ScrollView>
      <View style={[styles.slideWrap, { paddingBottom: insets.bottom + spacing.md, opacity: allPositive ? 1 : 0.5 }]}>
        <SlideToConfirm title={`Slide to pay ${fmtUsd(total)}`} onConfirm={allPositive ? pay : async () => {}} />
      </View>
    </View>
  );
}

function displayRecipient(recipient: string): string {
  const r = recipient.trim();
  if (r.startsWith("0x")) return shortAddr(r);
  return r;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: "center", justifyContent: "center" },
  lede: { fontFamily: family.sans, fontSize: 14, color: colors.fgMuted, lineHeight: 20 },
  memberCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    padding: spacing.lg,
  },
  memberName: { fontFamily: family.sans, fontSize: 15, fontWeight: "500", color: colors.fg },
  memberSub: { fontFamily: family.mono, fontSize: 11, fontWeight: "300", color: colors.fgDim },
  amountRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  prefix: {
    width: 30,
    height: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  prefixText: { fontFamily: family.sans, fontSize: 16, color: colors.fgMuted },
  amountInput: { width: 96, textAlign: "right" },
  totalRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  totalLabel: { fontFamily: family.mono, fontSize: 12, letterSpacing: 1.5, color: colors.fgMuted },
  totalValue: { fontFamily: family.sans, fontSize: 24, fontWeight: "500", color: colors.fg, letterSpacing: -0.5 },
  gasless: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    padding: spacing.lg,
  },
  gaslessIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(121,217,108,0.14)",
    alignItems: "center",
    justifyContent: "center",
  },
  gaslessText: { flex: 1, fontFamily: family.sans, fontSize: 13, color: colors.fgMuted, lineHeight: 19 },
  warn: { fontFamily: family.sans, fontSize: 13, color: colors.fgMuted, lineHeight: 19 },
  err: { fontFamily: family.sans, fontSize: 13, color: colors.danger, lineHeight: 19 },
  slideWrap: { paddingHorizontal: spacing.xl, paddingTop: spacing.md },
});
