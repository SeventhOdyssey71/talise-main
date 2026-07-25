import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HubCard } from "@/components/wallet/HubCard";
import { Icon } from "@/design/Icon";
import { colors, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

/**
 * Work hub — Streams · Invoices · Contracts · Requests. Mirrors the ios Work
 * navigation stack. Reached from the Move-money "Work" card.
 */
export default function WorkHubScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.md, padding: spacing.xl, gap: spacing.lg }}>
        <View style={styles.header}>
          <Text style={styles.title}>Work</Text>
          <Pressable onPress={() => router.back()} style={styles.close} hitSlop={8}>
            <Icon name="xmark" size={16} color={colors.fg} />
          </Pressable>
        </View>
        <Text style={styles.lede}>Get paid and pay people — bill clients, stream salaries, hire on a schedule.</Text>

        <View style={{ gap: spacing.md }}>
          <HubCard icon="hi.stream" title="Streams" subtitle="Money over time" onPress={() => router.push("/streams")} />
          <HubCard icon="hi.invoice" title="Invoices" subtitle="Bill anyone, get paid" onPress={() => router.push("/invoices")} />
          <HubCard icon="hi.contract" title="Contracts" subtitle="Hire &amp; pay over time" onPress={() => router.push("/contracts")} />
          <HubCard icon="hi.qr" title="Request money" subtitle="Ask for a set amount" onPress={() => router.push("/requests")} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.xs },
  title: { fontFamily: family.sans, fontSize: 26, fontWeight: "500", color: colors.fg, letterSpacing: -0.6 },
  close: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" },
  lede: { fontFamily: family.sans, fontSize: 14, color: colors.fgMuted, lineHeight: 20 },
});
