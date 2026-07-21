import { StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

/**
 * TopGlow — the ambient green glow behind the top of most screens. Vertical
 * gradient, height 380, non-interactive. Exact stops from ios TopGlow.swift:
 * #6BA85A@0.55 (0.0) → #355626@0.40 (0.30) → black (0.78) → black (1.0).
 */
export function TopGlow() {
  return (
    <LinearGradient
      pointerEvents="none"
      colors={["rgba(107,168,90,0.55)", "rgba(53,86,38,0.40)", "#000000", "#000000"]}
      locations={[0, 0.3, 0.78, 1]}
      style={styles.glow}
    />
  );
}

const styles = StyleSheet.create({
  glow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 380,
  },
});
