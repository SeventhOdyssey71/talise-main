import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { chequesApi, parseChequeLink, type ChequePreview } from "@/api/cheques";
import { fmtUsd } from "@/api/money";
import { FlowHeader } from "@/components/wallet/FlowHeader";
import { FieldInput, LabeledField } from "@/components/wallet/FormField";
import { SuccessfulTxView } from "@/components/wallet/SuccessfulTxView";
import { TaliseButton } from "@/design/components/TaliseButton";
import { SlideToConfirm } from "@/design/components/SlideToConfirm";
import { colors, radius, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

/** ChequeClaimView — paste a cheque link, preview it, cash it into balance. */
export default function ChequeClaimScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [link, setLink] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [parsed, setParsed] = useState<{ id: string; secret: string } | null>(null);
  const [preview, setPreview] = useState<ChequePreview | null>(null);
  const [cashed, setCashed] = useState(false);

  const open = async () => {
    setErr(null); setLoading(true);
    try {
      const p = parseChequeLink(link);
      if (!p) {
        setErr("That doesn't look like a cheque link.");
        return;
      }
      const pv = await chequesApi.preview(p.id, p.secret);
      setParsed(p);
      setPreview(pv);
    } catch {
      setErr("Couldn't open this cheque — it may be invalid or already claimed.");
    } finally {
      setLoading(false);
    }
  };

  const cash = async () => {
    if (!parsed) return;
    await chequesApi.claim(parsed.id, parsed.secret);
    setCashed(true);
  };

  if (cashed && preview) {
    return (
      <SuccessfulTxView
        title={`${fmtUsd(preview.amountUsd)} cashed`}
        subtitle="It's in your Talise balance."
        onDone={() => router.back()}
      />
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.md, padding: spacing.xl, gap: 22 }} keyboardShouldPersistTaps="handled">
        <FlowHeader eyebrow="Cash a cheque" title="Paste a cheque link" onClose={() => router.back()} />

        <LabeledField label="CHEQUE LINK">
          <FieldInput
            value={link}
            onChangeText={(t) => { setLink(t); setPreview(null); setParsed(null); setErr(null); }}
            placeholder="https://talise.io/c/…"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </LabeledField>

        {!preview ? (
          <TaliseButton title={loading ? "Loading…" : "Open cheque"} variant="primary" size="lg" loading={loading} onPress={open} />
        ) : null}

        {err ? <Text style={styles.err}>{err}</Text> : null}

        {preview ? (
          <>
            <View style={styles.chequeCard}>
              <Text style={styles.chequeAmount}>{fmtUsd(preview.amountUsd)}</Text>
              <Text style={styles.chequeFrom}>From {preview.creatorDisplay}</Text>
              {preview.memo ? <Text style={styles.chequeMemo}>{preview.memo}</Text> : null}
              {preview.allowedCountries.length ? (
                <Text style={styles.chequeNote}>Claimable only from {preview.allowedCountries[0]}</Text>
              ) : null}
              <Text style={styles.chequeCaption}>TALISE · PAY ANYONE, ANYWHERE</Text>
            </View>

            {preview.claimable ? (
              <SlideToConfirm title="Slide to cash this cheque" tint={colors.accent} onConfirm={cash} />
            ) : (
              <Text style={styles.notClaimable}>This cheque is {preview.status}.</Text>
            )}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  err: { fontFamily: family.sans, fontSize: 13, color: colors.danger, lineHeight: 18 },
  chequeCard: { backgroundColor: colors.surface, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, padding: spacing.xl, gap: spacing.sm },
  chequeAmount: { fontFamily: family.sans, fontSize: 34, fontWeight: "500", color: colors.fg, letterSpacing: -1 },
  chequeFrom: { fontFamily: family.sans, fontSize: 15, color: colors.fgMuted },
  chequeMemo: { fontFamily: family.sans, fontSize: 14, color: colors.fg, marginTop: 2 },
  chequeNote: { fontFamily: family.mono, fontSize: 12, color: colors.accent, marginTop: 2 },
  chequeCaption: { fontFamily: family.mono, fontSize: 10, letterSpacing: 1.5, color: colors.fgDim, marginTop: spacing.md },
  notClaimable: { fontFamily: family.sans, fontSize: 14, color: colors.fgMuted, textAlign: "center" },
});
