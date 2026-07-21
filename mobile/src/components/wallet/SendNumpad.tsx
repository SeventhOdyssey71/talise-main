import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";

import { Icon } from "@/design/Icon";
import { colors } from "@/design/tokens";
import { family } from "@/design/typography";

/**
 * SendNumpad — the amount keypad. 3×4 grid (1-9, ".", 0, backspace), 60pt keys,
 * spacing 12. maxInt 9 digits / maxFrac 2. Exact from ios SendNumpad.swift.
 */
export function SendNumpad({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const press = (key: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (key === "<") return onChange(value.slice(0, -1));
    if (key === ".") {
      if (value.includes(".")) return;
      return onChange(value === "" ? "0." : value + ".");
    }
    // digit
    const [intPart, fracPart] = value.split(".");
    if (value.includes(".")) {
      if ((fracPart ?? "").length >= 2) return;
    } else if ((intPart ?? "").replace(/^0+/, "").length >= 9) {
      return;
    }
    let next = value + key;
    if (!next.includes(".")) next = next.replace(/^0+(?=\d)/, ""); // strip leading zero
    onChange(next);
  };

  return (
    <View style={styles.pad}>
      {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "<"].map((k) => (
        <Pressable key={k} onPress={() => press(k)} style={({ pressed }) => [styles.key, pressed && styles.keyPressed]}>
          {k === "<" ? (
            <Icon name="delete.left" size={22} color={colors.fg} />
          ) : (
            <Text style={styles.keyLabel}>{k}</Text>
          )}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { flexDirection: "row", flexWrap: "wrap" },
  key: { width: "33.33%", height: 60, alignItems: "center", justifyContent: "center" },
  keyPressed: { opacity: 0.5 },
  keyLabel: { fontFamily: family.sans, fontSize: 28, fontWeight: "400", color: colors.fg },
});
