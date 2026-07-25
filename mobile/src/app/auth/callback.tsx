import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { colors } from "@/design/tokens";
import { family } from "@/design/typography";

/**
 * OAuth deep-link landing (talise://auth/callback?token…). The SessionProvider's
 * deep-link listener reads the token and completes sign-in; this screen just
 * shows a spinner until the phase machine redirects to onboarding / PIN / home.
 */
export default function AuthCallbackScreen() {
  return (
    <View style={styles.screen}>
      <ActivityIndicator color={colors.accent} />
      <Text style={styles.txt}>Signing you in…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", gap: 14 },
  txt: { fontFamily: family.sans, fontSize: 15, color: colors.fgMuted },
});
