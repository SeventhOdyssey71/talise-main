import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { contractsApi, type Contract } from "@/api/contracts";
import { fmtUsd, moneyErrorCopy, shortAddr } from "@/api/money";
import { FlowHeader } from "@/components/wallet/FlowHeader";
import { Pill } from "@/design/components/Pill";
import { Icon } from "@/design/Icon";
import { colors, radius, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

/** ContractsView — hire & pay over time. List of contracts with drip progress + cancel. */
export default function ContractsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [contracts, setContracts] = useState<Contract[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      setContracts(await contractsApi.list());
    } catch (e) {
      setErr(moneyErrorCopy(e, "Couldn't load your contracts."));
      setContracts([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.md, padding: spacing.xl, gap: spacing.lg }}>
        <FlowHeader
          eyebrow="Contracts"
          title="Hire & pay over time"
          onClose={() => router.back()}
          trailing={<Pill title="New" icon="plus" tint={colors.accent} onPress={() => router.push("/contract-new")} />}
        />
        <Text style={styles.lede}>Set a rate and a number of periods. Payments drip automatically — no network fee.</Text>

        {err ? <Text style={styles.err}>{err}</Text> : null}

        {contracts === null ? (
          <View style={styles.loading}><ActivityIndicator color={colors.fgMuted} /></View>
        ) : contracts.length === 0 ? (
          <View style={styles.empty}>
            <Icon name="doc.text.below.ecg" size={36} color={colors.fgDim} />
            <Text style={styles.emptyHeading}>No contracts yet</Text>
            <Text style={styles.emptyMessage}>Create one to pay a contractor or employee on a schedule.</Text>
          </View>
        ) : (
          contracts.map((c) => <ContractRow key={c.id} contract={c} onReload={load} />)
        )}
      </ScrollView>
    </View>
  );
}

function ContractRow({ contract, onReload }: { contract: Contract; onReload: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const status = contract.status;
  const active = status === "active";

  const statusColor =
    active ? colors.accent : status === "completed" ? colors.greenMint : colors.fgDim;
  const statusLabel =
    active ? "Active" : status === "completed" ? "Completed" : status.charAt(0).toUpperCase() + status.slice(1);

  const total = contract.totalUsd ?? 0;
  const paid = contract.paidUsd ?? 0;
  const progress = total > 0 ? Math.min(1, paid / total) : 0;

  const payee = contract.payeeHandle || shortAddr(contract.payeeAddress);
  const cadenceLabel = contract.cadenceLabel || contract.cadence;

  const cancel = async () => {
    setBusy(true);
    try { await contractsApi.cancel(contract.id); await onReload(); } finally { setBusy(false); }
  };

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{contract.title}</Text>
          <Text style={styles.sub} numberOfLines={1}>{payee} · {fmtUsd(contract.rateUsd)} / {cadenceLabel}</Text>
        </View>
        <Text style={[styles.statusBadge, { color: statusColor }]}>{statusLabel}</Text>
      </View>

      <View style={styles.progressLine}>
        <Text style={styles.progressText}>{fmtUsd(paid)} of {fmtUsd(total)}</Text>
        <Text style={styles.progressText}>{contract.periodsPaid ?? 0}/{contract.periods} periods</Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${progress * 100}%` }]} />
      </View>

      {active ? (
        <Pressable onPress={busy ? undefined : cancel} disabled={busy} style={styles.actionRow}>
          <View style={styles.actionInner}>
            <Icon name="stop.circle" size={15} color={colors.fg} />
            <Text style={styles.actionLabel}>{busy ? "Cancelling…" : "Cancel & refund remainder"}</Text>
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  lede: { fontFamily: family.sans, fontSize: 14, color: colors.fgMuted, lineHeight: 20 },
  err: { fontFamily: family.sans, fontSize: 13, color: colors.danger },
  loading: { paddingVertical: spacing.xxxl, alignItems: "center" },
  empty: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xxxl },
  emptyHeading: { fontFamily: family.sans, fontSize: 19, fontWeight: "500", color: colors.fg, marginTop: spacing.sm },
  emptyMessage: { fontFamily: family.sans, fontSize: 14, color: colors.fgMuted, textAlign: "center" },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardHead: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  title: { fontFamily: family.sans, fontSize: 16, fontWeight: "500", color: colors.fg },
  sub: { fontFamily: family.mono, fontSize: 11, color: colors.fgMuted, marginTop: 4 },
  statusBadge: { fontFamily: family.mono, fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase" },

  progressLine: { flexDirection: "row", justifyContent: "space-between" },
  progressText: { fontFamily: family.mono, fontSize: 11, color: colors.fgMuted },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: colors.surface2, overflow: "hidden" },
  barFill: { height: 6, borderRadius: 3, backgroundColor: colors.accent },

  actionRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    paddingTop: spacing.md,
  },
  actionInner: { flexDirection: "row", alignItems: "center", gap: 8 },
  actionLabel: { fontFamily: family.sans, fontSize: 14, fontWeight: "500", color: colors.fg },
});
