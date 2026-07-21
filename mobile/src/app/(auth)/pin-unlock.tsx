import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useSession } from "@/auth/session";
import { PinPad } from "@/components/PinPad";
import { Img } from "@/design/assets";
import { Screen } from "@/design/components/Screen";
import { TopGlow } from "@/design/components/TopGlow";
import { colors, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

/** Unlock — verify PIN to resume the session; "Forgot PIN?" signs out. Ports ios PinUnlockView. */
export default function PinUnlockScreen() {
  const { user, verifyAndUnlock, signOut } = useSession();
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    if (value.length < 4) return;
    (async () => {
      const ok = await verifyAndUnlock(value);
      if (!ok) {
        setError(true);
        setTimeout(() => {
          setValue("");
          setError(false);
        }, 500);
      }
    })();
  }, [value, verifyAndUnlock]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <TopGlow />
      <Screen scroll={false} tabBarSpace={false}>
        <View style={styles.head}>
          <Img name="TaliseLogo" style={styles.logo} />
          <Text style={styles.title}>Welcome back{user?.name ? `, ${user.name.split(" ")[0]}` : ""}</Text>
          <Text style={styles.sub}>Enter your PIN to continue.</Text>
        </View>
        <View style={styles.body}>
          <PinPad value={value} onChange={setValue} error={error} />
        </View>
        <Pressable onPress={() => void signOut()} style={styles.forgot} hitSlop={8}>
          <Text style={styles.forgotText}>Forgot PIN? Sign out</Text>
        </Pressable>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { alignItems: "center", gap: spacing.sm, marginTop: spacing.xl },
  logo: { width: 108, height: 28, resizeMode: "contain", marginBottom: spacing.sm },
  title: { fontFamily: family.sans, fontSize: 22, fontWeight: "600", color: colors.fg },
  sub: { fontFamily: family.sans, fontSize: 14, color: colors.fgMuted },
  body: { flex: 1, justifyContent: "center", alignItems: "center" },
  forgot: { alignSelf: "center", paddingVertical: spacing.md },
  forgotText: { fontFamily: family.sans, fontSize: 13, color: colors.fgMuted, fontWeight: "500" },
});
