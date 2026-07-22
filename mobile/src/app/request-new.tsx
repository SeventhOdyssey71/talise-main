import { useState } from "react";
import { ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";

import { requestsApi } from "@/api/requests";
import { fmtUsd, moneyErrorCopy } from "@/api/money";
import { FlowHeader } from "@/components/wallet/FlowHeader";
import { LabeledField, FieldInput } from "@/components/wallet/FormField";
import { TaliseButton } from "@/design/components/TaliseButton";
import { SectionHeader } from "@/design/components/text";
import { Icon } from "@/design/Icon";
import { colors, radius, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

/** RequestCreateView — create a request, then share the pay link / QR. */
export default function RequestNewScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [raw, setRaw] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [share, setShare] = useState<{ amountUsd: number; note?: string; payUrl: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const amountUsd = parseFloat(raw) || 0;
  const disabled = amountUsd <= 0;

  const create = async () => {
    setBusy(true); setErr(null);
    try {
      const trimmed = note.trim() || undefined;
      const r = await requestsApi.create({ amountUsd, note: trimmed });
      setShare({ amountUsd: r.request.amountUsd, note: r.request.requesterNote ?? trimmed, payUrl: r.payUrl });
    } catch (e) { setErr(moneyErrorCopy(e, "Couldn't create the request right now.")); }
    finally { setBusy(false); }
  };

  const copy = async () => {
    if (!share) return;
    await Clipboard.setStringAsync(share.payUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (share) {
    return (
      <View style={styles.screen}>
        <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.md, padding: spacing.xl, gap: 22 }}>
          <SectionHeader style={{ marginBottom: 4 }}>Requesting</SectionHeader>
          <Text style={styles.hero} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.4}>{fmtUsd(share.amountUsd)}</Text>
          {share.note ? <Text style={styles.shareNote}>{share.note}</Text> : null}

          <View style={styles.qrCard}>
            <View style={styles.qrSquare}>
              <Icon name="qrcode" size={120} color={colors.fg} />
            </View>
            <Text style={styles.linkText} numberOfLines={1} ellipsizeMode="middle">{stripLink(share.payUrl)}</Text>
          </View>

          <View style={{ gap: spacing.md }}>
            <TaliseButton title={copied ? "Copied" : "Copy link"} variant="secondary" size="lg" icon={copied ? "checkmark" : "doc.on.doc"} onPress={copy} />
            <TaliseButton title="Share" variant="primary" size="lg" icon="square.and.arrow.up" onPress={() => Share.share({ message: share.payUrl })} />
            <TaliseButton title="Done" variant="ghost" size="lg" onPress={() => router.back()} />
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.md, padding: spacing.xl, gap: 22 }}>
        <View>
          <SectionHeader style={{ marginBottom: 4 }}>Request</SectionHeader>
          <FlowHeader title="Request money" onClose={() => router.back()} />
        </View>
        <Text style={styles.lede}>Ask anyone for a set amount. Share a link or QR — they pay you straight to your wallet.</Text>

        <LabeledField label="Amount">
          <FieldInput value={raw} onChangeText={setRaw} keyboardType="decimal-pad" placeholder="20.00" />
        </LabeledField>

        <LabeledField label="Note (optional)">
          <FieldInput value={note} onChangeText={setNote} placeholder="e.g. Dinner last night" />
        </LabeledField>

        {err ? <Text style={styles.err}>{err}</Text> : null}

        <View style={{ gap: spacing.sm }}>
          <TaliseButton title={busy ? "Creating…" : "Create request"} variant="primary" size="lg" loading={busy} disabled={disabled} onPress={create} />
          <Text style={styles.helper}>You&apos;ll get a link anyone can open to pay you — no app required.</Text>
        </View>
      </ScrollView>
    </View>
  );
}

/** Strip scheme + leading www. for a cleaner display link. */
function stripLink(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/^www\./, "");
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  lede: { fontFamily: family.sans, fontSize: 14, color: colors.fgMuted, lineHeight: 20 },
  err: { fontFamily: family.sans, fontSize: 13, color: colors.danger },
  helper: { fontFamily: family.sans, fontSize: 12.5, color: colors.fgMuted, textAlign: "center", lineHeight: 18 },
  hero: { fontFamily: family.sans, fontSize: 64, fontWeight: "500", color: colors.fg, letterSpacing: -2 },
  shareNote: { fontFamily: family.sans, fontSize: 15, color: colors.fgMuted },
  qrCard: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, padding: spacing.lg, alignItems: "center", gap: spacing.md },
  qrSquare: { width: 200, height: 200, borderRadius: radius.lg, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" },
  linkText: { fontFamily: family.mono, fontSize: 13, color: colors.fgMuted },
});
