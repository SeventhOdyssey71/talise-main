import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { AuthCancelled } from "@/auth/oauth";
import { useSession } from "@/auth/session";
import { Img } from "@/design/assets";
import { GlassButton } from "@/design/components/GlassButton";
import { Screen } from "@/design/components/Screen";
import { TopGlow } from "@/design/components/TopGlow";
import { colors, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

/**
 * Welcome / sign-in — drives the real server-mediated zkLogin (session.signIn()).
 * The full Onboarding module (Splash → Welcome → SignIn carousel) is ported
 * exactly in Phase 3; this is the functional entry point for Phase 2's auth stack.
 */
export default function WelcomeScreen() {
  const { signIn } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onGoogle = async () => {
    setError(null);
    setBusy(true);
    try {
      await signIn();
      // Session phase change routes us onward (onboarding / pinSetup / ready).
    } catch (e) {
      if (!(e instanceof AuthCancelled)) setError(e instanceof Error ? e.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <TopGlow />
      <Screen scroll={false} tabBarSpace={false}>
        <View style={styles.top}>
          <Img name="TaliseLogo" style={styles.logo} />
          <Text style={styles.tagline}>The dollar wallet that moves as freely as messages.</Text>
        </View>
        <View style={styles.bottom}>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <GlassButton title="Continue with Google" tint={colors.greenMint} loading={busy} onPress={onGoogle} />
          <Text style={styles.legal}>Gasless. Non-custodial. Secured with zkLogin.</Text>
        </View>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flex: 1, justifyContent: "center", gap: spacing.lg },
  logo: { width: 132, height: 36, resizeMode: "contain" },
  tagline: { fontFamily: family.sans, fontSize: 20, lineHeight: 27, color: colors.fg, fontWeight: "500", maxWidth: 300 },
  bottom: { gap: spacing.md, paddingBottom: spacing.lg },
  error: { fontFamily: family.sans, fontSize: 13, color: colors.danger, textAlign: "center" },
  legal: { fontFamily: family.sans, fontSize: 12, color: colors.fgDim, textAlign: "center", marginTop: spacing.xs },
});
