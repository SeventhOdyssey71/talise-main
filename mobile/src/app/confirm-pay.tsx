import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { walletApi } from "@/api/wallet";
import { signAndSubmitSend } from "@/auth/zklogin";
import { SlideToConfirm } from "@/design/components/SlideToConfirm";
import { SuccessfulTxView } from "@/components/wallet/SuccessfulTxView";
import { MicroLabel } from "@/design/components/text";
import { colors, spacing } from "@/design/tokens";
import { family } from "@/design/typography";
import { local2, shortAddr } from "@/lib/format";

/**
 * ConfirmPaymentSheet — confirm a scanned/entered recipient + amount, then send
 * (signAndSubmitSend). Exact from ios ConfirmPaymentSheet.swift. Amount is in
 * USD (display currency); available comes from /api/balances.
 */
export default function ConfirmPayScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { address, name, amount: initialAmount } = useLocalSearchParams<{ address: string; name?: string; amount?: string }>();
  const [amount, setAmount] = useState(initialAmount ?? "");
  const [available, setAvailable] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    walletApi.balances().then((b) => setAvailable(b.usdsui)).catch(() => {});
  }, []);

  const amountNum = Number(amount) || 0;
  const insufficient = available != null && amountNum > available;
  const recipient = name || shortAddr(String(address));
  const monogram = (name || String(address).replace(/^0x/, "")).slice(0, 1).toUpperCase();

  const pay = async () => {
    if (amountNum <= 0 || insufficient) throw new Error("Enter a valid amount.");
    setError(null);
    await signAndSubmitSend(String(address), amountNum, "USDsui");
    setDone(true);
  };

  if (done) {
    return <SuccessfulTxView title="Sent" amountText={local2(amountNum)} subtitle={`to ${recipient}`} onDone={() => router.dismissAll?.() ?? router.back()} />;
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.lg }]}>
      <View style={styles.grab} />
      <Text style={styles.title}>Confirm Payment</Text>

      <View style={styles.recipientCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{monogram}</Text>
        </View>
        <View>
          <Text style={styles.recipient}>{recipient}</Text>
          <MicroLabel style={{ color: colors.fgDim, marginTop: 2 }}>Recipient</MicroLabel>
        </View>
      </View>

      <View style={styles.amountBlock}>
        <MicroLabel style={{ color: colors.fgMuted }}>Amount to pay</MicroLabel>
        <View style={styles.amountRow}>
          <Text style={styles.dollar}>$</Text>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            placeholder="0"
            placeholderTextColor={colors.fgDim}
            keyboardType="decimal-pad"
            autoFocus
            style={styles.amountInput}
          />
        </View>
        <Text style={styles.assetLine}>USDsui</Text>
        {available != null ? (
          <Text style={[styles.available, insufficient && { color: colors.danger }]}>
            {insufficient ? `Not enough — available ${local2(available)}` : `Available ${local2(available)}`}
          </Text>
        ) : null}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.footer}>
        <SlideToConfirm title="Slide to Pay" onConfirm={pay} />
        <Pressable onPress={() => router.back()} style={styles.cancel} hitSlop={8}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.xl },
  grab: { width: 40, height: 5, borderRadius: 3, backgroundColor: colors.surface2, alignSelf: "center", marginBottom: spacing.lg },
  title: { fontFamily: family.sans, fontSize: 20, fontWeight: "600", color: colors.fg, textAlign: "center" },
  recipientCard: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: spacing.xl },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(121,217,108,0.18)", alignItems: "center", justifyContent: "center" },
  avatarText: { fontFamily: family.sans, fontSize: 18, fontWeight: "600", color: colors.accent },
  recipient: { fontFamily: family.sans, fontSize: 16, fontWeight: "500", color: colors.fg },
  amountBlock: { alignItems: "center", marginTop: spacing.xxl, gap: 4 },
  amountRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  dollar: { fontFamily: family.sans, fontSize: 38, fontWeight: "500", color: colors.fgMuted },
  amountInput: { fontFamily: family.sans, fontSize: 48, fontWeight: "500", color: colors.fg, minWidth: 120, textAlign: "center" },
  assetLine: { fontFamily: family.sans, fontSize: 14, color: colors.fgMuted },
  available: { fontFamily: family.sans, fontSize: 13, color: colors.fgMuted, marginTop: spacing.sm },
  error: { fontFamily: family.sans, fontSize: 13, color: colors.danger, textAlign: "center", marginTop: spacing.md },
  footer: { flex: 1, justifyContent: "flex-end", paddingBottom: spacing.lg, gap: spacing.md },
  cancel: { alignSelf: "center", paddingVertical: spacing.sm },
  cancelText: { fontFamily: family.sans, fontSize: 15, color: colors.fgMuted, fontWeight: "500" },
});
