import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { chequesApi, type MyCheque } from "@/api/cheques";
import { fmtUsd, moneyErrorCopy } from "@/api/money";
import { FlowHeader } from "@/components/wallet/FlowHeader";
import { TaliseButton } from "@/design/components/TaliseButton";
import { Icon } from "@/design/Icon";
import { colors, radius, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (s === "funded") return colors.accent;
  if (s === "claimed") return colors.fgMuted;
  return colors.fgDim;
}

/** ChequesMineView — cheques you've written, with reclaim. */
export default function ChequeMineScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [cheques, setCheques] = useState<MyCheque[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () => chequesApi.mine().then(setCheques).catch(() => setCheques([]));
  useEffect(() => { load(); }, []);

  const reclaim = async (id: string) => {
    setBusyId(id); setErr(null);
    try {
      await chequesApi.reclaim(id);
      await load();
    } catch (e) {
      setErr(moneyErrorCopy(e, "Couldn't reclaim this cheque. Please try again."));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.md, padding: spacing.xl, gap: 22 }}>
        <FlowHeader eyebrow="My cheques" title="Cheques you've written" onClose={() => router.back()} />
        <Text style={styles.lede}>Claim back anything that hasn't been cashed yet.</Text>

        {err ? <Text style={styles.err}>{err}</Text> : null}

        {cheques === null ? (
          <View style={styles.loading}><ActivityIndicator color={colors.fgMuted} /></View>
        ) : cheques.length === 0 ? (
          <View style={styles.empty}>
            <Icon name="doc.text" size={36} color={colors.fgDim} />
            <Text style={styles.emptyHeading}>No cheques yet</Text>
            <Text style={styles.emptyMsg}>Cheques you write will show up here so you can track and reclaim them.</Text>
          </View>
        ) : (
          <View style={{ gap: spacing.md }}>
            {cheques.map((c) => (
              <View key={c.id} style={styles.row}>
                <View style={styles.rowHead}>
                  <Text style={styles.amount}>{fmtUsd(c.amountUsd)}</Text>
                  <View style={[styles.pill, { borderColor: statusColor(c.status) }]}>
                    <Text style={[styles.pillText, { color: statusColor(c.status) }]}>{cap(c.status)}</Text>
                  </View>
                </View>
                {c.memo || c.payeeLabel ? (
                  <Text style={styles.rowSub} numberOfLines={1}>{c.memo ?? c.payeeLabel}</Text>
                ) : null}
                <Text style={styles.rowDate}>{new Date(c.createdAt).toLocaleDateString()}</Text>
                {c.reclaimable ? (
                  <View style={{ marginTop: spacing.sm }}>
                    <TaliseButton
                      title="Claim it back"
                      variant="secondary"
                      size="sm"
                      loading={busyId === c.id}
                      onPress={() => reclaim(c.id)}
                    />
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  lede: { fontFamily: family.sans, fontSize: 14, color: colors.fgMuted, lineHeight: 20 },
  err: { fontFamily: family.sans, fontSize: 13, color: colors.danger, lineHeight: 18 },
  loading: { paddingVertical: spacing.xxxl, alignItems: "center" },
  empty: { alignItems: "center", gap: spacing.md, paddingVertical: spacing.xxxl, paddingHorizontal: spacing.lg },
  emptyHeading: { fontFamily: family.sans, fontSize: 19, fontWeight: "500", color: colors.fg },
  emptyMsg: { fontFamily: family.sans, fontSize: 14, color: colors.fgMuted, textAlign: "center", lineHeight: 20 },
  row: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, padding: spacing.lg, gap: 6 },
  rowHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  amount: { fontFamily: family.sans, fontSize: 22, fontWeight: "500", color: colors.fg, letterSpacing: -0.5 },
  pill: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 3 },
  pillText: { fontFamily: family.mono, fontSize: 10, letterSpacing: 1, textTransform: "uppercase" },
  rowSub: { fontFamily: family.sans, fontSize: 14, color: colors.fgMuted },
  rowDate: { fontFamily: family.mono, fontSize: 11, fontWeight: "300", color: colors.fgDim },
});
