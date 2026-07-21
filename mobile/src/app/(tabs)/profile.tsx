import { useEffect, useState } from "react";
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import * as Clipboard from "expo-clipboard";

import { profileApi, kycLabel, type BridgeKycStatus, type MeDTO } from "@/api/profile";
import { rewardsApi, type RewardsSummary } from "@/api/rewards";
import { useSession } from "@/auth/session";
import { Eyebrow } from "@/design/components/text";
import { Icon } from "@/design/Icon";
import { colors, spacing } from "@/design/tokens";
import { family } from "@/design/typography";
import { shortAddr } from "@/lib/format";

const ROSE = "#E08D8A";

/** ProfileView — the Profile tab root. Identity, stats, wallet, security, help. */
export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, signOut } = useSession();
  const [me, setMe] = useState<MeDTO | null>(null);
  const [rewards, setRewards] = useState<RewardsSummary | null>(null);
  const [kyc, setKyc] = useState<BridgeKycStatus | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    profileApi.me().then(setMe).catch(() => {});
    rewardsApi.summary().then(setRewards).catch(() => {});
    profileApi.kycStatus().then(setKyc).catch(() => {});
  }, []);

  const u = me ?? user;
  const address = u?.suiAddress ?? "";
  const handle = me?.taliseHandle ?? user?.handle ?? null;
  const initials = (handle ?? u?.name ?? u?.email ?? "·").trim().charAt(0).toUpperCase();
  const kycStatus = kyc?.status ?? "unverified";

  const copyAddr = async () => { await Clipboard.setStringAsync(address); setCopied(true); setTimeout(() => setCopied(false), 1500); };

  const confirmSignOut = () =>
    Alert.alert("Sign out?", "Your wallet stays safe. Sign back in anytime.", [
      { text: "Stay signed in", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => void signOut() },
    ]);

  const confirmDelete = () =>
    Alert.alert("Delete your account?", "Your wallet is self-custodial — withdraw or transfer your balance first. You'll need a new account to use it here again.", [
      { text: "Keep my account", style: "cancel" },
      { text: "Delete account", style: "destructive", onPress: async () => { try { await profileApi.deleteAccount(); } finally { void signOut(); } } },
    ]);

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.md, paddingHorizontal: 24, paddingBottom: 140, gap: 22 }} showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <LinearGradient colors={["#3A6E2A", "#224417"]} style={styles.hero}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{initials}</Text></View>
          <Text style={styles.name}>{u?.name ?? "—"}</Text>
          {handle ? (
            <View style={styles.handlePill}>
              <Icon name="checkmark.seal.fill" size={11} color={colors.greenMint} />
              <Text style={styles.handleText}>{handle}@talise</Text>
            </View>
          ) : null}
          <Text style={styles.email}>{u?.email?.includes("privaterelay.appleid.com") ? "Signed in with Apple · private email" : u?.email ?? ""}</Text>
        </LinearGradient>

        {/* Stats */}
        <View style={styles.stats}>
          <Stat label="KYC" value={kycLabel(kycStatus)} accent={kycStatus === "approved"} />
          <View style={styles.statDiv} />
          <Stat label="Rewards" value={rewards?.tier?.label ?? "Bronze"} accent={(rewards?.tier?.label ?? "Bronze") !== "Bronze"} />
          <View style={styles.statDiv} />
          <Stat label="Points" value={String(rewards?.pointsTotal ?? 0)} accent={(rewards?.pointsTotal ?? 0) > 0} />
        </View>

        {/* Wallet */}
        <Section title="Wallet">
          <View style={styles.addrRow}><Text style={styles.addr} numberOfLines={1}>{address || "—"}</Text></View>
          <View style={styles.divider} />
          <View style={styles.walletActions}>
            <Pressable style={styles.pill} onPress={copyAddr}>
              <Icon name={copied ? "checkmark" : "doc.on.doc"} size={12} color={colors.accent} />
              <Text style={styles.pillText}>{copied ? "Copied" : "Copy"}</Text>
            </Pressable>
            <Pressable style={styles.pill} onPress={() => Linking.openURL(`https://suiscan.xyz/mainnet/account/${address}`)}>
              <Icon name="arrow.up.right.square" size={12} color={colors.accent} />
              <Text style={styles.pillText}>Suiscan</Text>
            </Pressable>
          </View>
        </Section>

        {/* Cash out / verification */}
        <Section title="Cash out">
          <Row icon="checkmark.shield" label="Identity verification" trailing={kycLabel(kycStatus)} trailingAccent={kycStatus === "approved"} onPress={() => router.push("/verify-identity")} />
        </Section>

        {/* Security */}
        <Section title="Security">
          <Row icon="lock.fill" label="Change app PIN" onPress={() => router.push("/change-pin")} />
        </Section>

        {/* Help */}
        <Section title="Help">
          <Row icon="info.circle" label="Support" onPress={() => Linking.openURL("mailto:support@talise.io?subject=Talise support")} />
          <View style={styles.divider} />
          <Row icon="lock.fill" label="Privacy Policy" onPress={() => Linking.openURL("https://talise.io/privacy")} />
          <View style={styles.divider} />
          <Row icon="doc.text" label="Terms of Service" onPress={() => Linking.openURL("https://talise.io/terms")} />
        </Section>

        <Pressable style={styles.signOut} onPress={confirmSignOut}>
          <Icon name="rectangle.portrait.and.arrow.right" size={14} color={ROSE} />
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
        <Pressable style={styles.delete} onPress={confirmDelete}><Text style={styles.deleteText}>Delete account</Text></Pressable>
        <Text style={styles.version}>Talise · v1.0.0</Text>
      </ScrollView>
    </View>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={styles.stat}>
      <Eyebrow>{label}</Eyebrow>
      <Text style={[styles.statValue, accent && { color: colors.accent }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: spacing.md }}>
      <Eyebrow>{title}</Eyebrow>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function Row({ icon, label, trailing, trailingAccent, onPress }: { icon: string; label: string; trailing?: string; trailingAccent?: boolean; onPress?: () => void }) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <Icon name={icon} size={14} color={colors.fgMuted} />
      <Text style={styles.rowLabel}>{label}</Text>
      {trailing ? <Text style={[styles.rowTrailing, trailingAccent && { color: colors.greenMint }]}>{trailing}</Text> : null}
      <Icon name="chevron.right" size={11} color={colors.fgDim} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  hero: { borderRadius: 26, alignItems: "center", paddingVertical: 26, paddingHorizontal: 20, gap: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.08)" },
  avatar: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "rgba(255,255,255,0.25)" },
  avatarText: { fontFamily: family.sans, fontSize: 32, fontWeight: "500", color: colors.fg },
  name: { fontFamily: family.sans, fontSize: 21, fontWeight: "600", color: "#fff", letterSpacing: -0.5 },
  handlePill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  handleText: { fontFamily: family.mono, fontSize: 12, color: "rgba(255,255,255,0.9)" },
  email: { fontFamily: family.mono, fontSize: 11, fontWeight: "300", color: "rgba(255,255,255,0.6)" },
  stats: { flexDirection: "row", backgroundColor: colors.surface, borderRadius: 20, paddingVertical: 14 },
  stat: { flex: 1, alignItems: "center", gap: 6 },
  statDiv: { width: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginVertical: 12 },
  statValue: { fontFamily: family.sans, fontSize: 14, fontWeight: "500", color: colors.fg },
  card: { backgroundColor: colors.surface, borderRadius: 20, overflow: "hidden" },
  addrRow: { paddingHorizontal: 18, paddingVertical: 14 },
  addr: { fontFamily: family.mono, fontSize: 12, fontWeight: "300", color: colors.fg },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginHorizontal: 18 },
  walletActions: { flexDirection: "row", gap: 10, paddingHorizontal: 18, paddingVertical: 12 },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.surface2, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  pillText: { fontFamily: family.sans, fontSize: 13, fontWeight: "500", color: colors.fg },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingVertical: 14 },
  rowLabel: { flex: 1, fontFamily: family.sans, fontSize: 14, fontWeight: "300", color: colors.fg },
  rowTrailing: { fontFamily: family.mono, fontSize: 11, color: colors.fgMuted },
  signOut: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 50, borderRadius: 25, backgroundColor: colors.surface2 },
  signOutText: { fontFamily: family.sans, fontSize: 15, fontWeight: "500", color: ROSE },
  delete: { alignItems: "center", justifyContent: "center", height: 32 },
  deleteText: { fontFamily: family.sans, fontSize: 13, color: colors.fgDim, textDecorationLine: "underline" },
  version: { fontFamily: family.mono, fontSize: 10, letterSpacing: 1, color: colors.fgDim, textAlign: "center" },
});
