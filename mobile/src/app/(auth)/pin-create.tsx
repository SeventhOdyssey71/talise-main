import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";

import { useSession } from "@/auth/session";
import { PinPad } from "@/components/PinPad";
import { Img } from "@/design/assets";
import { TopGlow } from "@/design/components/TopGlow";
import { colors } from "@/design/tokens";
import { family } from "@/design/typography";

/**
 * PinCreateView — the live PIN setup (.pinSetup phase). Two steps: create →
 * confirm; auto-advances on the 4th digit; success haptic on match, error haptic
 * + shake + reset on mismatch. TopGlow background.
 */
export default function PinCreateScreen() {
  const { setPinAndReady } = useSession();
  const [stage, setStage] = useState<"create" | "confirm">("create");
  const [first, setFirst] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);

  useEffect(() => {
    if (value.length < 4) return;
    if (stage === "create") {
      setFirst(value);
      setValue("");
      setStage("confirm");
    } else if (value === first) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      void setPinAndReady(value);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError("PINs didn't match — start again");
      setShake(true);
      setTimeout(() => {
        setValue("");
        setFirst("");
        setStage("create");
        setError(null);
        setShake(false);
      }, 550);
    }
  }, [value, stage, first, setPinAndReady]);

  return (
    <View style={styles.screen}>
      <TopGlow />
      <View style={styles.content}>
        <View style={{ height: 40 }} />
        <Img name="TaliseLogo" style={styles.logo} />
        <View style={styles.header}>
          <Text style={styles.title}>{stage === "create" ? "Create a PIN" : "Confirm your PIN"}</Text>
          <Text style={styles.sub}>
            {stage === "create" ? "Set a 4-digit PIN to unlock Talise quickly." : "Enter the same 4 digits again."}
          </Text>
        </View>
        <View style={{ height: 32 }} />
        <PinPad value={value} onChange={setValue} error={shake} />
        <Text style={styles.error}>{error ?? " "}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1, alignItems: "center", paddingHorizontal: 8, paddingTop: 60 },
  logo: { width: 120, height: 32, resizeMode: "contain" },
  header: { alignItems: "center", gap: 8, marginTop: 22 },
  title: { fontFamily: family.sans, fontSize: 26, fontWeight: "600", color: colors.fg },
  sub: { fontFamily: family.sans, fontSize: 15, fontWeight: "300", color: colors.fgMuted, textAlign: "center" },
  error: { fontFamily: family.sans, fontSize: 14, color: colors.danger, marginTop: 14, height: 20 },
});
