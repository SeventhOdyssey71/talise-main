import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "@/design/Icon";
import { colors, buttonSize, type ButtonSizeKey } from "@/design/tokens";
import { family } from "@/design/typography";

/**
 * LiquidGlassButton — tinted action button. Solid `tint` fill (default accent)
 * or surface2 when tint is null; label ink is dark (#0A140C) on accent/mint/
 * live/success fills, else fg. Corner radius sm→12 / md→14 / lg→16. Press pulse
 * via opacity+scale (LiquidGlassPressStyle). Matches ios LiquidGlassButton.swift.
 */
const RADIUS: Record<ButtonSizeKey, number> = { sm: 12, md: 14, lg: 16 };
const DARK_INK_TINTS = new Set<string>([colors.accent, colors.greenMint, colors.live, colors.success]);

export function GlassButton({
  title,
  icon,
  tint = colors.accent,
  size = "lg",
  loading = false,
  fullWidth = true,
  disabled = false,
  onPress,
}: {
  title: string;
  icon?: string;
  tint?: string | null;
  size?: ButtonSizeKey;
  loading?: boolean;
  fullWidth?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}) {
  const s = buttonSize[size];
  const labelColor = tint && DARK_INK_TINTS.has(tint) ? colors.inkOnAccent : colors.fg;

  return (
    <Pressable
      onPress={loading || disabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.base,
        {
          height: s.height,
          paddingHorizontal: s.hPadding,
          borderRadius: RADIUS[size],
          backgroundColor: tint ?? colors.surface2,
          borderWidth: tint ? 0 : 1,
          borderColor: colors.line,
          alignSelf: fullWidth ? "stretch" : "flex-start",
          width: fullWidth ? "100%" : undefined,
          opacity: disabled ? 0.5 : loading ? 0.85 : 1,
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
      ]}
    >
      <View style={styles.inner}>
        {loading ? (
          <ActivityIndicator size="small" color={labelColor} />
        ) : (
          <>
            {icon ? <Icon name={icon} size={s.fontSize + 1} color={labelColor} /> : null}
            <Text style={[styles.label, { color: labelColor, fontSize: s.fontSize }]}>{title}</Text>
          </>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: "center", justifyContent: "center" },
  inner: { flexDirection: "row", alignItems: "center", gap: 8 },
  label: { fontFamily: family.sans, fontWeight: "600" },
});
