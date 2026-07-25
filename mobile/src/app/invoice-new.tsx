import { useState } from "react";
import { ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { invoicesApi } from "@/api/invoices";
import { moneyErrorCopy } from "@/api/money";
import { FlowHeader } from "@/components/wallet/FlowHeader";
import { LabeledField, FieldInput } from "@/components/wallet/FormField";
import { TaliseButton } from "@/design/components/TaliseButton";
import { colors, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

/** InvoiceCreateView — bill a client, then share the pay link. */
export default function InvoiceNewScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [raw, setRaw] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const amountUsd = parseFloat(raw) || 0;
  const disabled = amountUsd < 0.01;

  const create = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await invoicesApi.create({
        amountUsd,
        customerName: customerName.trim() || undefined,
        memo: memo.trim() || undefined,
      });
      if (r.payUrl) { try { await Share.share({ message: r.payUrl }); } catch { /* dismissed */ } }
      router.back();
    } catch (e) { setErr(moneyErrorCopy(e, "Couldn't create the invoice right now.")); }
    finally { setBusy(false); }
  };

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.md, padding: spacing.xl, gap: 22 }}>
        <FlowHeader eyebrow="New invoice" title="Bill a client" onClose={() => router.back()} />

        <LabeledField label="Amount (USDsui)">
          <FieldInput value={raw} onChangeText={setRaw} keyboardType="decimal-pad" placeholder="0.00" />
        </LabeledField>

        <LabeledField label="Bill to (optional)">
          <FieldInput value={customerName} onChangeText={setCustomerName} placeholder="Client name" />
        </LabeledField>

        <LabeledField label="Memo (optional)">
          <FieldInput value={memo} onChangeText={setMemo} placeholder="What's it for?" />
        </LabeledField>

        {err ? <Text style={styles.err}>{err}</Text> : null}

        <TaliseButton
          title={busy ? "Creating…" : "Create invoice"}
          variant="primary"
          size="lg"
          loading={busy}
          disabled={disabled}
          onPress={create}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  err: { fontFamily: family.sans, fontSize: 13, color: colors.danger },
});
