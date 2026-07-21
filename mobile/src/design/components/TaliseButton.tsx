import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "@/design/Icon";
import { colors, radius, buttonSize, type ButtonSizeKey } from "@/design/tokens";
import { family } from "@/design/typography";

type Variant = "primary" | "secondary" | "ghost" | "danger";

/**
 * TaliseButton — full-width action button. Corner radius sm(10). Variants:
 * primary=greenDeep/#F2FFEC, secondary=surface2/fg + 1px line, ghost=clear/fgMuted,
 * danger=danger/white. Matches ios TaliseButton.swift.
 */
export function TaliseButton({
  title,
  variant = "primary",
  size = "md",
  icon,
  loading = false,
  disabled = false,
  onPress,
}: {
  title: string;
  variant?: Variant;
  size?: ButtonSizeKey;
  icon?: string;
  loading?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}) {
  const s = buttonSize[size];
  const fill =
    variant === "primary" ? colors.greenDeep
    : variant === "danger" ? colors.danger
    : variant === "secondary" ? colors.surface2
    : "transparent";
  const fg =
    variant === "primary" ? colors.primaryLabel
    : variant === "danger" ? "#FFFFFF"
    : variant === "ghost" ? colors.fgMuted
    : colors.fg;
  const bordered = variant === "secondary";

  return (
    <Pressable
      onPress={loading || disabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.base,
        {
          height: s.height,
          paddingHorizontal: s.hPadding,
          backgroundColor: fill,
          borderWidth: bordered ? 1 : 0,
          borderColor: colors.line,
          opacity: loading || disabled ? (disabled ? 0.5 : 0.85) : pressed ? 0.92 : 1,
        },
      ]}
    >
      <View style={styles.inner}>
        {loading ? (
          <ActivityIndicator size="small" color={fg} />
        ) : (
          <>
            {icon ? <Icon name={icon} size={s.fontSize} color={fg} /> : null}
            <Text style={[styles.label, { color: fg, fontSize: s.fontSize }]}>{title}</Text>
          </>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    width: "100%",
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  inner: { flexDirection: "row", alignItems: "center", gap: 8 },
  label: { fontFamily: family.sans, fontWeight: "600" },
});
