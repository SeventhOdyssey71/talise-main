import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { invoicesApi, type InvoiceDetail } from "@/api/invoices";
import { fmtUsd, moneyErrorCopy } from "@/api/money";
import { FlowHeader } from "@/components/wallet/FlowHeader";
import { SuccessfulTxView } from "@/components/wallet/SuccessfulTxView";
import { SlideToConfirm } from "@/design/components/SlideToConfirm";
import { colors, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

/** InvoicePayView — public pay flow: slide to send USDsui to the issuer, settle. */
export default function InvoicePayScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [payErr, setPayErr] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);

  useEffect(() => {
    if (!id) return;
    invoicesApi
      .detail(id)
      .then((r) => setInvoice(r.invoice))
      .catch((e) => setLoadErr(moneyErrorCopy(e, "Couldn't load this invoice right now.")));
  }, [id]);

  const pay = async () => {
    if (!invoice) return;
    setPayErr(null);
    try {
      await invoicesApi.pay(invoice.id, invoice.issuer.address, invoice.amountUsd);
      setPaid(true);
    } catch (e) {
      setPayErr(moneyErrorCopy(e, "Couldn't pay this invoice right now."));
    }
  };

  if (paid) return <SuccessfulTxView title="Invoice paid" onDone={() => router.back()} />;

  const issuerName = invoice?.issuer.name || invoice?.issuer.handle;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.md, padding: spacing.xl, gap: 22, flexGrow: 1 }}>
        <FlowHeader eyebrow="Pay invoice" title="Amount due" onClose={() => router.back()} />

        {invoice === null ? (
          loadErr ? <Text style={styles.err}>{loadErr}</Text> : <ActivityIndicator color={colors.fgMuted} style={{ marginTop: spacing.xxl }} />
        ) : (
          <View style={styles.body}>
            <Text style={styles.hero} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.4}>{fmtUsd(invoice.amountUsd)}</Text>
            {issuerName ? <Text style={styles.sub}>To {issuerName}</Text> : null}
            {invoice.memo ? <Text style={styles.memo}>{invoice.memo}</Text> : null}
            {invoice.status !== "open" ? <Text style={styles.closed}>This invoice is {invoice.status}.</Text> : null}
          </View>
        )}
      </ScrollView>

      {invoice && invoice.status === "open" ? (
        <View style={[styles.slideWrap, { paddingBottom: insets.bottom + spacing.md }]}>
          {payErr ? <Text style={[styles.err, { textAlign: "center", marginBottom: spacing.md }]}>{payErr}</Text> : null}
          <SlideToConfirm title="Slide to pay" tint={colors.accent} onConfirm={pay} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingVertical: spacing.xxxl },
  hero: { fontFamily: family.sans, fontSize: 64, fontWeight: "500", color: colors.fg, letterSpacing: -2 },
  sub: { fontFamily: family.sans, fontSize: 16, color: colors.fgMuted, marginTop: spacing.sm },
  memo: { fontFamily: family.sans, fontSize: 14, color: colors.fgDim, textAlign: "center" },
  closed: { fontFamily: family.sans, fontSize: 14, color: colors.warmGold, marginTop: spacing.md },
  err: { fontFamily: family.sans, fontSize: 13, color: colors.danger },
  slideWrap: { paddingHorizontal: spacing.xl, paddingTop: spacing.md },
});
