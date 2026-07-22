import { useState } from "react";
import { Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import QRCode from "react-native-qrcode-svg";

import { useSession } from "@/auth/session";
import { Icon } from "@/design/Icon";
import { MicroLabel } from "@/design/components/text";
import { colors, spacing } from "@/design/tokens";
import { family } from "@/design/typography";
import { shortAddr } from "@/lib/format";

/** ReceiveView — QR + address to get paid. Exact from ios Receive/ReceiveView.swift. */
export default function ReceiveScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useSession();
  const [amount, setAmount] = useState("");
  const [copied, setCopied] = useState(false);

  const address = user?.suiAddress ?? "";
  const handle = user?.handle ?? null;
  const amt = amount.trim();

  const qrContent = amt
    ? handle
      ? `talise://pay/${handle}?amount=${amt}`
      : `sui:${address}?amount=${amt}`
    : `sui:${address}`;

  const copy = async () => {
    await Clipboard.setStringAsync(amt ? qrContent : address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  const share = () => Share.share({ message: qrContent });

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.md, padding: spacing.xl, gap: spacing.xl }}>
        <View style={styles.headerRow}>
          <View>
            <MicroLabel style={{ letterSpacing: 1.5, color: colors.fgDim }}>RECEIVE</MicroLabel>
            <Text style={styles.h1}>Get paid</Text>
          </View>
          <Pressable onPress={() => router.back()} style={styles.close} hitSlop={8}>
            <Icon name="xmark" size={16} color={colors.fg} />
          </Pressable>
        </View>

        <View style={{ gap: spacing.sm }}>
          <Text style={styles.optional}>Request a specific amount (optional)</Text>
          <View style={styles.amountField}>
            <Text style={styles.dollar}>$</Text>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              placeholder="0.00"
              placeholderTextColor={colors.fgDim}
              keyboardType="decimal-pad"
              style={styles.amountInput}
            />
            {amt ? (
              <Pressable onPress={() => setAmount("")} hitSlop={8}>
                <Icon name="xmark.circle.fill" size={18} color={colors.fgDim} />
              </Pressable>
            ) : null}
          </View>
        </View>

        <View style={styles.qrCard}>
          <Text style={styles.handle}>{handle ? handle : shortAddr(address)}</Text>
          {amt ? <Text style={styles.requesting}>Requesting ${amt}</Text> : null}
          <View style={styles.qrWrap}>
            {address ? <QRCode value={qrContent} size={220} ecl="M" /> : null}
          </View>
          <Text style={styles.addr}>{shortAddr(address)}</Text>
        </View>

        <View style={styles.actions}>
          <Pressable style={[styles.btn, styles.btnSecondary]} onPress={copy}>
            <Icon name={copied ? "checkmark" : "doc.on.doc"} size={16} color={colors.fg} />
            <Text style={styles.btnSecondaryText}>{copied ? "Copied" : amt ? "Copy link" : "Copy address"}</Text>
          </Pressable>
          <Pressable style={[styles.btn, styles.btnPrimary]} onPress={share}>
            <Icon name="square.and.arrow.up" size={16} color={colors.bg} />
            <Text style={styles.btnPrimaryText}>{amt ? "Share request" : "Share"}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  headerRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  h1: { fontFamily: family.sans, fontSize: 28, fontWeight: "500", color: colors.fg, letterSpacing: -1, marginTop: 4 },
  close: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" },
  optional: { fontFamily: family.sans, fontSize: 13, fontWeight: "300", color: colors.fgDim },
  amountField: {
    flexDirection: "row", alignItems: "center", gap: 6, height: 52, borderRadius: 16,
    backgroundColor: colors.surface2, paddingHorizontal: 16,
  },
  dollar: { fontFamily: family.sans, fontSize: 20, fontWeight: "500", color: colors.fg },
  amountInput: { flex: 1, fontFamily: family.sans, fontSize: 20, fontWeight: "500", color: colors.fg },
  qrCard: { backgroundColor: colors.surface, borderRadius: 28, padding: 28, alignItems: "center", gap: spacing.lg },
  handle: { fontFamily: family.sans, fontSize: 20, fontWeight: "500", color: colors.fg },
  requesting: { fontFamily: family.sans, fontSize: 14, color: colors.accent, marginTop: -8 },
  qrWrap: { backgroundColor: "#FFFFFF", padding: 16, borderRadius: 20 },
  addr: { fontFamily: family.mono, fontSize: 13, fontWeight: "300", color: colors.fgMuted },
  actions: { flexDirection: "row", gap: spacing.md },
  btn: { flex: 1, height: 52, borderRadius: 26, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  btnSecondary: { backgroundColor: colors.surface2 },
  btnSecondaryText: { fontFamily: family.sans, fontSize: 15, fontWeight: "500", color: colors.fg },
  btnPrimary: { backgroundColor: colors.fg },
  btnPrimaryText: { fontFamily: family.sans, fontSize: 15, fontWeight: "500", color: colors.bg },
});
