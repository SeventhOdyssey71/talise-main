import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

import { pinService } from "@/auth/pin";
import { useSession } from "@/auth/session";
import { PinPad } from "@/components/PinPad";
import { TopGlow } from "@/design/components/TopGlow";
import { colors, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

/** ChangePinView — verify current → enter new → confirm. Fully local (no network). */
type Step = "verify" | "enter" | "confirm";

export default function ChangePinScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useSession();
  const [hasPin, setHasPin] = useState<boolean | null>(null);
  const [step, setStep] = useState<Step>("verify");
  const [value, setValue] = useState("");
  const [first, setFirst] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);

  useEffect(() => {
    if (!user) return;
    pinService.hasPin(user.id).then((h) => { setHasPin(h); setStep(h ? "verify" : "enter"); });
  }, [user]);

  useEffect(() => {
    if (value.length < 4 || !user) return;
    (async () => {
      if (step === "verify") {
        if (await pinService.verifyPin(user.id, value)) { setStep("enter"); setValue(""); }
        else fail("Incorrect PIN");
      } else if (step === "enter") {
        setFirst(value); setValue(""); setStep("confirm");
      } else {
        if (value === first) {
          try { await pinService.setPin(user.id, value); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); router.back(); }
          catch { fail("Couldn't save PIN. Try again."); }
        } else { fail("PINs didn't match"); setStep("enter"); }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const fail = (msg: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    setError(msg); setShake(true);
    setTimeout(() => { setValue(""); setError(null); setShake(false); }, 550);
  };

  const title = step === "verify" ? "Enter current PIN" : step === "enter" ? "Choose a new PIN" : "Confirm your PIN";
  const sub = step === "verify" ? "Confirm it's you" : step === "enter" ? "Pick 4 digits you'll remember" : "Enter the same 4 digits again";

  if (hasPin === null) return <View style={styles.screen} />;

  return (
    <View style={styles.screen}>
      <TopGlow />
      <View style={[styles.content, { paddingTop: insets.top + 40 }]}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.sub}>{sub}</Text>
        <View style={{ height: 32 }} />
        <PinPad value={value} onChange={setValue} error={shake} />
        <Text style={styles.error}>{error ?? " "}</Text>
        <View style={{ flex: 1 }} />
        <Pressable style={styles.cancel} onPress={() => router.back()}><Text style={styles.cancelText}>Cancel</Text></Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1, alignItems: "center", paddingHorizontal: 8, paddingBottom: spacing.lg },
  title: { fontFamily: family.sans, fontSize: 24, fontWeight: "600", color: colors.fg },
  sub: { fontFamily: family.sans, fontSize: 14, fontWeight: "300", color: colors.fgMuted, marginTop: 8 },
  error: { fontFamily: family.sans, fontSize: 14, color: colors.danger, marginTop: 14, height: 20 },
  cancel: { paddingVertical: 14 },
  cancelText: { fontFamily: family.sans, fontSize: 15, color: colors.fgMuted, fontWeight: "500" },
});
