import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { requestsApi, requestPayUrl, type MoneyRequest, type RequestStatus } from "@/api/requests";
import { fmtUsd, moneyErrorCopy } from "@/api/money";
import { FlowHeader } from "@/components/wallet/FlowHeader";
import { SectionHeader } from "@/design/components/text";
import { Icon } from "@/design/Icon";
import { colors, radius, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

/** RequestsListView — mint a link to ask anyone for a set amount. */
export default function RequestsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [requests, setRequests] = useState<MoneyRequest[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    setErr(null);
    requestsApi
      .list()
      .then(setRequests)
      .catch((e) => { setRequests([]); setErr(moneyErrorCopy(e, "Couldn't load the requests right now.")); });
  };
  useEffect(() => { load(); }, []);

  const cancel = async (id: string) => {
    try { await requestsApi.cancel(id); load(); } catch (e) { setErr(moneyErrorCopy(e, "Couldn't cancel that request right now.")); }
  };

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.md, padding: spacing.xl, gap: 22 }}>
        <View>
          <SectionHeader style={{ marginBottom: 4 }}>Requests</SectionHeader>
          <FlowHeader
            title="Request money"
            onClose={() => router.back()}
            trailing={
              <Pressable style={styles.newBtn} onPress={() => router.push("/request-new")} hitSlop={8}>
                <Icon name="plus" size={16} color={colors.inkOnAccent} />
              </Pressable>
            }
          />
        </View>
        <Text style={styles.lede}>Mint a link to ask anyone for a set amount — share it, and they pay you straight to your wallet.</Text>

        {err ? <Text style={styles.err}>{err}</Text> : null}

        {requests === null ? (
          <ActivityIndicator color={colors.fgMuted} style={{ marginTop: spacing.xl }} />
        ) : requests.length === 0 ? (
          <View style={styles.empty}>
            <Icon name="qrcode" size={36} color={colors.fgDim} />
            <Text style={styles.emptyHeading}>No requests yet</Text>
            <Text style={styles.emptyMsg}>Create one to ask someone for a set amount.</Text>
          </View>
        ) : (
          <View style={{ gap: spacing.md }}>
            {requests.map((r) => (
              <RequestRow key={r.id} req={r} onShare={() => Share.share({ message: requestPayUrl(r.id) })} onCancel={() => cancel(r.id)} />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const CHIP: Record<string, { icon: string; color: string }> = {
  open: { icon: "link", color: colors.accent },
  paid: { icon: "checkmark.seal.fill", color: colors.greenMint },
  cancelled: { icon: "xmark.circle", color: colors.fgDim },
  expired: { icon: "clock.badge.xmark", color: colors.fgDim },
};

function chipFor(status: RequestStatus) {
  return CHIP[status] ?? { icon: "link", color: colors.fgDim };
}

function stripScheme(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

function RequestRow({ req, onShare, onCancel }: { req: MoneyRequest; onShare: () => void; onCancel: () => void }) {
  const c = chipFor(req.status);
  const secondary = req.requesterNote || stripScheme(requestPayUrl(req.id));
  return (
    <View style={styles.card}>
      <View style={styles.rowTop}>
        <View style={[styles.chip, { backgroundColor: withAlpha(c.color, 0.16) }]}>
          <Icon name={c.icon} size={20} color={c.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.amount}>{fmtUsd(req.amountUsd)}</Text>
          <Text style={styles.secondary} numberOfLines={1}>{secondary}</Text>
        </View>
        <Text style={[styles.status, { color: c.color }]}>{req.status.toUpperCase()}</Text>
      </View>
      {req.status === "open" ? (
        <View style={styles.actions}>
          <Pressable style={styles.actionBtn} onPress={onShare} hitSlop={6}>
            <Icon name="square.and.arrow.up" size={13} color={colors.fg} />
            <Text style={styles.actionText}>Share</Text>
          </Pressable>
          <Pressable onPress={onCancel} hitSlop={6}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
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
  newBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, padding: spacing.lg, gap: spacing.md },
  rowTop: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  chip: { width: 46, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  amount: { fontFamily: family.sans, fontSize: 18, fontWeight: "600", color: colors.fg },
  secondary: { fontFamily: family.sans, fontSize: 13, color: colors.fgDim, marginTop: 2 },
  status: { fontFamily: family.mono, fontSize: 10, letterSpacing: 1 },
  actions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  actionText: { fontFamily: family.sans, fontSize: 13, fontWeight: "500", color: colors.fg },
  cancelText: { fontFamily: family.sans, fontSize: 13, fontWeight: "500", color: colors.danger },
  empty: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xxxl },
  emptyHeading: { fontFamily: family.sans, fontSize: 19, fontWeight: "500", color: colors.fg, marginTop: spacing.sm },
  emptyMsg: { fontFamily: family.sans, fontSize: 14, color: colors.fgMuted, textAlign: "center", lineHeight: 20 },
});
