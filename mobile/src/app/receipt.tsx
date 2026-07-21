import { useEffect, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";

import { walletApi, type ActivityEntry } from "@/api/wallet";
import { Icon } from "@/design/Icon";
import { MicroLabel } from "@/design/components/text";
import { colors, spacing } from "@/design/tokens";
import { family } from "@/design/typography";
import { local2, shortAddr } from "@/lib/format";

/**
 * TxReceiptView — transaction receipt. Core detail is live (badge, amount,
 * digest, SuiVision); the shareable rendered-image receipt card is Phase 4 cont.
 */
export default function ReceiptScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { digest } = useLocalSearchParams<{ digest: string }>();
  const [entry, setEntry] = useState<ActivityEntry | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    walletApi.activity(50).then((rows) => setEntry(rows.find((r) => r.digest === digest) ?? null)).catch(() => {});
  }, [digest]);

  const inflow = entry?.direction === "received" || entry?.direction === "withdraw";
  const label =
    entry?.direction === "received" ? "Received" :
    entry?.direction === "invest" ? "Invested" :
    entry?.direction === "withdraw" ? "Withdrew" :
    entry?.offramp ? "Cash out" : "Sent";

  const copy = async () => {
    if (!digest) return;
    await Clipboard.setStringAsync(String(digest));
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.md, padding: spacing.xl, gap: 26 }}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }} />
          <Pressable onPress={() => router.back()} style={styles.close} hitSlop={8}>
            <Icon name="xmark" size={16} color={colors.fg} />
          </Pressable>
        </View>

        <View style={styles.center}>
          <View style={[styles.badge, { backgroundColor: inflow ? "rgba(121,217,108,0.15)" : "rgba(229,72,77,0.15)" }]}>
            <Icon name={inflow ? "arrow.down.left" : "arrow.up.right"} size={26} color={inflow ? "#CAFFB8" : "#FF6B6B"} />
          </View>
          <MicroLabel style={{ letterSpacing: 2, color: colors.fgMuted, marginTop: 12 }}>{label.toUpperCase()}</MicroLabel>
          <Text style={[styles.amount, { color: entry?.offramp ? "#E5484D" : colors.fg }]}>
            {entry ? `${inflow ? "+ " : "- "}${local2(Math.abs(entry.amountUsdsui ?? 0))}` : "—"}
          </Text>
          {entry ? <Text style={styles.usdsui}>{Math.abs(entry.amountUsdsui ?? 0).toFixed(2)} USDsui</Text> : null}
        </View>

        <View style={styles.detailsCard}>
          <Row label="Network" value="Sui Mainnet" />
          <View style={styles.sep} />
          <Row label="Digest" mono value={digest ? shortAddr(String(digest)) : "—"} />
        </View>

        <View style={{ gap: spacing.md }}>
          <Pressable style={[styles.btn, styles.btnSecondary]} onPress={() => digest && Linking.openURL(`https://suivision.xyz/txblock/${digest}`)}>
            <Icon name="arrow.up.right.square" size={16} color={colors.fg} />
            <Text style={styles.btnSecondaryText}>View on SuiVision</Text>
          </Pressable>
          <Pressable style={styles.copyRow} onPress={copy}>
            <Icon name={copied ? "checkmark" : "doc.on.doc"} size={15} color={colors.fgMuted} />
            <Text style={styles.copyText}>{copied ? "Copied" : "Copy digest"}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, mono && { fontFamily: family.mono, fontSize: 12 }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  headerRow: { flexDirection: "row" },
  close: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" },
  center: { alignItems: "center" },
  badge: { width: 68, height: 68, borderRadius: 34, alignItems: "center", justifyContent: "center" },
  amount: { fontFamily: family.sans, fontSize: 40, fontWeight: "500", color: colors.fg, letterSpacing: -1.4, marginTop: 12 },
  usdsui: { fontFamily: family.mono, fontSize: 12, fontWeight: "300", color: colors.fgMuted, marginTop: 2 },
  detailsCard: { backgroundColor: colors.surface, borderRadius: 22, padding: spacing.lg },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10 },
  rowLabel: { fontFamily: family.sans, fontSize: 13, fontWeight: "300", color: colors.fgMuted },
  rowValue: { fontFamily: family.sans, fontSize: 13, color: colors.fg },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line },
  btn: { height: 52, borderRadius: 26, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  btnSecondary: { backgroundColor: colors.surface2 },
  btnSecondaryText: { fontFamily: family.sans, fontSize: 15, fontWeight: "500", color: colors.fg },
  copyRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 8 },
  copyText: { fontFamily: family.sans, fontSize: 14, color: colors.fgMuted },
});
