import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { streamsApi, type Stream } from "@/api/streams";
import { fmtUsd, moneyErrorCopy, shortAddr } from "@/api/money";
import { FlowHeader } from "@/components/wallet/FlowHeader";
import { Pill } from "@/design/components/Pill";
import { Icon } from "@/design/Icon";
import { colors, radius, spacing } from "@/design/tokens";
import { family } from "@/design/typography";

/** StreamsView — list of your streams, in and out. Claim (recipient) / cancel & refund (sender). */
export default function StreamsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [streams, setStreams] = useState<Stream[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      setStreams(await streamsApi.list());
    } catch (e) {
      setErr(moneyErrorCopy(e, "Couldn't load your streams."));
      setStreams([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.md, padding: spacing.xl, gap: spacing.lg }}>
        <FlowHeader
          title="Your streams"
          onClose={() => router.back()}
          trailing={<Pill title="New" icon="plus" tint={colors.accent} onPress={() => router.push("/stream-new")} />}
        />

        {err ? <Text style={styles.err}>{err}</Text> : null}

        {streams === null ? (
          <View style={styles.loading}><ActivityIndicator color={colors.fgMuted} /></View>
        ) : streams.length === 0 ? (
          <View style={styles.empty}>
            <Icon name="bolt.horizontal.circle" size={36} color={colors.fgDim} />
            <Text style={styles.emptyHeading}>No streams yet</Text>
            <Text style={styles.emptyMessage}>Start one to drip money over time.</Text>
          </View>
        ) : (
          streams.map((s) => <StreamRow key={s.id} stream={s} onReload={load} />)
        )}
      </ScrollView>
    </View>
  );
}

function StreamRow({ stream, onReload }: { stream: Stream; onReload: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const isRecipient = stream.role === "recipient";
  const total = stream.totalUsd ?? 0;
  const released = stream.releasedUsd ?? 0;
  const done = stream.tranchesDone ?? 0;
  const num = stream.numTranches ?? 0;
  const progress = total > 0 ? Math.min(1, released / total) : 0;
  const fullyStreamed = num > 0 && done >= num;

  const state = (stream.state || "").toLowerCase();
  const active = state === "active";
  const paused = state === "paused";
  const stateLabel = active ? "Active" : paused ? "Paused" : stream.state || "—";
  const stateColor = active ? colors.accent : colors.fgMuted;

  const name = stream.recipientHandle || (stream.recipientAddress ? shortAddr(stream.recipientAddress) : "—");

  const claim = async () => {
    setBusy(true);
    try { await streamsApi.claim(stream.id); await onReload(); } finally { setBusy(false); }
  };
  const cancel = async () => {
    setBusy(true);
    try { await streamsApi.cancel(stream.id); await onReload(); } finally { setBusy(false); }
  };

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.roleBadge}>{isRecipient ? "Streaming in" : "Streaming out"}</Text>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
        </View>
        <Text style={[styles.stateBadge, { color: stateColor }]}>{stateLabel}</Text>
      </View>

      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${progress * 100}%` }]} />
      </View>
      <Text style={styles.progressText}>{done}/{num} payments</Text>

      {isRecipient && active ? (
        <ClaimButton stream={stream} fullyStreamed={fullyStreamed} busy={busy} onClaim={claim} />
      ) : !isRecipient && (active || paused) ? (
        <ActionButton
          icon="stop.circle"
          label={busy ? "Cancelling…" : "Cancel & refund remainder"}
          onPress={busy ? undefined : cancel}
        />
      ) : null}
    </View>
  );
}

function ClaimButton({
  stream,
  fullyStreamed,
  busy,
  onClaim,
}: {
  stream: Stream;
  fullyStreamed: boolean;
  busy: boolean;
  onClaim: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  const next = stream.nextTrancheAt ?? null;
  const locked = next != null && next > now;

  useEffect(() => {
    if (fullyStreamed || next == null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [fullyStreamed, next]);

  if (fullyStreamed) return <LockedButton icon="checkmark.circle" label="Fully streamed" />;
  if (locked && next != null) return <LockedButton icon="clock" label={`Next claim in ${countdown(next - now)}`} />;
  return (
    <ActionButton
      icon="arrow.down.circle"
      label={busy ? "Claiming…" : "Claim available"}
      tint={colors.greenMint}
      onPress={busy ? undefined : onClaim}
    />
  );
}

function ActionButton({
  icon,
  label,
  tint = colors.fg,
  onPress,
}: {
  icon: string;
  label: string;
  tint?: string;
  onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={styles.actionRow}>
      <View style={styles.actionInner}>
        <Icon name={icon} size={15} color={tint} />
        <Text style={[styles.actionLabel, { color: tint }]}>{label}</Text>
      </View>
    </Pressable>
  );
}

function LockedButton({ icon, label }: { icon: string; label: string }) {
  return (
    <View style={styles.lockedRow}>
      <Icon name={icon} size={14} color={colors.fgDim} />
      <Text style={styles.lockedLabel}>{label}</Text>
    </View>
  );
}

/** ms → compact h/m/s countdown. */
function countdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  err: { fontFamily: family.sans, fontSize: 13, color: colors.danger },
  loading: { paddingVertical: spacing.xxxl, alignItems: "center" },
  empty: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xxxl },
  emptyHeading: { fontFamily: family.sans, fontSize: 19, fontWeight: "500", color: colors.fg, marginTop: spacing.sm },
  emptyMessage: { fontFamily: family.sans, fontSize: 14, color: colors.fgMuted, textAlign: "center" },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardHead: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  roleBadge: { fontFamily: family.mono, fontSize: 10, letterSpacing: 1.5, color: colors.fgDim, textTransform: "uppercase" },
  name: { fontFamily: family.sans, fontSize: 16, fontWeight: "500", color: colors.fg, marginTop: 4 },
  stateBadge: { fontFamily: family.mono, fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase" },

  barTrack: { height: 6, borderRadius: 3, backgroundColor: colors.surface2, overflow: "hidden" },
  barFill: { height: 6, borderRadius: 3, backgroundColor: colors.accent },
  progressText: { fontFamily: family.mono, fontSize: 11, color: colors.fgMuted },

  actionRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    paddingTop: spacing.md,
  },
  actionInner: { flexDirection: "row", alignItems: "center", gap: 8 },
  actionLabel: { fontFamily: family.sans, fontSize: 14, fontWeight: "500" },

  lockedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    paddingTop: spacing.md,
  },
  lockedLabel: { fontFamily: family.sans, fontSize: 14, color: colors.fgDim },
});
