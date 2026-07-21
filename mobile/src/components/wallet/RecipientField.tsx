import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { resolveRecipient, type ResolvedRecipient } from "@/api/money";
import { FieldInput } from "@/components/wallet/FormField";
import { colors } from "@/design/tokens";
import { family } from "@/design/typography";

/**
 * RecipientField — @handle / name.talise.sui / 0x address input with a live,
 * debounced (~400ms) resolve. Surfaces "Looking up recipient…" → "Resolved:
 * {display}" → error, and hands the resolved recipient up via onResolved. Mirrors
 * the shared recipient UI in ios Streams/Contracts/Rules.
 */
export function RecipientField({
  value,
  onChangeText,
  onResolved,
  placeholder = "@handle or 0x address",
}: {
  value: string;
  onChangeText: (t: string) => void;
  onResolved: (r: ResolvedRecipient | null) => void;
  placeholder?: string;
}) {
  const [state, setState] = useState<"idle" | "resolving" | "ok" | "err">("idle");
  const [display, setDisplay] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    ctrl.current?.abort();
    const q = value.trim();
    if (!q) {
      setState("idle");
      onResolved(null);
      return;
    }
    setState("resolving");
    onResolved(null);
    timer.current = setTimeout(async () => {
      const c = new AbortController();
      ctrl.current = c;
      try {
        const r = await resolveRecipient(q, c.signal);
        if (c.signal.aborted) return;
        setDisplay(r.display);
        setState("ok");
        onResolved(r);
      } catch {
        if (c.signal.aborted) return;
        setState("err");
        onResolved(null);
      }
    }, 400);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <View style={{ gap: 8 }}>
      <FieldInput value={value} onChangeText={onChangeText} placeholder={placeholder} autoCapitalize="none" autoCorrect={false} />
      {state === "resolving" ? (
        <Text style={styles.hint}>Looking up recipient…</Text>
      ) : state === "ok" ? (
        <Text style={[styles.hint, { color: colors.accent }]}>Resolved: {display}</Text>
      ) : state === "err" ? (
        <Text style={[styles.hint, { color: colors.danger }]}>Couldn&apos;t find that recipient. Check the @handle or address.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { fontFamily: family.sans, fontSize: 12.5, color: colors.fgMuted },
});
