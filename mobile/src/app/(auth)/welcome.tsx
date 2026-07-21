import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { AuthCancelled } from "@/auth/oauth";
import { prefs } from "@/auth/prefs";
import { useSession } from "@/auth/session";
import { Img } from "@/design/assets";
import { OnboardingBackground } from "@/design/components/OnboardingBackground";
import { Screen } from "@/design/components/Screen";
import { Icon } from "@/design/Icon";
import { colors, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

/**
 * SignInScreen — the app's entry (ios SignInScreen.swift, the live onboarding
 * entry point). Copy branches on whether the user has signed in before. Apple
 * sign-in is iOS-only; on Android we show Google (server-mediated zkLogin).
 */
export default function WelcomeScreen() {
  const { signIn } = useSession();
  const [returning, setReturning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    prefs.getHasSignedIn().then(setReturning);
  }, []);

  const onGoogle = async () => {
    setError(null);
    setBusy(true);
    try {
      await signIn();
      await prefs.setHasSignedIn();
    } catch (e) {
      if (!(e instanceof AuthCancelled)) setError(e instanceof Error ? e.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <OnboardingBackground />
      <Screen scroll={false} tabBarSpace={false}>
        <View style={styles.top} />
        <View style={styles.hero}>
          <Img name="TaliseLogo" style={styles.logo} />
          <Text style={styles.title}>{returning ? "Welcome back" : "Welcome to Talise"}</Text>
          <Text style={styles.subtitle}>
            {returning ? "Sign in to your Talise account." : "One tap with Apple or Google.\nNo seed phrase, no setup."}
          </Text>
        </View>
        <View style={styles.bottom}>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {Platform.OS === "ios" ? (
            <Pressable style={styles.pill} disabled={busy}>
              <Icon name="apple.logo" size={19} color={colors.bg} />
              <Text style={styles.pillLabel}>Sign in with Apple</Text>
            </Pressable>
          ) : null}
          <Pressable style={styles.pill} onPress={onGoogle} disabled={busy}>
            {busy ? (
              <ActivityIndicator size="small" color={colors.bg} />
            ) : (
              <>
                <Img name="GoogleG" style={styles.gIcon} />
                <Text style={styles.pillLabel}>Continue with Google</Text>
              </>
            )}
          </Pressable>
          <Text style={styles.legal}>
            By continuing you agree to our{" "}
            <Text style={styles.link} onPress={() => Linking.openURL("https://talise.io/terms")}>
              Terms
            </Text>{" "}
            and{" "}
            <Text style={styles.link} onPress={() => Linking.openURL("https://talise.io/privacy")}>
              Privacy
            </Text>
            .
          </Text>
        </View>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { height: 70 },
  hero: { flex: 1, alignItems: "center", justifyContent: "center" },
  logo: { width: 96, height: 96, resizeMode: "contain" },
  title: {
    fontFamily: family.sans,
    fontSize: 26,
    fontWeight: "600",
    color: colors.fg,
    marginTop: 28,
    letterSpacing: -0.78,
  },
  subtitle: {
    fontFamily: family.sans,
    fontSize: 14,
    fontWeight: "300",
    color: colors.fgMuted,
    textAlign: "center",
    marginTop: 10,
    paddingHorizontal: spacing.xxl,
    lineHeight: 20,
  },
  bottom: { gap: spacing.md, paddingBottom: 28 },
  error: { fontFamily: family.sans, fontSize: 13, color: colors.danger, textAlign: "center" },
  pill: {
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.fg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  pillLabel: { fontFamily: family.sans, fontSize: 15, fontWeight: "500", color: colors.bg },
  gIcon: { width: 20, height: 20, resizeMode: "contain" },
  legal: {
    fontFamily: family.sans,
    fontSize: 11,
    fontWeight: "300",
    color: colors.fgDim,
    textAlign: "center",
    marginTop: 12,
    lineHeight: 16,
  },
  link: { color: colors.greenMint },
});
