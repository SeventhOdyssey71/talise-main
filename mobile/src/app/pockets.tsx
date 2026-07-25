import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  CURRENCIES,
  convert,
  currency,
  fmtCurrency,
  fxApi,
  pocketsStore,
  QUOTE_TTL_S,
  SPREAD_BPS,
  type TaliseCurrency,
} from "@/api/pockets";
import { walletApi } from "@/api/wallet";
import { Flag } from "@/design/assets";
import { FlowHeader } from "@/components/wallet/FlowHeader";
import { SlideToConfirm } from "@/design/components/SlideToConfirm";
import { TaliseButton } from "@/design/components/TaliseButton";
import { Eyebrow, MicroLabel, SectionHeader } from "@/design/components/text";
import { Icon } from "@/design/Icon";
import { colors, radius, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

/** Balance in a given currency = totalUsd converted USD→code. */
function pocketBalance(totalUsd: number, code: string, rates: Record<string, number>): number {
  return convert(totalUsd, "USD", code, rates).amountOut;
}

/** CurrencyPocketsView — multi-currency display over the one USDsui balance. */
export default function PocketsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [totalUsd, setTotalUsd] = useState(0);
  const [rates, setRates] = useState<Record<string, number>>({});
  const [display, setDisplay] = useState("USD");
  const [pockets, setPockets] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  const [quoteCode, setQuoteCode] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [d, p, cached] = await Promise.all([
        pocketsStore.getDisplay(),
        pocketsStore.getPockets(),
        pocketsStore.getCachedRates(),
      ]);
      if (!alive) return;
      setDisplay(d);
      setPockets(p);
      if (cached) setRates(cached.rates);
      walletApi.balances().then((b) => alive && setTotalUsd(b.totalUsd)).catch(() => {});
      fxApi.rates()
        .then((r) => {
          if (!alive) return;
          setRates(r);
          pocketsStore.setCachedRates(r);
        })
        .catch(() => {});
    })();
    return () => {
      alive = false;
    };
  }, []);

  const heroBalance = pocketBalance(totalUsd, display, rates);
  const available = CURRENCIES.filter((c) => !pockets.includes(c.code));

  const addCurrency = (code: string) => {
    const next = [...pockets, code];
    setPockets(next);
    pocketsStore.setPockets(next);
    if (available.length <= 1) setPicking(false);
  };

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.md, padding: spacing.xl, gap: 22 }}>
        <FlowHeader title="Currencies" onClose={() => router.back()} />

        {/* Hero */}
        <View style={styles.hero}>
          <Eyebrow>Total balance</Eyebrow>
          <Text style={styles.heroAmount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
            {fmtCurrency(heroBalance, display)}
          </Text>
          <Text style={styles.heroSub}>Across all your currencies</Text>
        </View>

        {/* Your pockets */}
        <View style={{ gap: 10 }}>
          <SectionHeader>Your pockets</SectionHeader>
          <View style={styles.card}>
            {pockets.map((code, i) => {
              const c = currency(code);
              const isDisplay = code === display;
              const bal = pocketBalance(totalUsd, code, rates);
              return (
                <Pressable
                  key={code}
                  onPress={isDisplay ? undefined : () => setQuoteCode(code)}
                  style={[styles.pocketRow, i > 0 && styles.pocketRowBorder]}
                >
                  <Flag code={c.flag} size={26} />
                  <View style={{ flex: 1 }}>
                    <View style={styles.pocketNameRow}>
                      <Text style={styles.pocketName}>{c.name}</Text>
                      {isDisplay ? (
                        <View style={styles.displayChip}>
                          <MicroLabel style={styles.displayChipText}>DISPLAY</MicroLabel>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.pocketCode}>{c.code}</Text>
                  </View>
                  <Text style={styles.pocketBal}>{fmtCurrency(bal, code)}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Add a currency */}
        {picking ? (
          <View style={styles.card}>
            <View style={styles.pickerHeader}>
              <Eyebrow>Add a currency</Eyebrow>
              <Pressable onPress={() => setPicking(false)} hitSlop={8}>
                <Text style={styles.doneLink}>Done</Text>
              </Pressable>
            </View>
            {available.length === 0 ? (
              <View style={styles.pickerEmpty}>
                <Icon name="checkmark.circle" size={34} color={colors.fgDim} />
                <Text style={styles.emptyText}>You&apos;ve added every currency.</Text>
              </View>
            ) : (
              available.map((c, i) => (
                <Pressable
                  key={c.code}
                  onPress={() => addCurrency(c.code)}
                  style={[styles.pocketRow, i > 0 && styles.pocketRowBorder]}
                >
                  <Flag code={c.flag} size={26} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pocketName}>{c.name}</Text>
                    <Text style={styles.pocketCode}>{c.code}</Text>
                  </View>
                  <Icon name="plus.circle" size={22} color={colors.accent} />
                </Pressable>
              ))
            )}
          </View>
        ) : (
          <TaliseButton title="Add a currency" variant="secondary" size="lg" icon="plus" onPress={() => setPicking(true)} />
        )}

        {/* Disclaimer */}
        <View style={styles.disclaimer}>
          <Icon name="info.circle" size={16} color={colors.fgDim} />
          <Text style={styles.disclaimerText}>
            Pockets show your one balance in each currency. Your wallet settles in USDsui (1:1 USD) — rates update live.
          </Text>
        </View>
      </ScrollView>

      {quoteCode ? (
        <FxQuoteSheet
          fromCode={display}
          toCode={quoteCode}
          amountIn={pocketBalance(totalUsd, display, rates)}
          rates={rates}
          onClose={() => setQuoteCode(null)}
        />
      ) : null}
    </View>
  );
}

/** FX quote card — live countdown + slide-to-lock. No real conversion happens. */
function FxQuoteSheet({
  fromCode,
  toCode,
  amountIn,
  rates,
  onClose,
}: {
  fromCode: string;
  toCode: string;
  amountIn: number;
  rates: Record<string, number>;
  onClose: () => void;
}) {
  const from: TaliseCurrency = currency(fromCode);
  const to: TaliseCurrency = currency(toCode);
  const [q, setQ] = useState(() => convert(amountIn, fromCode, toCode, rates));
  const [secs, setSecs] = useState(QUOTE_TTL_S);
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    timer.current = setInterval(() => {
      setSecs((s) => {
        if (s <= 1) {
          setQ(convert(amountIn, fromCode, toCode, rates));
          return QUOTE_TTL_S;
        }
        return s - 1;
      });
    }, 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [amountIn, fromCode, toCode, rates]);

  const countdownColor = secs <= 5 ? "#a9791f" : colors.accent;

  return (
    <View style={styles.sheetBackdrop}>
      <Pressable style={styles.sheetDismiss} onPress={onClose} />
      <View style={styles.sheet}>
        <Eyebrow>Convert to {toCode}</Eyebrow>
        <Text style={styles.sheetTitle}>
          {from.name} → {to.name}
        </Text>

        <View style={styles.quoteRows}>
          <QuoteRow label="You convert" value={fmtCurrency(amountIn, fromCode)} />
          <QuoteRow label="You get" value={fmtCurrency(q.amountOut, toCode)} strong />
          <QuoteRow
            label="Locked rate"
            value={`1 ${fromCode} = ${q.crossRate.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${toCode}`}
          />
          <QuoteRow label="Talise fee" value={`${fmtCurrency(q.fee, toCode)} · ${SPREAD_BPS / 100}%`} />
          <View style={styles.quoteRow}>
            <Text style={styles.quoteLabel}>Rate refreshes in</Text>
            <Text style={[styles.quoteValue, { color: countdownColor }]}>{secs}s</Text>
          </View>
        </View>

        {saved ? (
          <Text style={styles.savedLine}>✓ Quote saved</Text>
        ) : (
          <SlideToConfirm
            title="Slide to lock this quote"
            onConfirm={() => {
              setSaved(true);
              setTimeout(onClose, 900);
            }}
          />
        )}
      </View>
    </View>
  );
}

function QuoteRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.quoteRow}>
      <Text style={styles.quoteLabel}>{label}</Text>
      <Text style={[styles.quoteValue, strong && styles.quoteValueStrong]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },

  hero: { gap: 6, paddingVertical: spacing.sm },
  heroAmount: { fontFamily: family.sans, fontSize: 46, fontWeight: "500", color: colors.fg, letterSpacing: -1.4 },
  heroSub: { fontFamily: family.sans, fontSize: 14, color: colors.fgMuted },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    paddingHorizontal: spacing.lg,
  },

  pocketRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14 },
  pocketRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  pocketNameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  pocketName: { fontFamily: family.sans, fontSize: 15, fontWeight: "500", color: colors.fg },
  pocketCode: { fontFamily: family.mono, fontSize: 11, color: colors.fgDim, letterSpacing: 0.4, marginTop: 2 },
  pocketBal: { fontFamily: family.sans, fontSize: 15, fontWeight: "500", color: colors.fg },

  displayChip: { backgroundColor: colors.surface2, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3 },
  displayChipText: { color: colors.accent, letterSpacing: 0.5 },

  pickerHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: spacing.md, paddingBottom: 4 },
  doneLink: { fontFamily: family.sans, fontSize: 14, fontWeight: "600", color: colors.accent },
  pickerEmpty: { alignItems: "center", gap: 10, paddingVertical: spacing.xl },
  emptyText: { fontFamily: family.sans, fontSize: 14, color: colors.fgMuted, textAlign: "center" },

  disclaimer: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingHorizontal: spacing.xs },
  disclaimerText: { flex: 1, fontFamily: family.sans, fontSize: 12.5, color: colors.fgMuted, lineHeight: 18 },

  sheetBackdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.55)" },
  sheetDismiss: { flex: 1 },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    padding: spacing.xl,
    paddingBottom: 40,
    gap: spacing.lg,
  },
  sheetTitle: { fontFamily: family.sans, fontSize: 22, fontWeight: "500", color: colors.fg, letterSpacing: -0.6, marginTop: 4 },

  quoteRows: { gap: 2 },
  quoteRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  quoteLabel: { fontFamily: family.sans, fontSize: 14, color: colors.fgMuted },
  quoteValue: { fontFamily: family.sans, fontSize: 14, fontWeight: "500", color: colors.fg },
  quoteValueStrong: { fontSize: 17, color: colors.greenMint },

  savedLine: { fontFamily: family.sans, fontSize: 16, fontWeight: "600", color: colors.accent, textAlign: "center", paddingVertical: 18 },
});
