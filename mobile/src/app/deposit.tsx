import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HubCard } from "@/components/wallet/HubCard";
import { Eyebrow } from "@/design/components/text";
import { Icon } from "@/design/Icon";
import { colors, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

/** DepositFlowView — funding hub. Crypto is live (→ Receive); card/bank are soon. */
export default function DepositScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = (m: string) => Alert.alert("", m);

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.md, padding: spacing.xl, gap: spacing.xl }}>
        <View style={styles.header}>
          <Text style={styles.title}>Deposit</Text>
          <Pressable onPress={() => router.back()} style={styles.close} hitSlop={8}>
            <Icon name="xmark" size={16} color={colors.fg} />
          </Pressable>
        </View>
        <Text style={styles.lede}>Add money to your Talise wallet.</Text>

        <View style={{ gap: spacing.md }}>
          <Eyebrow>Deposit with</Eyebrow>
          <HubCard
            icon="hi.qr"
            title="Crypto"
            subtitle="Receive USDsui to your Talise QR or address"
            onPress={() => router.push("/receive")}
          />
          <HubCard
            icon="hi.card"
            title="Cash"
            subtitle="Buy USDsui with your bank card"
            soon
            onPress={() => toast("Card top-ups are coming soon.")}
          />
          <HubCard
            icon="hi.bank"
            title="Bank transfer"
            subtitle="From your bank in USD, EUR, GBP and more"
            soon
            onPress={() => toast("Bank transfers are coming soon.")}
          />
        </View>

        <View style={styles.footer}>
          <Icon name="lock.fill" size={12} color={colors.fgDim} />
          <Text style={styles.footerText}>Funds land as USDsui — pegged 1:1 to USD on Sui.</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontFamily: family.sans, fontSize: 26, fontWeight: "500", color: colors.fg, letterSpacing: -0.6 },
  close: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" },
  lede: { fontFamily: family.sans, fontSize: 14, fontWeight: "300", color: colors.fgMuted, marginTop: -spacing.md },
  footer: { flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "center" },
  footerText: { fontFamily: family.mono, fontSize: 10, fontWeight: "300", color: colors.fgDim },
});
