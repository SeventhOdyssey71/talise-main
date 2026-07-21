import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HubCard } from "@/components/wallet/HubCard";
import { Icon } from "@/design/Icon";
import { colors, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

/**
 * Cheques hub — Write · Cash · My cheques. Mirrors the ios Cheques entry points
 * (each opens its own cover). Reached from the Move-money "Cheques" card.
 */
export default function ChequesHubScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.md, padding: spacing.xl, gap: spacing.lg }}>
        <View style={styles.header}>
          <Text style={styles.title}>Cheques</Text>
          <Pressable onPress={() => router.back()} style={styles.close} hitSlop={8}>
            <Icon name="xmark" size={16} color={colors.fg} />
          </Pressable>
        </View>
        <Text style={styles.lede}>Money in a link. Send it in any DM — they claim it as real money.</Text>

        <View style={{ gap: spacing.md }}>
          <HubCard icon="hi.write" title="Write a cheque" subtitle="Money in a link" onPress={() => router.push("/cheque-write")} />
          <HubCard icon="hi.qr" title="Cash a cheque" subtitle="Paste a link to cash it" onPress={() => router.push("/cheque-claim")} />
          <HubCard icon="hi.list" title="My cheques" subtitle="Track &amp; reclaim" onPress={() => router.push("/cheque-mine")} />
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
