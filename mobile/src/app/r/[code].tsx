import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";

import { colors } from "@/design/tokens";
import { family } from "@/design/typography";
import { capturePendingReferral, reportInviteClicked } from "@/lib/referral";

/**
 * Invite deep-link landing: `https://www.talise.io/r/<CODE>` (a verified App
 * Link, see web/app/.well-known/assetlinks.json) or `talise://r/<CODE>`.
 *
 * Two jobs, both side effects: stash the inviter's code for the next sign-in,
 * and report the click so the funnel still has a numerator for users who have
 * the app installed (the web `/r/` handler never runs for them).
 *
 * This screen intentionally does not navigate. `RootNav` in app/_layout.tsx
 * replaces the route as soon as the session phase resolves (welcome when signed
 * out, tabs when signed in), which is exactly where an invite should land. The
 * spinner just covers the handful of frames until that happens, and stops the
 * deep link from flashing expo-router's "Unmatched Route" screen.
 *
 * Capture also runs in the SessionProvider deep-link listener, so an invite
 * arriving while the app is already warm is handled even if this screen is
 * never mounted. Both paths are idempotent.
 */
export default function ReferralLinkScreen() {
  const { code } = useLocalSearchParams<{ code?: string }>();

  useEffect(() => {
    (async () => {
      const stored = await capturePendingReferral(typeof code === "string" ? code : null);
      if (stored) reportInviteClicked(stored);
    })();
  }, [code]);

  return (
    <View style={styles.screen}>
      <ActivityIndicator color={colors.accent} />
      <Text style={styles.txt}>Opening your invite…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", gap: 14 },
  txt: { fontFamily: family.sans, fontSize: 15, color: colors.fgMuted },
});
