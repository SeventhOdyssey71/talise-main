import { StyleSheet, View } from "react-native";

import { colors } from "@/design/tokens";

/** LiquidGlassDivider — 1 device-pixel hairline in `line`, optional horizontal inset. */
export function Divider({ color = colors.line, inset = 0 }: { color?: string; inset?: number }) {
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: color, marginHorizontal: inset }} />;
}
