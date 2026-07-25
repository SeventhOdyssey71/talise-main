import { useState } from "react";
import { Pressable, ScrollView, Share, StyleSheet, Switch, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { chequesApi } from "@/api/cheques";
import { fmtUsd, moneyErrorCopy } from "@/api/money";
import { FlowHeader } from "@/components/wallet/FlowHeader";
import { LabeledField, FieldInput } from "@/components/wallet/FormField";
import { TaliseButton } from "@/design/components/TaliseButton";
import { SlideToConfirm } from "@/design/components/SlideToConfirm";
import { colors, radius, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

/** ChequeWriteView — write + fund a cheque, then hand back a shareable claim link. */
export default function ChequeWriteScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [amount, setAmount] = useState("");
  const [payee, setPayee] = useState("");
  const [memo, setMemo] = useState("");
  const [restrict, setRestrict] = useState(false);
  const [country, setCountry] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [claimUrl, setClaimUrl] = useState<string | null>(null);

  const amountUsd = parseFloat(amount) || 0;
  const canSign = amountUsd >= 0.01 && payee.trim().length > 0;

  const sign = async () => {
    setErr(null);
    try {
      const iso = country.trim().toUpperCase();
      const r = await chequesApi.create({
        amountUsd,
        payeeLabel: payee.trim(),
        memo: memo.trim() || undefined,
        allowedCountries: restrict && iso ? [iso] : [],
      });
      setClaimUrl(r.claimUrl);
    } catch (e) {
      setErr(moneyErrorCopy(e, "Couldn't write this cheque. Please try again."));
    }
  };

  const share = async () => {
    if (claimUrl) await Share.share({ message: claimUrl });
  };

  if (claimUrl) {
    return (
      <View style={styles.screen}>
        <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.md, padding: spacing.xl, gap: 22 }}>
          <FlowHeader eyebrow="Write a cheque" title="Cheque issued" onClose={() => router.back()} />
          <Text style={styles.lede}>Send this link in any DM. They claim it as money.</Text>

          <View style={styles.chequeCard}>
            <Text style={styles.chequeAmount}>{fmtUsd(amountUsd)}</Text>
            <Text style={styles.chequeLink} numberOfLines={2}>{claimUrl}</Text>
            <Text style={styles.chequeCaption}>TALISE · PAY ANYONE, ANYWHERE</Text>
          </View>

          <View style={{ gap: spacing.md }}>
            <TaliseButton title="Share cheque link" variant="primary" size="lg" icon="square.and.arrow.up" onPress={share} />
            <TaliseButton title="Done" variant="secondary" size="lg" onPress={() => router.back()} />
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.md, padding: spacing.xl, gap: 22 }} keyboardShouldPersistTaps="handled">
        <FlowHeader eyebrow="Write a cheque" title="Money in a link" onClose={() => router.back()} />
        <Text style={styles.lede}>Send it in any DM. They claim it as real money.</Text>

        <LabeledField label="AMOUNT (USDsui)">
          <FieldInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" />
        </LabeledField>

        <LabeledField label="PAY TO (name on the cheque)">
          <FieldInput value={payee} onChangeText={setPayee} placeholder="Alex" autoCapitalize="words" autoCorrect={false} />
        </LabeledField>

        <LabeledField label="MEMO (optional)">
          <FieldInput value={memo} onChangeText={setMemo} placeholder="What's it for?" />
        </LabeledField>

        <View style={styles.toggleCard}>
          <View style={styles.toggleRow}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.toggleTitle}>Restrict by country</Text>
              <Text style={styles.toggleHelp}>Only claimable from one country (IP-checked)</Text>
            </View>
            <Switch
              value={restrict}
              onValueChange={setRestrict}
              trackColor={{ true: colors.accent, false: colors.surface2 }}
              thumbColor={colors.fg}
            />
          </View>
          {restrict ? (
            <LabeledField label="COUNTRY (ISO code)">
              <FieldInput
                value={country}
                onChangeText={(t) => setCountry(t.toUpperCase())}
                placeholder="US"
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={2}
              />
            </LabeledField>
          ) : null}
        </View>

        <Text style={styles.protection}>Always protected: captcha + no-VPN on claim</Text>

        {err ? <Text style={styles.err}>{err}</Text> : null}

        <View style={{ opacity: canSign ? 1 : 0.4 }} pointerEvents={canSign ? "auto" : "none"}>
          <SlideToConfirm title="Slide to sign & fund" tint={colors.accent} onConfirm={sign} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  lede: { fontFamily: family.sans, fontSize: 14, color: colors.fgMuted, lineHeight: 20 },
  toggleCard: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, padding: spacing.lg, gap: spacing.lg },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  toggleTitle: { fontFamily: family.sans, fontSize: 16, fontWeight: "500", color: colors.fg },
  toggleHelp: { fontFamily: family.sans, fontSize: 12.5, color: colors.fgMuted, lineHeight: 18 },
  protection: { fontFamily: family.mono, fontSize: 12, color: colors.fgDim, lineHeight: 17 },
  err: { fontFamily: family.sans, fontSize: 13, color: colors.danger, lineHeight: 18 },
  chequeCard: { backgroundColor: colors.surface, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, padding: spacing.xl, gap: spacing.md },
  chequeAmount: { fontFamily: family.sans, fontSize: 34, fontWeight: "500", color: colors.fg, letterSpacing: -1 },
  chequeLink: { fontFamily: family.mono, fontSize: 13, color: colors.accent, lineHeight: 19 },
  chequeCaption: { fontFamily: family.mono, fontSize: 10, letterSpacing: 1.5, color: colors.fgDim, marginTop: spacing.sm },
});
