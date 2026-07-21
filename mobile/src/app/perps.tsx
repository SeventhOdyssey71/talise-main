import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Slider from "@react-native-community/slider";

import { ApiError } from "@/api/client";
import { fmtPrice, INTERVALS, marketsApi, signedPct, type Candle, type PerpAccount, type PerpMarket } from "@/api/markets";
import { sponsorExecute } from "@/auth/zklogin";
import { CandleChart } from "@/components/wallet/CandleChart";
import { Icon } from "@/design/Icon";
import { colors, spacing } from "@/design/tokens";
import { family } from "@/design/typography";
import { local2 } from "@/lib/format";

const LONG = colors.accent;
const SHORT = "#D9614F";

/** TradeView — the perps terminal. Perps is flag-gated; when off we show the disabled state. */
export default function PerpsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();

  const [disabled, setDisabled] = useState(false);
  const [market, setMarket] = useState<PerpMarket | null>(null);
  const [price, setPrice] = useState(0);
  const [change24h, setChange24h] = useState(0);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [interval, setInterval2] = useState("15m");
  const [account, setAccount] = useState<PerpAccount | null>(null);
  const [tab, setTab] = useState<"positions" | "history">("positions");
  const [orderSide, setOrderSide] = useState<null | "long" | "short">(null);
  const [loading, setLoading] = useState(true);
  const poll = useRef<ReturnType<typeof globalThis.setInterval> | null>(null);

  const symbol = market?.symbol ?? "";

  const refresh = useCallback(async (sym: string, iv: string) => {
    const [q, c, a] = await Promise.allSettled([marketsApi.quote(sym), marketsApi.candles(sym, iv), marketsApi.account()]);
    if (q.status === "fulfilled") { if (q.value.spot) setPrice(q.value.spot); if (q.value.change24h != null) setChange24h(q.value.change24h); }
    if (c.status === "fulfilled") setCandles(c.value);
    if (a.status === "fulfilled") setAccount(a.value);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const ms = await marketsApi.markets();
        const m = ms.find((x) => !x.paused && x.refPriceUsd > 0) ?? ms[0] ?? null;
        setMarket(m);
        if (m) { setPrice(m.refPriceUsd); await refresh(m.symbol, interval); }
      } catch (e) {
        if (e instanceof ApiError && e.code === "PERPS_DISABLED") setDisabled(true);
      } finally {
        setLoading(false);
      }
    })();
    return () => { if (poll.current) globalThis.clearInterval(poll.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!symbol) return;
    if (poll.current) globalThis.clearInterval(poll.current);
    poll.current = globalThis.setInterval(() => void refresh(symbol, interval), 5000);
    return () => { if (poll.current) globalThis.clearInterval(poll.current); };
  }, [symbol, interval, refresh]);

  const changeInterval = (iv: string) => { setInterval2(iv); if (symbol) void refresh(symbol, iv); };

  if (disabled) {
    return (
      <View style={styles.screen}>
        <NavHeader onBack={() => router.back()} />
        <View style={styles.disabled}>
          <Icon name="chart.line.uptrend.xyaxis" size={44} color={colors.fgDim} />
          <Text style={styles.disabledTitle}>Trading is rolling out</Text>
          <Text style={styles.disabledSub}>Perpetuals aren&apos;t switched on for your account yet.{"\n"}Check back soon.</Text>
        </View>
      </View>
    );
  }

  const available = account?.availableUsd ?? 0;
  const positions = account?.positions ?? [];

  return (
    <View style={styles.screen}>
      <NavHeader onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 128 }} showsVerticalScrollIndicator={false}>
        <View style={styles.pairRow}>
          <View>
            <Text style={styles.pair}>{market?.sym ?? "—"}/USD</Text>
            <Text style={styles.pairName}>{market?.name ?? (loading ? "Loading…" : "")}</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={styles.availLabel}>Available</Text>
            <Text style={styles.availVal}>{local2(available)}</Text>
          </View>
        </View>

        <Text style={styles.price}>${fmtPrice(price)}</Text>
        <Text style={[styles.change, { color: change24h >= 0 ? LONG : SHORT }]}>{signedPct(change24h)}</Text>

        <View style={styles.tfRow}>
          {INTERVALS.map((iv) => (
            <Pressable key={iv} style={[styles.tf, interval === iv && styles.tfOn]} onPress={() => changeInterval(iv)}>
              <Text style={[styles.tfText, { color: interval === iv ? colors.fg : colors.fgMuted }]}>{iv}</Text>
            </Pressable>
          ))}
        </View>

        <CandleChart candles={candles} width={width - 40} />

        <View style={styles.stats}>
          <Stat label="24h" value={signedPct(change24h)} color={change24h >= 0 ? LONG : SHORT} />
          <Stat label="Max lev" value={`${market?.maxLeverage ?? 0}x`} />
          <Stat label="Funding" value={`${(market?.fundingRatePct ?? 0).toFixed(3)}%`} />
          <Stat label="Fee" value={`${((market?.tradingFeeBps ?? 0) / 100).toFixed(2)}%`} />
        </View>

        <View style={styles.posTabs}>
          {(["positions", "history"] as const).map((t) => (
            <Pressable key={t} style={[styles.posTab, tab === t && styles.posTabOn]} onPress={() => setTab(t)}>
              <Text style={[styles.posTabText, { color: tab === t ? colors.fg : colors.fgMuted }]}>
                {t === "positions" ? `Positions${positions.length ? ` · ${positions.length}` : ""}` : "History"}
              </Text>
            </Pressable>
          ))}
        </View>
        {tab === "positions" && positions.length === 0 ? (
          <View style={styles.empty}><Text style={styles.emptyTitle}>No open positions</Text><Text style={styles.emptySub}>Your open trades appear here.</Text></View>
        ) : tab === "history" ? (
          <View style={styles.empty}><Text style={styles.emptyTitle}>No trade history</Text><Text style={styles.emptySub}>Opens, closes and transfers show up here.</Text></View>
        ) : (
          positions.map((p) => (
            <View key={p.positionId} style={styles.posRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.posSym}>{p.ticker}</Text>
                <Text style={[styles.posSide, { color: p.isLong ? LONG : SHORT }]}>{p.isLong ? "LONG" : "SHORT"} {p.leverage}x</Text>
              </View>
              <Text style={[styles.posPnl, { color: p.pnlUsd >= 0 ? LONG : SHORT }]}>{p.pnlUsd >= 0 ? "+" : ""}{local2(p.pnlUsd)}</Text>
            </View>
          ))
        )}
      </ScrollView>

      <View style={[styles.tradeBar, { paddingBottom: insets.bottom + spacing.md }]}>
        <Pressable style={[styles.tradeBtn, { backgroundColor: LONG }]} onPress={() => setOrderSide("long")}>
          <Text style={styles.tradeText}>Long {market?.sym}</Text>
        </Pressable>
        <Pressable style={[styles.tradeBtn, { backgroundColor: SHORT }]} onPress={() => setOrderSide("short")}>
          <Text style={styles.tradeText}>Short {market?.sym}</Text>
        </Pressable>
      </View>

      {orderSide && market ? (
        <OrderSheet market={market} price={price} side={orderSide} available={available} accountId={account?.accountId ?? null} onClose={() => setOrderSide(null)} onPlaced={() => { setOrderSide(null); if (symbol) void refresh(symbol, interval); }} />
      ) : null}
    </View>
  );
}

function OrderSheet({ market, price, side, available, accountId, onClose, onPlaced }: {
  market: PerpMarket; price: number; side: "long" | "short"; available: number; accountId: string | null; onClose: () => void; onPlaced: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [lev, setLev] = useState(10);
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const color = side === "long" ? LONG : SHORT;
  const amount = Number(raw) || 0;
  const notional = amount * lev;
  const sizeTokens = price > 0 ? notional / price : 0;
  const acceptable = side === "long" ? price * 1.005 : price * 0.995;
  const canPlace = amount > 0 && amount <= available && !busy;

  const place = async () => {
    setBusy(true);
    try {
      const res = await marketsApi.order({
        ticker: market.symbol, accountId, isLong: side === "long", sizeTokens, collateralUsd: amount, acceptablePriceUsd: acceptable,
      });
      if (res.mode !== "executed" && res.bytes) await sponsorExecute(res.bytes, { kind: "invest" });
      onPlaced();
    } catch (e) {
      Alert.alert("Order failed", e instanceof Error ? e.message : "Couldn't place that order.");
    } finally { setBusy(false); }
  };

  return (
    <View style={styles.sheetBackdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
        <View style={styles.grab} />
        <Text style={styles.sheetTitle}>{market.sym}/USD · ${fmtPrice(price)}</Text>
        <View style={styles.sideBadge}><Text style={[styles.sideText, { color }]}>{side.toUpperCase()}</Text></View>

        <View style={styles.levHead}>
          <Text style={styles.levLabel}>Leverage</Text>
          <Text style={[styles.levVal, { color }]}>{lev}x</Text>
        </View>
        <Slider minimumValue={1} maximumValue={market.maxLeverage} step={1} value={lev} onValueChange={setLev} minimumTrackTintColor={color} maximumTrackTintColor={colors.surface2} thumbTintColor={color} />

        <View style={styles.field}>
          <Text style={styles.dollar}>$</Text>
          <TextInput value={raw} onChangeText={setRaw} placeholder="0.00" placeholderTextColor={colors.fgDim} keyboardType="decimal-pad" style={styles.fieldInput} autoFocus />
          <Text style={styles.usdsui}>USDsui</Text>
        </View>
        <Text style={styles.power}>Buying power · {lev}x = {local2(notional)}</Text>

        <Pressable style={[styles.placeBtn, { backgroundColor: color, opacity: canPlace ? 1 : 0.4 }]} disabled={!canPlace} onPress={place}>
          <Text style={styles.placeText}>{busy ? "Placing…" : amount > available ? "Deposit to trade" : `${side === "long" ? "Long" : "Short"} ${market.sym} · ${lev}x`}</Text>
        </Pressable>
        <Text style={styles.collat}>Collateral is USDsui · gas is sponsored</Text>
      </View>
    </View>
  );
}

function NavHeader({ onBack }: { onBack: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.nav, { paddingTop: insets.top + spacing.sm }]}>
      <Pressable style={styles.disc} onPress={onBack} hitSlop={8}><Icon name="chevron.left" size={16} color={colors.fg} /></Pressable>
      <Text style={styles.navTitle}>Perps</Text>
      <View style={styles.disc} />
    </View>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, color && { color }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  nav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: spacing.sm },
  disc: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  navTitle: { fontFamily: family.sans, fontSize: 16, fontWeight: "600", color: colors.fg },
  disabled: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl },
  disabledTitle: { fontFamily: family.sans, fontSize: 20, fontWeight: "500", color: colors.fg },
  disabledSub: { fontFamily: family.sans, fontSize: 14, color: colors.fgMuted, textAlign: "center", lineHeight: 20 },
  pairRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.sm },
  pair: { fontFamily: family.sans, fontSize: 17, fontWeight: "600", color: colors.fg },
  pairName: { fontFamily: family.sans, fontSize: 12, color: colors.fgMuted, marginTop: 2 },
  availLabel: { fontFamily: family.mono, fontSize: 9, color: colors.fgMuted },
  availVal: { fontFamily: family.sans, fontSize: 15, fontWeight: "500", color: colors.accent, marginTop: 2 },
  price: { fontFamily: family.sans, fontSize: 36, fontWeight: "700", color: colors.fg, marginTop: spacing.md },
  change: { fontFamily: family.sans, fontSize: 15, fontWeight: "500", marginTop: 2 },
  tfRow: { flexDirection: "row", backgroundColor: colors.surface, borderRadius: 12, padding: 4, marginTop: spacing.lg, gap: 2 },
  tf: { flex: 1, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  tfOn: { backgroundColor: colors.surface2 },
  tfText: { fontFamily: family.sans, fontSize: 12, fontWeight: "500" },
  stats: { flexDirection: "row", backgroundColor: colors.surface, borderRadius: 14, marginTop: spacing.lg, paddingVertical: 12 },
  stat: { flex: 1, alignItems: "center", gap: 3, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.line },
  statLabel: { fontFamily: family.mono, fontSize: 9, color: colors.fgMuted },
  statValue: { fontFamily: family.sans, fontSize: 13, fontWeight: "500", color: colors.fg },
  posTabs: { flexDirection: "row", gap: 8, marginTop: spacing.lg },
  posTab: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.surface },
  posTabOn: { backgroundColor: colors.surface2 },
  posTabText: { fontFamily: family.sans, fontSize: 13, fontWeight: "500" },
  empty: { alignItems: "center", gap: 4, paddingVertical: spacing.xxl },
  emptyTitle: { fontFamily: family.sans, fontSize: 15, fontWeight: "500", color: colors.fg },
  emptySub: { fontFamily: family.sans, fontSize: 13, color: colors.fgDim },
  posRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginTop: spacing.sm },
  posSym: { fontFamily: family.sans, fontSize: 15, fontWeight: "500", color: colors.fg },
  posSide: { fontFamily: family.mono, fontSize: 11, marginTop: 2 },
  posPnl: { fontFamily: family.sans, fontSize: 15, fontWeight: "600" },
  tradeBar: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", gap: spacing.md, paddingHorizontal: 20, paddingTop: spacing.md, backgroundColor: colors.bg },
  tradeBtn: { flex: 1, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  tradeText: { fontFamily: family.sans, fontSize: 16, fontWeight: "600", color: "#0A130A" },

  sheetBackdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.xl, gap: spacing.md },
  grab: { width: 40, height: 5, borderRadius: 3, backgroundColor: colors.surface2, alignSelf: "center" },
  sheetTitle: { fontFamily: family.sans, fontSize: 16, fontWeight: "600", color: colors.fg, textAlign: "center" },
  sideBadge: { alignSelf: "center" },
  sideText: { fontFamily: family.mono, fontSize: 12, letterSpacing: 1 },
  levHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  levLabel: { fontFamily: family.mono, fontSize: 10, letterSpacing: 2, color: colors.fgMuted },
  levVal: { fontFamily: family.sans, fontSize: 18, fontWeight: "600" },
  field: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.surface2, borderRadius: 16, paddingHorizontal: 16, height: 56 },
  dollar: { fontFamily: family.sans, fontSize: 20, color: colors.fgMuted },
  fieldInput: { flex: 1, fontFamily: family.sans, fontSize: 22, fontWeight: "500", color: colors.fg },
  usdsui: { fontFamily: family.sans, fontSize: 13, color: colors.fgMuted },
  power: { fontFamily: family.sans, fontSize: 12, color: colors.fgMuted },
  placeBtn: { height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  placeText: { fontFamily: family.sans, fontSize: 16, fontWeight: "600", color: "#0A130A" },
  collat: { fontFamily: family.sans, fontSize: 11, color: colors.fgDim, textAlign: "center" },
});
