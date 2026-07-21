import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useSession } from "@/auth/session";
import { PinPad } from "@/components/PinPad";
import { Screen } from "@/design/components/Screen";
import { TopGlow } from "@/design/components/TopGlow";
import { colors, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

/** Create PIN — enter, then confirm. Ports ios PinCreateView (visual refined in Phase 3). */
export default function PinCreateScreen() {
  const { setPinAndReady } = useSession();
  const [stage, setStage] = useState<"enter" | "confirm">("enter");
  const [first, setFirst] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    if (value.length < 4) return;
    if (stage === "enter") {
      setFirst(value);
      setValue("");
      setStage("confirm");
    } else {
      if (value === first) {
        void setPinAndReady(value);
      } else {
        setError(true);
        setTimeout(() => {
          setValue("");
          setError(false);
          setStage("enter");
          setFirst("");
        }, 500);
      }
    }
  }, [value, stage, first, setPinAndReady]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <TopGlow />
      <Screen scroll={false} tabBarSpace={false}>
        <View style={styles.head}>
          <Text style={styles.title}>{stage === "enter" ? "Create a PIN" : "Confirm your PIN"}</Text>
          <Text style={styles.sub}>
            {stage === "enter" ? "Set a 4-digit PIN to secure your wallet." : "Enter it again to confirm."}
          </Text>
        </View>
        <View style={styles.body}>
          <PinPad value={value} onChange={setValue} error={error} />
        </View>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { alignItems: "center", gap: spacing.sm, marginTop: spacing.xxl },
  title: { fontFamily: family.sans, fontSize: 24, fontWeight: "600", color: colors.fg },
  sub: { fontFamily: family.sans, fontSize: 14, color: colors.fgMuted, textAlign: "center" },
  body: { flex: 1, justifyContent: "center", alignItems: "center" },
});
