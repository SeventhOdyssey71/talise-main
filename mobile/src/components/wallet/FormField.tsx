import { StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";

import { Eyebrow } from "@/design/components/text";
import { colors, radius, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

/**
 * LabeledField + FieldInput — the money-tools form primitives: a mono uppercase
 * label over a surface input, with an optional helper line. Matches the ios
 * labeled fields across Cheques/Streams/Invoices/Contracts/Requests/Rules.
 */
export function LabeledField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Eyebrow>{label}</Eyebrow>
      {children}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function FieldInput(props: TextInputProps) {
  return <TextInput placeholderTextColor={colors.fgDim} {...props} style={[styles.input, props.style]} />;
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    fontFamily: family.sans,
    fontSize: 16,
    color: colors.fg,
  },
  hint: { fontFamily: family.sans, fontSize: 12.5, color: colors.fgMuted, lineHeight: 18 },
});
