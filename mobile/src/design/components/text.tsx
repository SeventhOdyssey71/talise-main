import { StyleSheet, Text, type TextProps } from "react-native";

import { colors } from "@/design/tokens";
import { family } from "@/design/typography";

/** Eyebrow — mono(10) tracking 2.0 uppercased, fgDim. */
export function Eyebrow({ children, style, ...p }: TextProps) {
  return (
    <Text {...p} style={[styles.eyebrow, style]}>
      {String(children).toUpperCase()}
    </Text>
  );
}

/** MicroLabel — mono(8) kerning -0.32, fg. */
export function MicroLabel({ children, style, ...p }: TextProps) {
  return (
    <Text {...p} style={[styles.micro, style]}>
      {children}
    </Text>
  );
}

/** SectionHeader — mono(10) tracking 2.0, fgMuted. */
export function SectionHeader({ children, style, ...p }: TextProps) {
  return (
    <Text {...p} style={[styles.section, style]}>
      {String(children).toUpperCase()}
    </Text>
  );
}

const styles = StyleSheet.create({
  eyebrow: { fontFamily: family.mono, fontSize: 10, letterSpacing: 2.0, color: colors.fgDim },
  micro: { fontFamily: family.mono, fontSize: 8, letterSpacing: -0.32, color: colors.fg },
  section: { fontFamily: family.mono, fontSize: 10, letterSpacing: 2.0, color: colors.fgMuted },
});
