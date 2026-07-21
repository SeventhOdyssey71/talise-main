import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "@/design/Icon";
import { colors, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

/**
 * Numeric PIN entry — 4 dots + a 3×4 keypad (1-9, 0, backspace). Shared by
 * pin-create and pin-unlock. The exact PinEntry visual is refined in Phase 3.
 */
export function PinPad({
  value,
  onChange,
  length = 4,
  error = false,
}: {
  value: string;
  onChange: (next: string) => void;
  length?: number;
  error?: boolean;
}) {
  const press = (d: string) => {
    if (value.length < length) onChange(value + d);
  };
  const back = () => onChange(value.slice(0, -1));

  return (
    <View style={styles.wrap}>
      <View style={styles.dots}>
        {Array.from({ length }).map((_, i) => (
          <View
            key={i}
            style={[
              styles.dot,
              i < value.length && styles.dotFilled,
              error && styles.dotError,
            ]}
          />
        ))}
      </View>
      <View style={styles.pad}>
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <Key key={d} label={d} onPress={() => press(d)} />
        ))}
        <View style={styles.key} />
        <Key label="0" onPress={() => press("0")} />
        <Key onPress={back} icon="delete.left" />
      </View>
    </View>
  );
}

function Key({ label, icon, onPress }: { label?: string; icon?: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.key, pressed && styles.keyPressed]} hitSlop={4}>
      {icon ? <Icon name={icon} size={24} color={colors.fg} /> : <Text style={styles.keyLabel}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: spacing.xxl },
  dots: { flexDirection: "row", gap: spacing.lg },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: colors.fgDim,
  },
  dotFilled: { backgroundColor: colors.greenMint, borderColor: colors.greenMint },
  dotError: { borderColor: colors.danger },
  pad: { width: 264, flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: spacing.lg },
  key: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  keyPressed: { backgroundColor: colors.surface2 },
  keyLabel: { fontFamily: family.sans, fontSize: 28, fontWeight: "400", color: colors.fg },
});
