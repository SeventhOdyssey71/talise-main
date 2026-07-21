import { useEffect, useState } from "react";
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { humanAmount, walletApi, type WalletCoinBalance } from "@/api/wallet";
import { Icon } from "@/design/Icon";
import { MicroLabel } from "@/design/components/text";
import { colors, spacing } from "@/design/tokens";
import { family } from "@/design/typography";
import { usd2 } from "@/lib/format";

/**
 * TokenBucketView — non-USDsui coins with a swap-to-USDsui action. Live coin
 * data; the sweep/swap execution (POST /api/wallet/sweep → sponsorExecute) is
 * wired in the Phase 4 continuation.
 */
export default function TokenBucketScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [coins, setCoins] = useState<WalletCoinBalance[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    walletApi.coinBalances().then((c) => setCoins(c.filter((x) => !x.isUsdsui))).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const total = coins.reduce((s, c) => s + (c.usdValue ?? 0), 0);

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable onPress={() => router.back()} style={styles.close} hitSlop={8}>
          <Icon name="xmark" size={15} color={colors.fgMuted} />
        </Pressable>
        <View style={styles.headerTitle}>
          <Icon name="circle.hexagongrid.fill" size={12} color={colors.greenMint} />
          <MicroLabel style={{ letterSpacing: 2 }}>Token bucket</MicroLabel>
        </View>
        <View style={{ width: 38 }} />
      </View>

      {coins.length === 0 ? (
        <View style={styles.empty}>
          <Icon name="circle.hexagongrid" size={40} color={colors.fgDim} />
          <Text style={styles.emptyTitle}>{loading ? "Loading…" : "No other tokens yet"}</Text>
          <Text style={styles.emptySub}>
            Tokens you hold besides USDsui will show up here. You can swap any of them to USDsui in one tap.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }}>
          <View style={styles.hero}>
            <Text style={styles.heroValue}>{usd2(total)}</Text>
            <Text style={styles.heroLabel}>Total bucket value (USDsui)</Text>
          </View>
          {coins.map((c) => (
            <View key={c.coinType} style={styles.coinRow}>
              {c.logoUrl ? (
                <Image source={{ uri: c.logoUrl }} style={styles.coinLogo} />
              ) : (
                <View style={styles.coinLogoFallback}>
                  <Text style={styles.coinInitial}>{(c.symbol ?? "?").slice(0, 1)}</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.coinSym}>{c.symbol ?? "Token"}</Text>
                <Text style={styles.coinAmt}>{humanAmount(c).toLocaleString("en-US", { maximumFractionDigits: 4 })} {c.symbol}</Text>
              </View>
              <Pressable style={styles.swapPill} onPress={() => Alert.alert("", "Swap-to-USDsui execution lands in the Phase 4 continuation.")}>
                <Text style={styles.swapText}>Swap to USDsui</Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg },
  close: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" },
  headerTitle: { flexDirection: "row", alignItems: "center", gap: 6 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl },
  emptyTitle: { fontFamily: family.sans, fontSize: 19, fontWeight: "500", color: colors.fg },
  emptySub: { fontFamily: family.sans, fontSize: 14, color: colors.fgMuted, textAlign: "center", lineHeight: 20 },
  hero: { alignItems: "center", gap: 4, marginVertical: spacing.lg },
  heroValue: { fontFamily: family.sans, fontSize: 52, fontWeight: "500", color: colors.fg, letterSpacing: -1 },
  heroLabel: { fontFamily: family.mono, fontSize: 11, letterSpacing: 1, color: colors.fgMuted },
  coinRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: 18, padding: 14 },
  coinLogo: { width: 42, height: 42, borderRadius: 21 },
  coinLogoFallback: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" },
  coinInitial: { fontFamily: family.sans, fontSize: 18, fontWeight: "600", color: colors.greenMint },
  coinSym: { fontFamily: family.sans, fontSize: 18, fontWeight: "600", color: colors.fg },
  coinAmt: { fontFamily: family.sans, fontSize: 13, color: colors.fgMuted, marginTop: 2 },
  swapPill: { backgroundColor: colors.greenMint, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
  swapText: { fontFamily: family.sans, fontSize: 13, fontWeight: "600", color: colors.inkOnAccent },
});
