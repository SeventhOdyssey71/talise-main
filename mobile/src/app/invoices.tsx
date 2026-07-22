import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { invoicesApi, type Invoice, type InvoiceStatus } from "@/api/invoices";
import { fmtUsd, moneyErrorCopy } from "@/api/money";
import { FlowHeader } from "@/components/wallet/FlowHeader";
import { TaliseButton } from "@/design/components/TaliseButton";
import { Icon } from "@/design/Icon";
import { colors, radius, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

/** InvoicesView — get paid in USDsui. List + share pay links. */
export default function InvoicesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    setErr(null);
    invoicesApi
      .list()
      .then(setInvoices)
      .catch((e) => { setInvoices([]); setErr(moneyErrorCopy(e, "Couldn't load the invoices right now.")); });
  };
  useEffect(() => { load(); }, []);

  const share = async (inv: Invoice) => {
    const payUrl = `https://www.talise.io/i/${inv.id}`;
    try { await Share.share({ message: payUrl }); } catch { /* dismissed */ }
  };

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.md, padding: spacing.xl, gap: 22 }}>
        <FlowHeader
          eyebrow="Invoices"
          title="Get paid"
          onClose={() => router.back()}
          trailing={<TaliseButton title="New invoice" variant="primary" size="sm" icon="plus" onPress={() => router.push("/invoice-new")} />}
        />
        <Text style={styles.lede}>Bill anyone in USDsui. Share a link, they pay, you&apos;re settled.</Text>

        {err ? <Text style={styles.err}>{err}</Text> : null}

        {invoices === null ? (
          <ActivityIndicator color={colors.fgMuted} style={{ marginTop: spacing.xl }} />
        ) : invoices.length === 0 ? (
          <View style={styles.empty}>
            <Icon name="doc.plaintext" size={36} color={colors.fgDim} />
            <Text style={styles.emptyHeading}>No invoices yet</Text>
            <Text style={styles.emptyMsg}>Create one to bill a client and get paid in USDsui.</Text>
          </View>
        ) : (
          <View style={{ gap: spacing.md }}>
            {invoices.map((inv) => (
              <InvoiceRow key={inv.id} inv={inv} onShare={() => share(inv)} />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function statusStyle(status: InvoiceStatus): { label: string; color: string } {
  if (status === "open") return { label: "Open", color: colors.accent };
  if (status === "paid") return { label: "Paid", color: colors.greenMint };
  return { label: status.charAt(0).toUpperCase() + status.slice(1), color: colors.fgDim };
}

function InvoiceRow({ inv, onShare }: { inv: Invoice; onShare: () => void }) {
  const s = statusStyle(inv.status);
  const date = new Date(inv.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return (
    <View style={styles.card}>
      <View style={styles.rowTop}>
        <Text style={styles.amount}>{fmtUsd(inv.amountUsd)}</Text>
        <View style={[styles.statusPill, { backgroundColor: withAlpha(s.color, 0.16) }]}>
          <Text style={[styles.statusText, { color: s.color }]}>{s.label.toUpperCase()}</Text>
        </View>
      </View>
      {inv.customerName ? <Text style={styles.meta}>To {inv.customerName}</Text> : null}
      {inv.memo ? <Text style={styles.memo}>{inv.memo}</Text> : null}
      <Text style={styles.date}>{date}</Text>
      {inv.status === "open" ? (
        <View style={{ marginTop: spacing.sm }}>
          <TaliseButton title="Share pay link" variant="secondary" size="sm" icon="square.and.arrow.up" onPress={onShare} />
        </View>
      ) : null}
    </View>
  );
}

function withAlpha(hex: string, a: number): string {
  if (!hex.startsWith("#") || hex.length !== 7) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  lede: { fontFamily: family.sans, fontSize: 14, color: colors.fgMuted, lineHeight: 20 },
  err: { fontFamily: family.sans, fontSize: 13, color: colors.danger },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, padding: spacing.lg, gap: 6 },
  rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  amount: { fontFamily: family.sans, fontSize: 22, fontWeight: "600", color: colors.fg, letterSpacing: -0.5 },
  statusPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { fontFamily: family.mono, fontSize: 10, letterSpacing: 1 },
  meta: { fontFamily: family.sans, fontSize: 14, color: colors.fgMuted },
  memo: { fontFamily: family.sans, fontSize: 13, color: colors.fgDim },
  date: { fontFamily: family.mono, fontSize: 11, color: colors.fgDim, marginTop: 2 },
  empty: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xxxl },
  emptyHeading: { fontFamily: family.sans, fontSize: 19, fontWeight: "500", color: colors.fg, marginTop: spacing.sm },
  emptyMsg: { fontFamily: family.sans, fontSize: 14, color: colors.fgMuted, textAlign: "center", lineHeight: 20 },
});
