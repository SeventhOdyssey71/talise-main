import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as WebBrowser from "expo-web-browser";

import { profileApi, kycLabel, type BridgeKycStatus, type KycStatus } from "@/api/profile";
import { FlowHeader } from "@/components/wallet/FlowHeader";
import { TaliseButton } from "@/design/components/TaliseButton";
import { Eyebrow } from "@/design/components/text";
import { Icon } from "@/design/Icon";
import { colors, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

const STATUS_ICON: Record<KycStatus, { name: string; color: string }> = {
  approved: { name: "checkmark.seal.fill", color: colors.greenMint },
  pending: { name: "clock.fill", color: colors.fgMuted },
  rejected: { name: "exclamationmark.triangle.fill", color: "#FF6B6B" },
  expired: { name: "exclamationmark.triangle.fill", color: "#FF6B6B" },
  unverified: { name: "info.circle", color: colors.fgMuted },
};

/** IdentityVerificationView — Bridge KYC status + hosted-flow start. */
export default function VerifyIdentityScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [kyc, setKyc] = useState<BridgeKycStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = () => profileApi.kycStatus().then(setKyc).catch(() => {});
  useEffect(() => { load(); }, []);

  const status = kyc?.status ?? "unverified";
  const si = STATUS_ICON[status];

  const start = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await profileApi.kycStart();
      const url = r.kycUrl ?? r.tosUrl;
      if (url) { await WebBrowser.openBrowserAsync(url); load(); }
      else setErr("Couldn't start verification. Please try again.");
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't start verification. Please try again."); }
    finally { setBusy(false); }
  };

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.md, padding: spacing.xl, gap: 22 }}>
        <FlowHeader title="Identity verification" onClose={() => router.back()} />
        <Text style={styles.lede}>A one-time check that unlocks cashing out to your bank. Your details go straight to our payments partner — Talise never stores them.</Text>

        <View style={styles.card}>
          <Eyebrow>Status</Eyebrow>
          <View style={styles.statusRow}>
            <Icon name={si.name} size={20} color={si.color} />
            <Text style={styles.statusText}>{kycLabel(status)}</Text>
          </View>
        </View>

        {status === "approved" ? (
          <View style={styles.card}>
            <View style={styles.statusRow}><Icon name="checkmark.seal.fill" size={16} color={colors.greenMint} /><Text style={styles.approvedTitle}>You&apos;re verified</Text></View>
            <Text style={styles.body}>Cash-out to your bank is unlocked. You can withdraw from any supported corridor.</Text>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.body}>
              {status === "pending" ? "We're reviewing your details. This usually takes a few minutes. You can close this screen — we'll keep checking."
                : status === "rejected" || status === "expired" ? "Your last attempt didn't go through. You can try again — make sure your name matches your government ID."
                : "You'll verify your identity and accept the terms with our payments partner. Two quick steps in your browser."}
            </Text>
            {err ? <Text style={styles.err}>{err}</Text> : null}
            {status !== "pending" ? (
              <TaliseButton title={busy ? "Preparing…" : status === "rejected" || status === "expired" ? "Try again" : "Verify identity"} variant="primary" size="lg" loading={busy} onPress={start} />
            ) : (
              <TaliseButton title="Refresh status" variant="secondary" size="lg" onPress={load} />
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  lede: { fontFamily: family.sans, fontSize: 14, color: colors.fgMuted, lineHeight: 20 },
  card: { backgroundColor: colors.surface, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, padding: spacing.lg, gap: spacing.md },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusText: { fontFamily: family.sans, fontSize: 16, fontWeight: "500", color: colors.fg },
  approvedTitle: { fontFamily: family.sans, fontSize: 16, fontWeight: "500", color: colors.fg },
  body: { fontFamily: family.sans, fontSize: 14, color: colors.fgMuted, lineHeight: 20 },
  err: { fontFamily: family.sans, fontSize: 13, color: colors.danger },
});
