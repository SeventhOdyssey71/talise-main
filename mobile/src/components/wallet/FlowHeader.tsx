import { Pressable, StyleSheet, Text, View } from "react-native";

import { Eyebrow } from "@/design/components/text";
import { Icon } from "@/design/Icon";
import { colors } from "@/design/tokens";
import { family } from "@/design/typography";

/**
 * Standard money-tool header: an eyebrow + title, with a close (X) or a trailing
 * accessory. Matches the iOS cover headers across Cheques/Streams/Invoices/etc.
 */
export function FlowHeader({
  eyebrow,
  title,
  onClose,
  onBack,
  trailing,
}: {
  eyebrow?: string;
  title: string;
  onClose?: () => void;
  onBack?: () => void;
  trailing?: React.ReactNode;
}) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <Text style={styles.title}>{title}</Text>
      </View>
      {trailing ??
        (onBack ? (
          <Pressable style={styles.disc} onPress={onBack} hitSlop={8}><Icon name="chevron.left" size={16} color={colors.fg} /></Pressable>
        ) : onClose ? (
          <Pressable style={styles.disc} onPress={onClose} hitSlop={8}><Icon name="xmark" size={15} color={colors.fgMuted} /></Pressable>
        ) : null)}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  title: { fontFamily: family.sans, fontSize: 24, fontWeight: "500", color: colors.fg, letterSpacing: -0.8, marginTop: 4 },
  disc: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" },
});
