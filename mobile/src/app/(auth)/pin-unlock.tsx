import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import * as LocalAuthentication from "expo-local-authentication";

import { requireUserPresence } from "@/auth/biometrics";
import { useSession } from "@/auth/session";
import { PinPad } from "@/components/PinPad";
import { TopGlow } from "@/design/components/TopGlow";
import { colors } from "@/design/tokens";
import { family } from "@/design/typography";

/**
 * PinUnlockView — the live unlock (.locked phase). PIN or biometrics resumes the
 * session (no OAuth). Biometrics is attempted automatically on mount; "Forgot
 * PIN? Sign in again" appears after 2 failed attempts. TopGlow background.
 */
export default function PinUnlockScreen() {
  const { user, verifyAndUnlock, unlock, signOut } = useSession();
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [bioAvailable, setBioAvailable] = useState(false);

  const first = user?.name?.trim().split(/\s+/)[0];

  const tryBiometrics = async () => {
    try {
      await requireUserPresence("Unlock Talise");
      unlock();
    } catch {
      /* fall back to PIN */
    }
  };

  useEffect(() => {
    (async () => {
      const has = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (has && enrolled) {
        setBioAvailable(true);
        void tryBiometrics();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (value.length < 4) return;
    (async () => {
      const ok = await verifyAndUnlock(value);
      if (ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setError(true);
        setAttempts((a) => a + 1);
        setTimeout(() => {
          setValue("");
          setError(false);
        }, 550);
      }
    })();
  }, [value, verifyAndUnlock]);

  return (
    <View style={styles.screen}>
      <TopGlow />
      <View style={styles.content}>
        <View style={{ height: 44 }} />
        <View style={styles.header}>
          <Text style={styles.title}>Welcome back</Text>
          <Text style={styles.sub}>{first ? `Enter your PIN, ${first}` : "Enter your PIN to continue"}</Text>
        </View>
        <View style={{ height: 34 }} />
        <PinPad
          value={value}
          onChange={setValue}
          error={error}
          bottomLeftIcon={bioAvailable ? "faceid" : undefined}
          onBottomLeftPress={tryBiometrics}
        />
        <Text style={styles.error}>{error ? "Incorrect PIN" : " "}</Text>
        <View style={{ flex: 1 }} />
        {attempts >= 2 ? (
          <Pressable onPress={() => void signOut()} style={styles.forgot} hitSlop={8}>
            <Text style={styles.forgotText}>Forgot PIN? Sign in again</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1, alignItems: "center", paddingHorizontal: 8, paddingTop: 60 },
  header: { alignItems: "center", gap: 8 },
  title: { fontFamily: family.sans, fontSize: 27, fontWeight: "600", color: colors.fg },
  sub: { fontFamily: family.sans, fontSize: 15, fontWeight: "300", color: colors.fgMuted },
  error: { fontFamily: family.sans, fontSize: 14, color: colors.danger, marginTop: 14, height: 20 },
  forgot: { paddingVertical: 14, marginBottom: 24 },
  forgotText: { fontFamily: family.sans, fontSize: 14, color: colors.fgMuted, fontWeight: "500" },
});
