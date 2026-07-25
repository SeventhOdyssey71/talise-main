import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { rulesApi, type Rule } from "@/api/rules";
import { fmtUsd, moneyErrorCopy, shortAddr } from "@/api/money";
import { FlowHeader } from "@/components/wallet/FlowHeader";
import { Icon } from "@/design/Icon";
import { colors, radius, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

/** ordinal(n) — 1→"1st", 2→"2nd", 3→"3rd", else "{n}th", with 11/12/13 → "th". */
function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

function isPaused(r: Rule): boolean {
  if (r.isActive === false) return true;
  const s = (r.state ?? r.status ?? "").toLowerCase();
  return s === "paused";
}

function cadenceLabel(r: Rule): string {
  if (r.dayOfMonth != null) return `On the ${ordinal(r.dayOfMonth)} of each month`;
  if (r.intervalMinutes === 1440) return "Every day";
  if (r.intervalMinutes === 10080) return "Every week";
  return "";
}

/** RulesView — automations hub: list + the server-side feature gate. Mirrors ios RulesView. */
export default function RulesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [rules, setRules] = useState<Rule[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await rulesApi.list();
      setRules(r.rules);
      setEnabled(r.enabled);
      setErr(null);
    } catch (e) {
      setErr(moneyErrorCopy(e, "Couldn't load your rules."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (r: Rule) => {
    setBusy(r.id);
    try {
      if (isPaused(r)) await rulesApi.resume(r.id);
      else await rulesApi.pause(r.id);
      await load();
    } catch (e) {
      setErr(moneyErrorCopy(e, "Couldn't update that rule."));
    } finally {
      setBusy(null);
    }
  };

  const cancel = async (r: Rule) => {
    setBusy(r.id);
    try {
      await rulesApi.cancel(r.id);
      await load();
    } catch (e) {
      setErr(moneyErrorCopy(e, "Couldn't cancel that rule."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.headerWrap}>
        <FlowHeader eyebrow="AUTOMATIONS" title="Money that runs itself" onClose={() => router.back()} />
        <Text style={styles.subtitle}>
          Set a rule once — pay a fixed amount to someone on a schedule. It runs automatically and gaslessly.
        </Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.fgMuted} />
        </View>
      ) : !enabled ? (
        <View style={styles.center}>
          <Icon name="clock.arrow.2.circlepath" size={38} color={colors.fgDim} />
          <Text style={styles.emptyHeading}>Automations are coming soon</Text>
          <Text style={styles.emptyMessage}>
            Soon you&apos;ll be able to set money to send itself — pay rent on the 1st, top someone up weekly, all gaslessly.
          </Text>
        </View>
      ) : rules.length === 0 ? (
        <View style={styles.center}>
          <Icon name="arrow.triangle.2.circlepath" size={38} color={colors.fgDim} />
          <Text style={styles.emptyHeading}>No rules yet</Text>
          <Text style={styles.emptyMessage}>Create one to send money on a schedule, automatically.</Text>
          {err ? <Text style={styles.err}>{err}</Text> : null}
          <Pressable style={styles.newBtn} onPress={() => router.push("/rule-new")}>
            <Icon name="plus" size={15} color={colors.bg} />
            <Text style={styles.newBtnText}>New rule</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.xl, paddingBottom: insets.bottom + spacing.xl, gap: spacing.md }}>
          <Pressable style={styles.newBtn} onPress={() => router.push("/rule-new")}>
            <Icon name="plus" size={15} color={colors.bg} />
            <Text style={styles.newBtnText}>New rule</Text>
          </Pressable>
          {err ? <Text style={styles.err}>{err}</Text> : null}
          {rules.map((r) => {
            const paused = isPaused(r);
            const to = r.toHandle || (r.toAddress ? shortAddr(r.toAddress) : "");
            let tertiary = cadenceLabel(r);
            if (paused) tertiary = tertiary ? `${tertiary} · Paused` : "Paused";
            return (
              <View key={r.id} style={styles.row}>
                <View style={styles.rowMain}>
                  <View style={styles.chip}>
                    <Icon
                      name={paused ? "pause.fill" : "arrow.triangle.2.circlepath"}
                      size={20}
                      color={paused ? colors.fgMuted : colors.greenMint}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowName} numberOfLines={1}>{r.name}</Text>
                    <Text style={styles.rowSub} numberOfLines={1}>
                      {fmtUsd(r.amountUsd)} to {to}
                    </Text>
                    {tertiary ? <Text style={styles.rowTertiary}>{tertiary}</Text> : null}
                  </View>
                  <Pressable
                    style={styles.toggle}
                    hitSlop={8}
                    disabled={busy === r.id}
                    onPress={() => toggle(r)}
                  >
                    {busy === r.id ? (
                      <ActivityIndicator size="small" color={colors.fgMuted} />
                    ) : (
                      <Icon name={paused ? "play.fill" : "pause.fill"} size={13} color={colors.fg} />
                    )}
                  </Pressable>
                </View>
                <Pressable hitSlop={6} onPress={() => cancel(r)} disabled={busy === r.id}>
                  <Text style={styles.cancel}>Cancel</Text>
                </Pressable>
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  headerWrap: { paddingHorizontal: spacing.xl, gap: spacing.md, paddingBottom: spacing.lg },
  subtitle: { fontFamily: family.sans, fontSize: 14, fontWeight: "300", color: colors.fgMuted, lineHeight: 20 },

  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl, gap: spacing.md },
  emptyHeading: { fontFamily: family.sans, fontSize: 19, fontWeight: "500", color: colors.fg, textAlign: "center", marginTop: spacing.sm },
  emptyMessage: { fontFamily: family.sans, fontSize: 14, color: colors.fgMuted, textAlign: "center", lineHeight: 20 },

  newBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    height: 52, borderRadius: radius.md, backgroundColor: colors.accent,
  },
  newBtnText: { fontFamily: family.sans, fontSize: 16, fontWeight: "600", color: colors.bg },

  row: {
    backgroundColor: colors.surfaceGlass, borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line,
    padding: spacing.lg, gap: spacing.sm,
  },
  rowMain: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  chip: {
    width: 46, height: 46, borderRadius: 14, backgroundColor: "rgba(202,255,184,0.12)",
    alignItems: "center", justifyContent: "center",
  },
  rowName: { fontFamily: family.sans, fontSize: 16, fontWeight: "500", color: colors.fg },
  rowSub: { fontFamily: family.sans, fontSize: 13, color: colors.fgMuted, marginTop: 2 },
  rowTertiary: { fontFamily: family.mono, fontSize: 11, fontWeight: "300", color: colors.fgDim, marginTop: 4 },
  toggle: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center" },
  cancel: { fontFamily: family.sans, fontSize: 12.5, fontWeight: "500", color: colors.danger, alignSelf: "flex-start" },

  err: { fontFamily: family.sans, fontSize: 13, color: colors.danger, textAlign: "center" },
});
