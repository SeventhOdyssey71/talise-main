import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from "react-native-reanimated";

import { Img } from "@/design/assets";
import { Icon } from "@/design/Icon";
import { colors } from "@/design/tokens";
import { family } from "@/design/typography";

const MINT = "#B1F49A";

/**
 * Shared success screen — exact from ios SuccessfulTxView. SuccessCoins hero,
 * big mint amount, title, subtitle, optional "Saved" pill, and a Share Receipt /
 * Done button row. Used across Send, swaps, cross-border, goals.
 */
export function SuccessfulTxView({
  title,
  subtitle,
  amountText,
  savedText,
  onShareReceipt,
  onDone,
}: {
  title: string;
  subtitle?: string;
  amountText?: string;
  savedText?: string;
  onShareReceipt?: () => void;
  onDone: () => void;
}) {
  const enter = useSharedValue(0);
  useEffect(() => {
    enter.value = withDelay(80, withSpring(1, { damping: 13, stiffness: 130 }));
  }, [enter]);
  const heroStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ scale: 0.9 + enter.value * 0.1 }, { rotate: `${6 - enter.value * 6}deg` }],
  }));
  const bodyStyle = useAnimatedStyle(() => ({ opacity: enter.value, transform: [{ translateY: (1 - enter.value) * 14 }] }));

  return (
    <View style={styles.screen}>
      <View style={styles.center}>
        <Animated.View style={heroStyle}>
          <Img name="SuccessCoins" style={styles.coins} />
        </Animated.View>
        <Animated.View style={[styles.textBlock, bodyStyle]}>
          {amountText ? <Text style={styles.amount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.4}>{amountText}</Text> : null}
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.sub}>{subtitle}</Text> : null}
          {savedText ? (
            <View style={styles.savedPill}>
              <Img name="SavingsPiggy" style={styles.piggy} />
              <Text style={styles.savedText}>Saved {savedText}</Text>
              <Text style={styles.savedDot}>· Spend + Save</Text>
            </View>
          ) : null}
        </Animated.View>
      </View>
      <View style={styles.buttons}>
        {onShareReceipt ? (
          <Pressable style={styles.share} onPress={onShareReceipt}>
            <Text style={styles.shareText}>Share Receipt</Text>
            <Icon name="square.and.arrow.up" size={12} color="#FFFFFF" />
          </Pressable>
        ) : null}
        <Pressable style={styles.done} onPress={onDone}>
          <Text style={styles.doneText}>Done</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, alignItems: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  coins: { width: 300, height: 235, resizeMode: "contain" },
  textBlock: { alignItems: "center", marginTop: 8 },
  amount: { fontFamily: family.sans, fontSize: 68, fontWeight: "400", color: MINT, letterSpacing: -1.5 },
  title: { fontFamily: family.sans, fontSize: 25, fontWeight: "500", color: MINT, letterSpacing: -0.5, marginTop: 18 },
  sub: { fontFamily: family.mono, fontSize: 13, color: "#FFFFFF", letterSpacing: -0.26, marginTop: 8, textAlign: "center" },
  savedPill: {
    flexDirection: "row", alignItems: "center", gap: 6, marginTop: 18,
    backgroundColor: "rgba(177,244,154,0.12)", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(177,244,154,0.25)",
    borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7,
  },
  piggy: { width: 24, height: 24, resizeMode: "contain" },
  savedText: { fontFamily: family.sans, fontSize: 14, fontWeight: "500", color: MINT, letterSpacing: -0.3 },
  savedDot: { fontFamily: family.mono, fontSize: 11, color: colors.fgDim },
  buttons: { flexDirection: "row", gap: 13, paddingBottom: 40 },
  share: { flexDirection: "row", alignItems: "center", gap: 6, height: 41, paddingHorizontal: 22, borderRadius: 21, backgroundColor: colors.surface2 },
  shareText: { fontFamily: family.sans, fontSize: 15, fontWeight: "500", color: "#FFFFFF", letterSpacing: -0.3 },
  done: { height: 41, paddingHorizontal: 30, borderRadius: 21, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  doneText: { fontFamily: family.sans, fontSize: 15, fontWeight: "500", color: "#000000", letterSpacing: -0.3 },
});
