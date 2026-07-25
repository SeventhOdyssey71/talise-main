import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { bankApi, type BankAccount } from "@/api/bank";
import { BankLogo } from "@/design/assets";
import { FlowHeader } from "@/components/wallet/FlowHeader";
import { TaliseButton } from "@/design/components/TaliseButton";
import { Icon } from "@/design/Icon";
import { colors, radius, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

/** BankAccountsView — linked NIBSS payout banks. */
export default function BankAccountsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setErr(null);
    bankApi
      .list()
      .then((a) => setAccounts(a))
      .catch(() => setErr("Couldn't load your bank accounts."))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const confirmRemove = (a: BankAccount) => {
    Alert.alert(
      "Remove this account?",
      `${a.bankName} ••••${a.last4} will be unlinked from your @handle.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => { bankApi.remove(a.id).then(load).catch(() => {}); },
        },
      ],
    );
  };

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.md, padding: spacing.xl, gap: 22 }}>
        <FlowHeader eyebrow="Linked bank accounts" title="Bank accounts" onClose={() => router.back()} />

        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.fgMuted} />
            <Text style={styles.loadingText}>Loading your accounts…</Text>
          </View>
        ) : err ? (
          <Text style={styles.err}>{err}</Text>
        ) : accounts.length === 0 ? (
          <View style={styles.empty}>
            <Icon name="building.columns" size={36} color={colors.fgDim} />
            <Text style={styles.emptyHeading}>No accounts linked yet</Text>
            <Text style={styles.emptyMessage}>Link a Nigerian bank account to your @handle so you can cash out faster.</Text>
          </View>
        ) : (
          <View style={{ gap: spacing.md }}>
            {accounts.map((a) => (
              <View key={a.id} style={styles.row}>
                <BankLogo code={a.bankCode} size={32} />
                <View style={{ flex: 1 }}>
                  <View style={styles.nameRow}>
                    <Text style={styles.accountName} numberOfLines={1}>{a.accountName}</Text>
                    {a.attested ? <Icon name="checkmark.seal.fill" size={14} color={colors.greenMint} /> : null}
                  </View>
                  <Text style={styles.sub}>{a.bankName} ••••{a.last4}</Text>
                </View>
                <Pressable style={styles.trash} onPress={() => confirmRemove(a)} hitSlop={8}>
                  <Icon name="trash" size={16} color={colors.danger} />
                </Pressable>
              </View>
            ))}
          </View>
        )}

        <TaliseButton title="Add bank account" variant="primary" size="lg" onPress={() => router.push("/bank-add")} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  loadingText: { fontFamily: family.sans, fontSize: 14, color: colors.fgMuted },
  err: { fontFamily: family.sans, fontSize: 13, color: colors.danger },
  empty: { alignItems: "center", gap: spacing.md, paddingVertical: spacing.xxl },
  emptyHeading: { fontFamily: family.sans, fontSize: 18, fontWeight: "500", color: colors.fg },
  emptyMessage: { fontFamily: family.sans, fontSize: 14, color: colors.fgMuted, textAlign: "center", lineHeight: 20 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    padding: spacing.lg,
  },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  accountName: { fontFamily: family.sans, fontSize: 15, fontWeight: "500", color: colors.fg, flexShrink: 1 },
  sub: { fontFamily: family.sans, fontSize: 13, color: colors.fgMuted, marginTop: 2 },
  trash: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" },
});
