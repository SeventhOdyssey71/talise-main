import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { earnApi } from "@/api/earn";
import { signAndSubmit } from "@/auth/zklogin";
import { Img } from "@/design/assets";
import { SlideToConfirm } from "@/design/components/SlideToConfirm";
import { TaliseButton } from "@/design/components/TaliseButton";
import { Eyebrow, SectionHeader } from "@/design/components/text";
import { Icon } from "@/design/Icon";
import { colors, spacing } from "@/design/tokens";
import { family } from "@/design/typography";
import { local2 } from "@/lib/format";

const DISCLOSURE_KEY = "io.talise.app.earnDisclosureAcceptedV1";

/** EarnManageSheet — deposit (slide) / withdraw. First deposit gates on the disclosure. */
export default function EarnManageScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const p = useLocalSearchParams<{ apy?: string; supplied?: string; venue?: string }>();
  const apy = Number(p.apy) || 0;
  const supplied = Number(p.supplied) || 0;
  const venue = p.venue ?? "navi";

  const [mode, setMode] = useState<"add" | "withdraw">("add");
  const [raw, setRaw] = useState("");
  const [showDisclosure, setShowDisclosure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const amount = Number(raw) || 0;

  const doDeposit = async () => {
    setBusy(true); setErr(null);
    try {
      const { transactionKindB64 } = await earnApi.supplyPrepare(venue, amount);
      await signAndSubmit(transactionKindB64, { kind: "invest", amountUsd: amount, venue });
      setDone(true);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't add to earnings."); }
    finally { setBusy(false); }
  };

  const onDepositSlide = async () => {
    const AsyncStorage = (await import("@react-native-async-storage/async-storage")).default;
    const accepted = (await AsyncStorage.getItem(DISCLOSURE_KEY)) === "1";
    if (!accepted) { setShowDisclosure(true); return; }
    await doDeposit();
  };

  const acceptDisclosure = async () => {
    try { const AsyncStorage = (await import("@react-native-async-storage/async-storage")).default; await AsyncStorage.setItem(DISCLOSURE_KEY, "1"); } catch { /* ignore */ }
    setShowDisclosure(false);
    await doDeposit();
  };

  const doWithdraw = async () => {
    setBusy(true); setErr(null);
    try {
      const full = amount >= supplied - 0.01;
      const { transactionKindB64 } = await earnApi.withdrawPrepare(venue, full ? null : amount);
      await signAndSubmit(transactionKindB64, { kind: "withdraw", amountUsd: amount, venue });
      setDone(true);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't withdraw."); }
    finally { setBusy(false); }
  };

  if (done) {
    return (
      <View style={styles.success}>
        <Img name="SavingsPiggy" style={styles.piggy} />
        <Text style={styles.successTitle}>{mode === "add" ? "You're now earning" : "Withdrawn"}</Text>
        <Text style={styles.successSub}>{mode === "add" ? `${local2(amount)} is now earning on your idle balance.` : `${local2(amount)} is back in your balance.`}</Text>
        <Pressable style={styles.successBtn} onPress={() => router.back()}><Text style={styles.successBtnText}>Back to Invest</Text></Pressable>
      </View>
    );
  }

  if (showDisclosure) return <Disclosure apy={apy} onAccept={acceptDisclosure} onCancel={() => setShowDisclosure(false)} />;

  const annual = amount * (apy / 100);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.lg }]}>
      <ScrollView contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }}>
        <View style={styles.header}>
          <Eyebrow>{supplied > 0 ? "Your position" : "Earn rate"}</Eyebrow>
          <Text style={styles.hero}>{supplied > 0 ? local2(supplied) : `${apy.toFixed(2)}%`}</Text>
          <Text style={styles.heroCaption}>{supplied > 0 ? "Supplied and earning" : "On your money · withdraw anytime"}</Text>
        </View>

        {supplied > 0 ? (
          <View style={styles.modePicker}>
            {(["add", "withdraw"] as const).map((m) => (
              <Pressable key={m} style={[styles.modeTab, mode === m && styles.modeTabOn]} onPress={() => setMode(m)}>
                <Text style={[styles.modeText, { color: mode === m ? colors.inkOnAccent : colors.fg }]}>{m === "add" ? "Add money" : "Withdraw"}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <View>
          <SectionHeader>{mode === "add" ? "Add to earnings" : "Withdraw amount"}</SectionHeader>
          <View style={styles.field}>
            <Text style={styles.dollar}>$</Text>
            <TextInput value={raw} onChangeText={setRaw} placeholder="0.00" placeholderTextColor={colors.fgDim} keyboardType="decimal-pad" style={styles.fieldInput} />
          </View>
          {mode === "add" && amount > 0 ? (
            <View style={styles.projection}>
              <Eyebrow>ESTIMATED EARNINGS / YEAR</Eyebrow>
              <Text style={styles.projValue}>{local2(annual)}</Text>
            </View>
          ) : null}
          {mode === "withdraw" ? (
            <View style={styles.available}>
              <Text style={styles.availText}>Available {local2(supplied)}</Text>
              <Pressable onPress={() => setRaw(String(supplied))}><Text style={styles.max}>MAX</Text></Pressable>
            </View>
          ) : null}
        </View>

        {err ? <Text style={styles.err}>{err}</Text> : null}
      </ScrollView>

      <View style={[styles.actionBar, { paddingBottom: insets.bottom + spacing.md }]}>
        {mode === "add" ? (
          amount > 0 ? <SlideToConfirm title="Slide to start earning" tint={colors.accent} onConfirm={onDepositSlide} />
            : <TaliseButton title="Start earning" variant="secondary" size="lg" disabled />
        ) : (
          <TaliseButton title={busy ? "Working…" : `Withdraw ${amount > 0 ? local2(amount) : ""}`} variant="primary" size="lg" loading={busy} disabled={amount <= 0} onPress={doWithdraw} />
        )}
      </View>
    </View>
  );
}

function Disclosure({ apy, onAccept, onCancel }: { apy: number; onAccept: () => void; onCancel: () => void }) {
  const insets = useSafeAreaInsets();
  const points = [
    { icon: "building.columns", t: "A separate lending service", s: "Earn is optional and runs through a third-party lending protocol. It's not a banking or savings product offered by Talise." },
    { icon: "wallet.pass", t: "Not part of your balance", s: "Money you put into Earn is moved into the lending service, separate from your spendable balance. Nothing moves automatically." },
    { icon: "chart.line.uptrend.xyaxis", t: "Returns aren't guaranteed", s: "Rates vary and can change. Earnings are not guaranteed, and your money is not insured or protected against loss." },
  ];
  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.xl }]}>
      <ScrollView contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }}>
        <Eyebrow>BEFORE YOU START</Eyebrow>
        <Text style={styles.discTitle}>{apy >= 0.0001 ? `Earn around ${apy.toFixed(2)}% on your money` : "Earn on your money"}</Text>
        <Text style={styles.discSub}>A few things to know first.</Text>
        {points.map((p) => (
          <View key={p.t} style={styles.point}>
            <View style={styles.pointIcon}><Icon name={p.icon} size={16} color={colors.accent} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.pointTitle}>{p.t}</Text>
              <Text style={styles.pointSub}>{p.s}</Text>
            </View>
          </View>
        ))}
        <Text style={styles.discFoot}>By continuing you&apos;re choosing to use this optional service. You can withdraw at any time. This is not financial advice.</Text>
      </ScrollView>
      <View style={[styles.actionBar, { paddingBottom: insets.bottom + spacing.md, gap: spacing.sm }]}>
        <TaliseButton title="I understand — continue" variant="primary" size="lg" onPress={onAccept} />
        <TaliseButton title="Not now" variant="ghost" size="lg" onPress={onCancel} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { gap: 6 },
  hero: { fontFamily: family.sans, fontSize: 40, fontWeight: "600", color: colors.fg, letterSpacing: -1 },
  heroCaption: { fontFamily: family.sans, fontSize: 13, color: colors.fgMuted },
  modePicker: { flexDirection: "row", backgroundColor: colors.surface2, borderRadius: 14, padding: 4 },
  modeTab: { flex: 1, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  modeTabOn: { backgroundColor: colors.accent },
  modeText: { fontFamily: family.sans, fontSize: 14, fontWeight: "500" },
  field: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.surface2, borderRadius: 16, paddingHorizontal: 16, height: 56, marginTop: spacing.md },
  dollar: { fontFamily: family.sans, fontSize: 22, color: colors.fgMuted },
  fieldInput: { flex: 1, fontFamily: family.sans, fontSize: 22, fontWeight: "500", color: colors.fg },
  projection: { marginTop: spacing.md, gap: 4 },
  projValue: { fontFamily: family.sans, fontSize: 18, fontWeight: "600", color: colors.accent },
  available: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.md },
  availText: { fontFamily: family.mono, fontSize: 11, color: colors.fgMuted },
  max: { fontFamily: family.mono, fontSize: 11, fontWeight: "600", color: colors.accent },
  err: { fontFamily: family.sans, fontSize: 13, color: colors.danger },
  actionBar: { paddingHorizontal: spacing.xl, paddingTop: spacing.md },

  success: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  piggy: { width: 240, height: 190, resizeMode: "contain" },
  successTitle: { fontFamily: family.sans, fontSize: 34, fontWeight: "400", color: colors.fg },
  successSub: { fontFamily: family.mono, fontSize: 13, color: colors.fgMuted, textAlign: "center" },
  successBtn: { marginTop: spacing.lg, height: 44, paddingHorizontal: 32, borderRadius: 22, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  successBtnText: { fontFamily: family.sans, fontSize: 15, fontWeight: "500", color: "#000" },

  discTitle: { fontFamily: family.sans, fontSize: 24, fontWeight: "500", color: colors.fg, letterSpacing: -0.5 },
  discSub: { fontFamily: family.sans, fontSize: 14, color: colors.fgMuted },
  point: { flexDirection: "row", gap: 14 },
  pointIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(121,217,108,0.18)", alignItems: "center", justifyContent: "center" },
  pointTitle: { fontFamily: family.sans, fontSize: 15, fontWeight: "500", color: colors.fg },
  pointSub: { fontFamily: family.sans, fontSize: 13, color: colors.fgMuted, lineHeight: 19, marginTop: 2 },
  discFoot: { fontFamily: family.sans, fontSize: 12, color: colors.fgDim, lineHeight: 18, fontStyle: "italic" },
});
