import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Share, StyleSheet, Text, View } from "react-native";

import {
  executePlan,
  intentIsReadOnly,
  planIntent,
  runReadOnly,
  type ActionResult,
  type AgentIntent,
  type AgentPlan,
  type PlannedStep,
} from "@/api/chat";
import { fmtUsd } from "@/api/money";
import { TaliseButton } from "@/design/components/TaliseButton";
import { Icon } from "@/design/Icon";
import { colors, radius, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

type Stage = "loading" | "readonly" | "plan" | "declined" | "running" | "done" | "error";

/**
 * AgentIntentCard — renders beneath a completed assistant message. On mount it
 * either runs read-only lookups inline, or fetches a server-validated plan the
 * user can accept/decline. Trusts only server-resolved amounts + recipients.
 * Mirrors the ios AgentIntentCard / AgentExecutor flow.
 */
export function AgentIntentCard({ intent }: { intent: AgentIntent }) {
  const [stage, setStage] = useState<Stage>("loading");
  const [lines, setLines] = useState<string[]>([]);
  const [plan, setPlan] = useState<AgentPlan | null>(null);
  const [results, setResults] = useState<ActionResult[]>([]);
  const [errorText, setErrorText] = useState<string>("");

  useEffect(() => {
    let alive = true;
    (async () => {
      if (intentIsReadOnly(intent)) {
        try {
          const out = await runReadOnly(intent.steps);
          if (!alive) return;
          setLines(out);
          setStage("readonly");
        } catch {
          if (!alive) return;
          setLines([]);
          setStage("readonly");
        }
      } else {
        try {
          const p = await planIntent(intent.steps);
          if (!alive) return;
          setPlan(p);
          setStage("plan");
        } catch {
          if (!alive) return;
          setErrorText("Couldn't check that plan right now.");
          setStage("error");
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [intent]);

  const onAccept = async () => {
    if (!plan) return;
    setErrorText("");
    setStage("running");
    try {
      const out = await executePlan(plan, intent.steps);
      setResults(out);
      setStage("done");
    } catch {
      setErrorText("Couldn't complete that. Please try again.");
      setStage("plan");
    }
  };

  const onDecline = () => setStage("declined");

  return (
    <View style={styles.card}>
      {stage === "loading" ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={colors.fgMuted} />
          <Text style={styles.loadingText}>{intentIsReadOnly(intent) ? "Looking that up…" : "Checking this plan…"}</Text>
        </View>
      ) : null}

      {stage === "readonly" ? (
        <View style={styles.stack}>
          {lines.map((l, i) => (
            <View key={i} style={styles.readRow}>
              <View style={styles.dot} />
              <Text style={styles.readText}>{l}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {stage === "error" ? <Text style={styles.errText}>{errorText}</Text> : null}

      {stage === "declined" ? <Text style={styles.bodyText}>Okay, I didn&apos;t run that. Tell me what to change.</Text> : null}

      {(stage === "plan" || stage === "running") && plan ? (
        <PlanView plan={plan} running={stage === "running"} errorText={errorText} onAccept={onAccept} onDecline={onDecline} />
      ) : null}

      {stage === "done" ? <DoneView results={results} /> : null}
    </View>
  );
}

function statusIcon(status: PlannedStep["status"]): { name: string; color: string } {
  if (status === "ok") return { name: "checkmark.circle.fill", color: colors.greenMint };
  if (status === "read_only") return { name: "eye", color: colors.fgDim };
  return { name: "exclamationmark.triangle.fill", color: colors.danger };
}

function PlanView({
  plan,
  running,
  errorText,
  onAccept,
  onDecline,
}: {
  plan: AgentPlan;
  running: boolean;
  errorText: string;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <View style={styles.stack}>
      <Text style={styles.summary}>{plan.summary}</Text>

      <View style={styles.stepStack}>
        {plan.steps.map((p, i) => {
          const si = statusIcon(p.status);
          const blocked = p.status === "blocked" || p.status === "needs_info";
          const labelColor = blocked ? colors.danger : colors.fg;
          return (
            <View key={i} style={styles.stepRow}>
              <View style={styles.stepIcon}>
                <Icon name={si.name} size={15} color={si.color} />
              </View>
              <View style={styles.stepBody}>
                <Text style={[styles.stepLabel, { color: labelColor, fontWeight: p.status === "ok" ? "600" : "400" }]}>{p.label}</Text>
                {p.detail ? <Text style={[styles.stepDetail, { color: blocked ? colors.danger : colors.fgMuted }]}>{p.detail}</Text> : null}
              </View>
            </View>
          );
        })}
      </View>

      {plan.limit ? (
        <Text style={styles.limitText}>
          {plan.limit.window} limit {fmtUsd(plan.limit.limit)} · used {fmtUsd(plan.limit.used)}.
        </Text>
      ) : null}

      {errorText ? <Text style={styles.errText}>{errorText}</Text> : null}

      {plan.confirmable ? (
        <View style={styles.stack}>
          <View style={styles.buttonRow}>
            <View style={styles.buttonHalf}>
              <TaliseButton title="Decline" variant="secondary" size="md" disabled={running} onPress={onDecline} />
            </View>
            <View style={styles.buttonHalf}>
              <TaliseButton
                title={plan.totalSendUsd > 0 ? "Accept · " + fmtUsd(plan.totalSendUsd) : "Accept"}
                variant="primary"
                size="md"
                loading={running}
                onPress={onAccept}
              />
            </View>
          </View>
          <View style={styles.gaslessRow}>
            <View style={styles.gaslessIcon}>
              <Icon name="bolt.fill" size={12} color={colors.accent} />
            </View>
            <Text style={styles.gaslessText}>No network fee. Talise sponsors the gas.</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function DoneView({ results }: { results: ActionResult[] }) {
  return (
    <View style={styles.stack}>
      <View style={styles.doneHeader}>
        <View style={styles.doneIcon}>
          <Icon name="checkmark.seal.fill" size={18} color={colors.greenMint} />
        </View>
        <Text style={styles.doneTitle}>Done</Text>
      </View>
      {results.map((r, i) => (
        <View key={i} style={styles.resultBlock}>
          <Text style={styles.resultLine}>{r.line}</Text>
          <View style={styles.chipRow}>
            {r.digest && r.amountUsd ? (
              <Pressable
                style={styles.chip}
                onPress={() => Share.share({ message: "https://suiscan.xyz/mainnet/tx/" + r.digest })}
              >
                <Text style={styles.chipText}>Share receipt</Text>
              </Pressable>
            ) : null}
            {r.link ? (
              <Pressable style={styles.chip} onPress={() => Share.share({ message: r.link! })}>
                <View style={styles.chipIcon}>
                  <Icon name="link" size={12} color={colors.fg} />
                </View>
                <Text style={styles.chipText}>Share link</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    padding: spacing.lg,
  },
  stack: { gap: spacing.md },
  stepStack: { gap: spacing.sm },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  loadingText: { fontFamily: family.sans, fontSize: 13, color: colors.fgMuted },
  readRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  dot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.fgDim, marginTop: 7 },
  readText: { flex: 1, fontFamily: family.sans, fontSize: 14, color: colors.fg, lineHeight: 20 },
  errText: { fontFamily: family.sans, fontSize: 13, color: colors.danger },
  bodyText: { fontFamily: family.sans, fontSize: 14, color: colors.fgMuted, lineHeight: 20 },
  summary: { fontFamily: family.sans, fontSize: 14, fontWeight: "500", color: colors.fg, lineHeight: 20 },
  stepRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  stepIcon: { marginTop: 1 },
  stepBody: { flex: 1, gap: 2 },
  stepLabel: { fontFamily: family.sans, fontSize: 14, lineHeight: 19 },
  stepDetail: { fontFamily: family.sans, fontSize: 12, lineHeight: 16 },
  limitText: { fontFamily: family.mono, fontSize: 12, color: colors.fgDim },
  buttonRow: { flexDirection: "row", gap: spacing.sm },
  buttonHalf: { flex: 1 },
  gaslessRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  gaslessIcon: {},
  gaslessText: { fontFamily: family.mono, fontSize: 11, color: colors.fgDim },
  doneHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  doneIcon: {},
  doneTitle: { fontFamily: family.sans, fontSize: 16, fontWeight: "500", color: colors.fg },
  resultBlock: { gap: spacing.sm },
  resultLine: { fontFamily: family.sans, fontSize: 14, color: colors.fg, lineHeight: 20 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.surface2,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  chipIcon: {},
  chipText: { fontFamily: family.sans, fontSize: 12, fontWeight: "500", color: colors.fg },
});
