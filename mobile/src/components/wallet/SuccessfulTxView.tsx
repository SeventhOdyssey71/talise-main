import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from "react-native-reanimated";

import { TaliseButton } from "@/design/components/TaliseButton";
import { Icon } from "@/design/Icon";
import { colors, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

/**
 * Shared success screen — a green check ring that springs in, a title, and an
 * optional amount/subtitle. Ports ios SuccessfulTxView (used across Send,
 * swaps, cash-out, goals).
 */
export function SuccessfulTxView({
  title,
  subtitle,
  amountText,
  onDone,
}: {
  title: string;
  subtitle?: string;
  amountText?: string;
  onDone: () => void;
}) {
  const scale = useSharedValue(0.6);
  const opacity = useSharedValue(0);
  useEffect(() => {
    scale.value = withSpring(1, { damping: 12, stiffness: 140 });
    opacity.value = withDelay(150, withTiming(1, { duration: 250 }));
  }, [scale, opacity]);

  const ringStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const checkStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <View style={styles.screen}>
      <View style={styles.center}>
        <Animated.View style={[styles.ring, ringStyle]}>
          <Animated.View style={checkStyle}>
            <Icon name="checkmark" size={38} color={colors.accent} />
          </Animated.View>
        </Animated.View>
        {amountText ? <Text style={styles.amount}>{amountText}</Text> : null}
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.sub}>{subtitle}</Text> : null}
      </View>
      <View style={styles.footer}>
        <TaliseButton title="Done" variant="primary" size="lg" onPress={onDone} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: spacing.xl },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg },
  ring: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: "rgba(121,217,108,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  amount: { fontFamily: family.sans, fontSize: 34, fontWeight: "500", color: colors.fg, letterSpacing: -1, marginTop: spacing.md },
  title: { fontFamily: family.sans, fontSize: 24, fontWeight: "500", color: colors.fg, letterSpacing: -0.5 },
  sub: { fontFamily: family.sans, fontSize: 14, color: colors.fgMuted, textAlign: "center" },
  footer: { paddingBottom: spacing.sm },
});
