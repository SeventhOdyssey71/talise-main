import { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";

import { Icon } from "@/design/Icon";
import { colors } from "@/design/tokens";
import { family } from "@/design/typography";

const TRACK_H = 58;
const KNOB = 50;
const INSET = 4;
const THRESHOLD = 0.8;

/**
 * SlideToConfirm — drag the knob past 80% to fire. Track surface2 + line; fill
 * accent@0.22 grows with the drag; title fades out; success haptic on confirm;
 * springs back if released short. Matches ios SlideToConfirm.swift.
 */
export function SlideToConfirm({
  title = "Slide to send",
  tint = colors.accent,
  onConfirm,
}: {
  title?: string;
  tint?: string;
  onConfirm: () => Promise<void> | void;
}) {
  const [trackW, setTrackW] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const maxTravel = Math.max(trackW - TRACK_H, 1);
  const x = useSharedValue(0);

  const fire = async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setConfirming(true);
    try {
      await onConfirm();
    } finally {
      // Leave the knob at the end; caller typically navigates away.
    }
  };

  const pan = Gesture.Pan()
    .minDistance(0)
    .enabled(!confirming)
    .onChange((e) => {
      const next = Math.min(Math.max(e.translationX, 0), maxTravel);
      x.value = next;
    })
    .onEnd(() => {
      const progress = maxTravel > 0 ? x.value / maxTravel : 0;
      if (progress >= THRESHOLD) {
        x.value = withSpring(maxTravel, { damping: 18, stiffness: 200 });
        runOnJS(fire)();
      } else {
        x.value = withSpring(0, { damping: 18, stiffness: 200 });
      }
    });

  const knobStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const fillStyle = useAnimatedStyle(() => ({ width: x.value + TRACK_H }));
  const titleStyle = useAnimatedStyle(() => {
    const p = maxTravel > 0 ? x.value / maxTravel : 0;
    return { opacity: Math.max(0, 1 - p * 1.6) };
  });

  return (
    <View style={styles.track} onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}>
      <Animated.View style={[styles.fill, { backgroundColor: withAlpha(tint, 0.22) }, fillStyle]} />
      <Animated.Text style={[styles.title, titleStyle]}>{title}</Animated.Text>
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.knob, { backgroundColor: tint }, knobStyle]}>
          {confirming ? (
            <ActivityIndicator size="small" color={colors.bg} />
          ) : (
            <Icon name="chevron.right.2" size={16} color={colors.bg} />
          )}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

function withAlpha(hex: string, a: number): string {
  if (!hex.startsWith("#") || hex.length !== 7) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

const styles = StyleSheet.create({
  track: {
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.line,
    justifyContent: "center",
    overflow: "hidden",
  },
  fill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: TRACK_H / 2,
  },
  title: {
    textAlign: "center",
    fontFamily: family.sans,
    fontSize: 16,
    fontWeight: "500",
    color: colors.fg,
  },
  knob: {
    position: "absolute",
    left: INSET,
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    alignItems: "center",
    justifyContent: "center",
  },
});
