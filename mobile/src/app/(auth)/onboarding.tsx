import { Pressable, StyleSheet, Text, View } from "react-native";

import { useSession } from "@/auth/session";
import { GlassCard } from "@/design/components/GlassCard";
import { PageHeader } from "@/design/components/PageHeader";
import { Screen } from "@/design/components/Screen";
import { TopGlow } from "@/design/components/TopGlow";
import { Icon } from "@/design/Icon";
import { colors, radius, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

/**
 * Onboarding entry — a new account (accountType == null) lands here. The full
 * KYC flow (country + account type → POST /api/onboarding, Handle picker,
 * Permissions, …) is ported exactly in Phase 3. For now the auth stack routes
 * here correctly; sign-out is available.
 */
export default function OnboardingScreen() {
  const { user, signOut } = useSession();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <TopGlow />
      <Screen>
        <PageHeader eyebrow="Get started" title={`Welcome${user?.name ? `, ${user.name.split(" ")[0]}` : ""}`} />
        <GlassCard cornerRadius={radius.lg} style={styles.card}>
          <View style={styles.iconWrap}>
            <Icon name="checkmark.seal.fill" size={26} color={colors.greenMint} />
          </View>
          <Text style={styles.note}>
            You&apos;re signed in. The onboarding flow (country, account type, handle, permissions) is ported exactly in
            Phase 3.
          </Text>
        </GlassCard>
        <Pressable onPress={() => void signOut()} style={styles.signOut} hitSlop={8}>
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.xl, alignItems: "center", gap: spacing.lg, marginTop: spacing.sm },
  iconWrap: {
    width: 60,
    height: 60,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  note: { color: colors.fgMuted, fontSize: 14, lineHeight: 21, textAlign: "center", fontFamily: family.sans },
  signOut: { alignSelf: "center", paddingVertical: spacing.lg, marginTop: spacing.lg },
  signOutText: { fontFamily: family.sans, fontSize: 13, color: colors.fgMuted, fontWeight: "500" },
});
