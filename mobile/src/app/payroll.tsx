import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { payrollApi, type Team } from "@/api/payroll";
import { fmtUsd } from "@/api/money";
import { FlowHeader } from "@/components/wallet/FlowHeader";
import { TaliseButton } from "@/design/components/TaliseButton";
import { Icon } from "@/design/Icon";
import { colors, radius, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

/** PayrollHubView — saved teams; tap to pay everyone in one gasless transaction. */
export default function PayrollScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);

  const load = useCallback(() => {
    setErr(false);
    setLoading(true);
    payrollApi
      .teams()
      .then((t) => setTeams(t))
      .catch(() => setErr(true))
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const teamTotal = (team: Team) => team.members.reduce((sum, m) => sum + (m.amount ?? 0), 0);

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.md, padding: spacing.xl, gap: 22 }}>
        <FlowHeader
          eyebrow="Payroll"
          title="Pay your team"
          onClose={() => router.back()}
          trailing={
            <TaliseButton title="New team" variant="secondary" size="sm" icon="plus" onPress={() => router.push("/team-edit")} />
          }
        />
        <Text style={styles.lede}>Save a team once, then pay everyone in one tap — one gasless transaction.</Text>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.fgMuted} />
          </View>
        ) : err ? (
          <View style={styles.errBlock}>
            <Text style={styles.errText}>Couldn&apos;t load your teams right now.</Text>
            <TaliseButton title="Try again" variant="secondary" size="md" onPress={load} />
          </View>
        ) : teams.length === 0 ? (
          <View style={styles.empty}>
            <Icon name="person.3" size={36} color={colors.fgDim} />
            <Text style={styles.emptyHeading}>No teams yet</Text>
            <Text style={styles.emptyMessage}>Create one to pay a group in one transaction.</Text>
          </View>
        ) : (
          <View style={{ gap: spacing.md }}>
            {teams.map((team) => {
              const total = teamTotal(team);
              const count = team.members.length;
              return (
                <Pressable
                  key={team.id}
                  style={styles.row}
                  onPress={() => router.push({ pathname: "/pay-team", params: { id: team.id } })}
                >
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={styles.rowName}>{team.name}</Text>
                    <Text style={styles.rowSub}>
                      {count} {count === 1 ? "person" : "people"}
                      {total > 0 ? ` · ${fmtUsd(total)}` : ""}
                    </Text>
                  </View>
                  <Pressable
                    hitSlop={10}
                    style={styles.editAffordance}
                    onPress={() => router.push({ pathname: "/team-edit", params: { id: team.id } })}
                  >
                    <Text style={styles.editText}>Edit</Text>
                  </Pressable>
                  <Icon name="chevron.right" size={14} color={colors.fgDim} />
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  lede: { fontFamily: family.sans, fontSize: 14, color: colors.fgMuted, lineHeight: 20 },
  center: { paddingVertical: spacing.xxxl, alignItems: "center", justifyContent: "center" },
  errBlock: { gap: spacing.md, paddingTop: spacing.lg },
  errText: { fontFamily: family.sans, fontSize: 14, color: colors.danger, lineHeight: 20 },
  empty: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xxxl },
  emptyHeading: { fontFamily: family.sans, fontSize: 19, fontWeight: "500", color: colors.fg, marginTop: spacing.sm },
  emptyMessage: { fontFamily: family.sans, fontSize: 14, color: colors.fgMuted, textAlign: "center", lineHeight: 20 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  rowName: { fontFamily: family.sans, fontSize: 16, fontWeight: "500", color: colors.fg },
  rowSub: { fontFamily: family.mono, fontSize: 12, fontWeight: "300", color: colors.fgMuted },
  editAffordance: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  editText: { fontFamily: family.mono, fontSize: 11, letterSpacing: 1, color: colors.accent },
});
