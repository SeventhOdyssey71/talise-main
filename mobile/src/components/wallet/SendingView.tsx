import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from "react-native-reanimated";

import { Icon } from "@/design/Icon";
import { TaliseButton } from "@/design/components/TaliseButton";
import { colors, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

/**
 * In-flight sending screen — a fluttering paper plane + shimmer bars, exact copy
 * from ios SendInProgressView / CrossBorderSendingView. Done stays live (the
 * send keeps going in the background).
 */
export function SendingView({
  title = "Sending…",
  subtitle = "Should take a moment. You can close this now — we'll keep going.",
  onDone,
}: {
  title?: string;
  subtitle?: string;
  onDone: () => void;
}) {
  const flutter = useSharedValue(0);
  useEffect(() => {
    flutter.value = withRepeat(withSequence(withTiming(1, { duration: 800 }), withTiming(0, { duration: 800 })), -1, false);
  }, [flutter]);
  const planeStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (flutter.value - 0.5) * 8 }, { rotate: `${(flutter.value - 0.5) * 8}deg` }],
  }));

  return (
    <View style={styles.screen}>
      <View style={styles.center}>
        <Animated.View style={[styles.plane, planeStyle]}>
          <Icon name="paperplane.fill" size={72} color={colors.accent} />
        </Animated.View>
        <ShimmerBars />
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.sub}>{subtitle}</Text>
      </View>
      <View style={styles.footer}>
        <TaliseButton title="Done" variant="secondary" size="lg" onPress={onDone} />
      </View>
    </View>
  );
}

function ShimmerBars() {
  return (
    <View style={styles.bars}>
      {Array.from({ length: 14 }).map((_, i) => (
        <Bar key={i} index={i} />
      ))}
    </View>
  );
}

function Bar({ index }: { index: number }) {
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withRepeat(withSequence(withTiming(1, { duration: 500 + index * 40 }), withTiming(0, { duration: 500 + index * 40 })), -1, false);
  }, [v, index]);
  const style = useAnimatedStyle(() => ({ height: 6 + v.value * 16, opacity: 0.25 + v.value * 0.4 }));
  return <Animated.View style={[styles.bar, style]} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: spacing.xl },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg },
  plane: { marginBottom: spacing.sm },
  bars: { flexDirection: "row", alignItems: "center", gap: 4, height: 24 },
  bar: { width: 3, borderRadius: 2, backgroundColor: colors.accent },
  title: { fontFamily: family.sans, fontSize: 28, fontWeight: "500", color: colors.fg, letterSpacing: -0.5, marginTop: spacing.md },
  sub: { fontFamily: family.sans, fontSize: 14, fontWeight: "300", color: colors.fgMuted, textAlign: "center", lineHeight: 20, paddingHorizontal: spacing.lg },
  footer: { paddingBottom: spacing.sm },
});
