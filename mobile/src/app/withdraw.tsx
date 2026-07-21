import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HubCard } from "@/components/wallet/HubCard";
import { Icon } from "@/design/Icon";
import { colors, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

/**
 * WithdrawFlowView — the "Move money" hub. Rows + copy are exact; the
 * destinations (Send=Phase 5, Cheques/Work=Phase 7, Payroll=Phase 8) open as
 * those phases land. Cash out is FEATURE_CASHOUT-gated.
 */
export default function WithdrawScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const soon = (label: string) => Alert.alert("", `${label} lands in a later phase.`);

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.md, padding: spacing.xl, gap: spacing.lg }}>
        <View style={styles.header}>
          <Text style={styles.title}>Move money</Text>
          <Pressable onPress={() => router.back()} style={styles.close} hitSlop={8}>
            <Icon name="xmark" size={16} color={colors.fg} />
          </Pressable>
        </View>

        <Text style={styles.section}>SEND</Text>
        <View style={{ gap: spacing.md }}>
          <HubCard icon="hi.send" title="Send" subtitle="@handle or address" onPress={() => router.push("/send")} />
          <HubCard icon="hi.globe" title="Send abroad" subtitle="To their bank, in their currency" onPress={() => router.push("/send-abroad")} />
          <HubCard icon="hi.bank" title="Cash out" subtitle="To your bank" onPress={() => soon("Cash out")} />
        </View>

        <Text style={styles.section}>MORE</Text>
        <View style={{ gap: spacing.md }}>
          <HubCard icon="hi.cheque" title="Cheques" subtitle="Write · Cash · My cheques" onPress={() => router.push("/cheques")} />
          <HubCard icon="hi.briefcase" title="Work" subtitle="Streams · Invoices · Contracts" onPress={() => router.push("/work")} />
          <HubCard icon="hi.cash" title="Payroll" subtitle="Pay a team in one tap" onPress={() => soon("Payroll")} />
          <HubCard icon="hi.stream" title="Rules" subtitle="Money that runs itself" onPress={() => router.push("/rules")} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  title: { fontFamily: family.sans, fontSize: 26, fontWeight: "500", color: colors.fg, letterSpacing: -0.6 },
  close: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" },
  section: { fontFamily: family.mono, fontSize: 10, letterSpacing: 2, color: colors.fgDim, marginTop: spacing.sm },
});
