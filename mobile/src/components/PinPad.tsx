import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from "react-native-reanimated";

import { Icon } from "@/design/Icon";
import { colors } from "@/design/tokens";
import { family } from "@/design/typography";

/**
 * PIN entry — exact from ios PinCreateView/PinUnlockView: four round dots
 * (greenMint fill / fgDim 1.4pt stroke @0.85 scale, spacing 26) that shake on
 * error, over a 3×4 numpad (68pt keys, 30pt rounded digits, spacing 10). The
 * bottom-left slot can hold a biometric key (Face ID) on the unlock screen.
 */
export function PinPad({
  value,
  onChange,
  length = 4,
  error = false,
  bottomLeftIcon,
  onBottomLeftPress,
}: {
  value: string;
  onChange: (next: string) => void;
  length?: number;
  error?: boolean;
  bottomLeftIcon?: string;
  onBottomLeftPress?: () => void;
}) {
  const shake = useSharedValue(0);
  useEffect(() => {
    if (error) {
      shake.value = withSequence(
        withTiming(-9, { duration: 50 }),
        withTiming(9, { duration: 50 }),
        withTiming(-6, { duration: 50 }),
        withTiming(6, { duration: 50 }),
        withTiming(0, { duration: 50 }),
      );
    }
  }, [error, shake]);
  const dotsStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));

  const press = (d: string) => {
    if (value.length < length) onChange(value + d);
  };
  const back = () => onChange(value.slice(0, -1));

  return (
    <View style={styles.wrap}>
      <Animated.View style={[styles.dots, dotsStyle]}>
        {Array.from({ length }).map((_, i) => {
          const filled = i < value.length;
          return (
            <View
              key={i}
              style={[
                styles.dot,
                filled ? styles.dotFilled : styles.dotEmpty,
                error && !filled && { borderColor: colors.danger },
              ]}
            />
          );
        })}
      </Animated.View>

      <View style={styles.pad}>
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <Key key={d} label={d} onPress={() => press(d)} />
        ))}
        {bottomLeftIcon ? (
          <Key icon={bottomLeftIcon} iconColor={colors.greenMint} iconSize={25} onPress={onBottomLeftPress ?? (() => {})} />
        ) : (
          <View style={styles.key} />
        )}
        <Key label="0" onPress={() => press("0")} />
        <Key icon="delete.left" iconColor={colors.fgMuted} iconSize={22} onPress={back} />
      </View>
    </View>
  );
}

function Key({
  label,
  icon,
  iconColor,
  iconSize,
  onPress,
}: {
  label?: string;
  icon?: string;
  iconColor?: string;
  iconSize?: number;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.key, pressed && styles.keyPressed]} hitSlop={4}>
      {icon ? <Icon name={icon} size={iconSize ?? 24} color={iconColor ?? colors.fg} /> : <Text style={styles.keyLabel}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: 40 },
  dots: { flexDirection: "row", gap: 26 },
  dot: { width: 16, height: 16, borderRadius: 8 },
  dotFilled: { backgroundColor: colors.greenMint },
  dotEmpty: { borderWidth: 1.4, borderColor: colors.fgDim, transform: [{ scale: 0.85 }] },
  pad: { width: 68 * 3 + 10 * 2, flexDirection: "row", flexWrap: "wrap", rowGap: 10, columnGap: 10 },
  key: { width: 68, height: 68, borderRadius: 34, alignItems: "center", justifyContent: "center" },
  keyPressed: { backgroundColor: colors.surface2 },
  keyLabel: { fontFamily: family.sans, fontSize: 30, fontWeight: "400", color: colors.fg },
});
