import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "@/design/Icon";
import { colors, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

/**
 * ScanToPayView — camera QR + bank-OCR scanning. The full camera/OCR flow
 * (expo-camera viewfinder, recipient resolve, ConfirmPaymentSheet/ScanBankPayout)
 * is built in the Phase 4 continuation. This is the entry shell.
 */
export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <View style={styles.screen}>
      <Pressable onPress={() => router.back()} style={[styles.close, { top: insets.top + spacing.md }]} hitSlop={8}>
        <Icon name="xmark" size={16} color={colors.fg} />
      </Pressable>
      <View style={styles.center}>
        <Icon name="qrcode.viewfinder" size={64} color={colors.greenMint} />
        <Text style={styles.title}>Point &amp; pay</Text>
        <Text style={styles.sub}>The camera scan-to-pay flow (QR + bank OCR) lands in the Phase 4 continuation.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000000" },
  close: { position: "absolute", left: spacing.lg, width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center", zIndex: 2 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg, paddingHorizontal: spacing.xl },
  title: { fontFamily: family.sans, fontSize: 20, fontWeight: "600", color: colors.fg },
  sub: { fontFamily: family.sans, fontSize: 13, color: "rgba(255,255,255,0.65)", textAlign: "center", lineHeight: 19 },
});
