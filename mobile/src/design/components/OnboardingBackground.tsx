import { StyleSheet, useWindowDimensions, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";

import { colors } from "@/design/tokens";

/**
 * OnboardingBackground — the sign-in / welcome backdrop. Exact from ios
 * OnboardingBackground.swift: black base, a top→bottom green wash
 * (#6BA85A → #355626@0.28 → black@0.68 → black), and a top-right pastel radial
 * bloom (#9BD68A@0.55 → #6BA85A@0.18 → clear).
 */
export function OnboardingBackground() {
  const { width: W, height: H } = useWindowDimensions();
  const bloom = Math.min(W, H) * 1.4;
  const r = (Math.min(W, H) * 0.55) / 2;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]} />
      <LinearGradient
        colors={["#6BA85A", "#355626", "#000000", "#000000"]}
        locations={[0, 0.28, 0.68, 1]}
        style={StyleSheet.absoluteFill}
      />
      <Svg
        width={bloom}
        height={bloom}
        style={{ position: "absolute", left: W * 0.35, top: -H * 0.45 }}
      >
        <Defs>
          <RadialGradient id="bloom" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#9BD68A" stopOpacity={0.55} />
            <Stop offset="0.33" stopColor="#6BA85A" stopOpacity={0.18} />
            <Stop offset="1" stopColor="#6BA85A" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={bloom / 2} cy={bloom / 2} r={r * 1.4} fill="url(#bloom)" />
      </Svg>
    </View>
  );
}
