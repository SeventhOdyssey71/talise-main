import { useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useSession } from "@/auth/session";
import { HistoryRow } from "@/components/wallet/HistoryRow";
import { useWalletData } from "@/components/wallet/useWalletData";
import { Img } from "@/design/assets";
import { TopGlow } from "@/design/components/TopGlow";
import { Icon } from "@/design/Icon";
import { colors } from "@/design/tokens";
import { family } from "@/design/typography";
import { local2, splitAmount } from "@/lib/format";

/**
 * HomeView — the wallet tab root, exact from ios Home/HomeView.swift. Balance
 * hero (bespoke split-Text, not HeroNumber), plus/paperplane actions, the 3-card
 * carousel, and the recent-activity list. Live data from /api/balances +
 * /api/activity.
 */
export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useSession();
  const { balance, activity, coins, loading, refreshing, refresh } = useWalletData();
  const [hidden, setHidden] = useState(false);

  const usdsui = balance?.usdsui ?? 0;
  const { whole, frac } = splitAmount(local2(usdsui));
  const suiLine = hidden
    ? "•••• USDsui"
    : `${(balance?.usdsui ?? 0).toFixed(usdsui < 0.01 ? 4 : 2)} USDsui`;

  return (
    <View style={styles.screen}>
      <TopGlow />
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 4, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.fgMuted} />}
      >
        {/* Top bar */}
        <View style={styles.topBar}>
          <Img name="TaliseLogo" style={styles.logo} />
          <View style={styles.topRight}>
            <View style={styles.agent}>
              <Icon name="sparkles" size={17} color={colors.greenMint} />
            </View>
            {user?.accountType ? (
              <Pressable style={styles.scanDisc} onPress={() => router.push("/scan")}>
                <Icon name="qrcode.viewfinder" size={18} color={colors.fg} />
              </Pressable>
            ) : null}
          </View>
        </View>

        {/* Balance hero + actions */}
        <View style={styles.balanceBlock}>
          <View style={{ flex: 1 }}>
            <View style={styles.eyebrowRow}>
              <Text style={styles.eyebrow}>BALANCE</Text>
              <Pressable onPress={() => setHidden((h) => !h)} hitSlop={8}>
                <Icon name={hidden ? "eye" : "eye"} size={11} color={colors.fgDim} />
              </Pressable>
            </View>
            <Text style={styles.hero} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
              {hidden ? "••••••" : (
                <>
                  <Text>{whole}</Text>
                  <Text style={{ color: colors.fgMuted }}>{frac}</Text>
                </>
              )}
            </Text>
            <View style={styles.subLine}>
              <Text style={styles.subMono}>{suiLine}</Text>
              <Text style={styles.subDot}>·</Text>
              <Text style={styles.subEarn}>Earn on your idle balance</Text>
            </View>
          </View>
          <View style={styles.actions}>
            <Pressable style={[styles.action, styles.actionAccent]} onPress={() => router.push("/deposit")}>
              <Icon name="plus" size={16} color={colors.bg} />
            </Pressable>
            <Pressable style={[styles.action, styles.actionAccent]} onPress={() => router.push("/withdraw")}>
              <Icon name="paperplane" size={16} color={colors.bg} />
            </Pressable>
          </View>
        </View>

        {/* Card carousel */}
        <CardCarousel
          handle={user?.handle ?? null}
          tokenCount={coins.filter((c) => !c.isUsdsui).length}
          onTokenBucket={() => router.push("/token-bucket")}
        />

        {/* Recent activity */}
        <View style={styles.activitySection}>
          <View style={styles.activityHeader}>
            <Text style={styles.activityEyebrow}>RECENT ACTIVITY</Text>
            <Pressable onPress={() => router.push("/history")} hitSlop={8} style={styles.viewAll}>
              <Text style={styles.viewAllText}>View all</Text>
              <Icon name="chevron.right" size={10} color={colors.fgMuted} />
            </Pressable>
          </View>
          {activity.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>{loading ? "Loading…" : "No activity yet"}</Text>
            </View>
          ) : (
            <View style={styles.activityCard}>
              {activity.slice(0, 4).map((t, i) => (
                <View key={t.digest}>
                  {i > 0 ? <View style={styles.rowSep} /> : null}
                  <HistoryRow entry={t} hidden={hidden} onPress={() => router.push(`/receipt?digest=${t.digest}`)} />
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function CardCarousel({
  handle,
  tokenCount,
  onTokenBucket,
}: {
  handle: string | null;
  tokenCount: number;
  onTokenBucket: () => void;
}) {
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);
  const cardW = width - 64;

  return (
    <View style={{ marginTop: 24 }}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        snapToInterval={width}
        decelerationRate="fast"
        onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
      >
        {/* Username card */}
        <View style={[styles.pageWrap, { width }]}>
          <View style={[styles.card, { width: cardW }]}>
            <Img name="SuiCoinMark" style={styles.cardMark} />
            {handle ? (
              <Text style={styles.cardHandle}>{handle}</Text>
            ) : (
              <View style={{ gap: 4 }}>
                <Text style={styles.cardHandle}>Claim your name</Text>
                <Text style={styles.cardClaimSub}>So friends can send you USDsui by name.</Text>
              </View>
            )}
            <View style={styles.cardFooter}>
              <Text style={styles.microLabel}>$0.00 FEE</Text>
              <Text style={styles.microLabel}>YOUR MONEY LANDS HERE</Text>
            </View>
          </View>
        </View>
        {/* Token bucket card */}
        <View style={[styles.pageWrap, { width }]}>
          <Pressable style={[styles.card, { width: cardW }]} onPress={onTokenBucket}>
            <View style={styles.cardMark}>
              <Icon name="circle.hexagongrid.fill" size={22} color={colors.greenMint} />
            </View>
            <View style={{ gap: 6 }}>
              <Text style={styles.cardHandle}>Token bucket</Text>
              <Text style={styles.cardClaimSub}>
                {tokenCount > 0 ? `${tokenCount} token${tokenCount > 1 ? "s" : ""} besides USDsui` : "No other tokens yet"}
              </Text>
            </View>
            <View style={styles.cardFooter}>
              <Text style={styles.microLabel}>OTHER TOKENS</Text>
              <Text style={styles.microLabel}>TAP TO VIEW</Text>
            </View>
          </Pressable>
        </View>
        {/* Card coming soon */}
        <View style={[styles.pageWrap, { width }]}>
          <View style={[styles.card, styles.cardSoon, { width: cardW }]}>
            <View style={styles.soonLogos}>
              <Img name="TaliseLogo" style={{ width: 60, height: 22, resizeMode: "contain" }} />
              <Img name="VisaLogo" style={{ width: 44, height: 27, resizeMode: "contain" }} />
            </View>
            <View style={{ gap: 4 }}>
              <Text style={styles.cardHandle}>Talise Card</Text>
              <Text style={styles.soonLabel}>COMING SOON</Text>
            </View>
          </View>
        </View>
      </ScrollView>
      <View style={styles.dots}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={[styles.dot, { backgroundColor: i === page ? colors.fg : "rgba(99,99,99,0.45)" }]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 30, height: 38 },
  logo: { width: 24, height: 22, resizeMode: "contain" },
  topRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  agent: {
    width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.surface2,
  },
  scanDisc: {
    width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.surfaceGlass, borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.12)",
  },
  balanceBlock: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 30, marginTop: 32 },
  eyebrowRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  eyebrow: { fontFamily: family.mono, fontSize: 10, letterSpacing: 2, color: colors.fgMuted },
  hero: { fontFamily: family.sans, fontSize: 40, fontWeight: "600", color: colors.fg, letterSpacing: -1.6, marginTop: 6 },
  subLine: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  subMono: { fontFamily: family.mono, fontSize: 10, fontWeight: "300", color: colors.fgMuted },
  subDot: { fontFamily: family.mono, fontSize: 10, color: colors.fgDim },
  subEarn: { fontFamily: family.mono, fontSize: 10, fontWeight: "300", color: colors.accent },
  actions: { flexDirection: "row", gap: 8, marginBottom: 6 },
  action: { width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface2 },
  actionAccent: { backgroundColor: colors.accent },

  pageWrap: { alignItems: "center" },
  card: { height: 212, backgroundColor: colors.surface, borderRadius: 25, padding: 24, justifyContent: "space-between" },
  cardMark: { width: 26, height: 26, resizeMode: "contain", position: "absolute", top: 22, right: 24 },
  cardHandle: { fontFamily: family.sans, fontSize: 20, fontWeight: "500", color: colors.fgSubtle, letterSpacing: -0.8 },
  cardClaimSub: { fontFamily: family.sans, fontSize: 13, color: colors.fgMuted, maxWidth: "80%" },
  cardFooter: { flexDirection: "row", justifyContent: "space-between" },
  microLabel: { fontFamily: family.mono, fontSize: 8, letterSpacing: -0.32, color: colors.fgDim },
  cardSoon: { backgroundColor: "#183A16" },
  soonLogos: { flexDirection: "row", alignItems: "center", gap: 10 },
  soonLabel: { fontFamily: family.sans, fontSize: 10, fontWeight: "700", letterSpacing: 3, color: colors.greenMint },
  dots: { flexDirection: "row", justifyContent: "center", gap: 6, marginTop: 14 },
  dot: { width: 6, height: 6, borderRadius: 3 },

  activitySection: { paddingHorizontal: 22, marginTop: 28 },
  activityHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12, paddingHorizontal: 8 },
  activityEyebrow: { fontFamily: family.mono, fontSize: 10, letterSpacing: 2, color: colors.fgMuted },
  viewAll: { flexDirection: "row", alignItems: "center", gap: 4 },
  viewAllText: { fontFamily: family.sans, fontSize: 12, fontWeight: "300", color: colors.fgMuted },
  activityCard: { backgroundColor: colors.surface, borderRadius: 20, overflow: "hidden", paddingVertical: 4 },
  rowSep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginLeft: 64 },
  emptyCard: { backgroundColor: colors.surface, borderRadius: 20, padding: 22, alignItems: "center" },
  emptyText: { fontFamily: family.sans, fontSize: 13, fontWeight: "300", color: colors.fgDim },
});
