import { useCallback, useEffect, useRef, useState } from "react";
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

/**
 * StreamsView — list of your streams, in and out.
 *
 * Opening this screen ADVANCES every stream with money due, from either side:
 * `stream::claim_accrued` is permissionless on chain and can only pay the
 * stream's hardwired recipient, so the sender's open app pushes their own
 * outgoing stream forward too. Once per stream per screen-open, silent on
 * failure — the same "no cron" trigger shape as rules and team streams.
 */
export default function StreamsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [streams, setStreams] = useState<Stream[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  /** Streams already auto-advanced on this screen-open, so a refresh never
   *  re-fires and we can't spam sponsored txs. */
  const fired = useRef<Set<string>>(new Set());

  const load = useCallback(async (): Promise<Stream[]> => {
    setErr(null);
    try {
      const list = await streamsApi.list();
      setStreams(list);
      return list;
    } catch (e) {
      setErr(moneyErrorCopy(e, "Couldn't load your streams."));
      setStreams([]);
      return [];
    }
  }, []);

  const fireDue = useCallback(async (list: Stream[]) => {
    const due = list.filter((s) => s.dueNow && !fired.current.has(s.id));
    if (due.length === 0) return;
    due.forEach((s) => fired.current.add(s.id));
    const count = await streamsApi.fireDueClaims(due);
    if (count > 0) await load();
  }, [load]);

  useEffect(() => {
    void (async () => { await fireDue(await load()); })();
  }, [load, fireDue]);

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

function StreamRow({ stream, onReload }: { stream: Stream; onReload: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const isRecipient = stream.role === "recipient";
  const total = stream.totalUsd ?? 0;
  // CONFIRMED on chain, not a schedule projection — so the bar freezes by
  // itself on a cancelled or completed stream (the cursor stops moving) and
  // never shows money the recipient doesn't hold.
  const released = stream.releasedUsd ?? 0;
  const done = stream.tranchesDone ?? 0;
  const num = stream.numTranches ?? 0;
  const claimable = stream.claimableUsd ?? 0;
  const progress = total > 0 ? Math.min(1, released / total) : 0;

  // `completed` is derived server-side from the contract's release cursor;
  // nothing writes it, so this is how a finished stream stops looking live.
  const state = (stream.state || "").toLowerCase();
  const active = state === "active";
  const paused = state === "paused";
  const completed = state === "completed";
  const cancelled = state === "cancelled";
  const live = active || paused;
  const stateLabel = completed
    ? "Completed"
    : cancelled
      ? "Cancelled"
      : active
        ? "Active"
        : paused
          ? "Paused"
          : stream.state || "—";
  const stateColor = active ? colors.accent : completed ? colors.greenMint : colors.fgMuted;

  const name = stream.recipientHandle || (stream.recipientAddress ? shortAddr(stream.recipientAddress) : "—");

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); await onReload(); } catch { /* best-effort */ } finally { setBusy(false); }
  };
  const claim = () => run(() => streamsApi.claim(stream.id));
  const cancel = () => run(() => streamsApi.cancel(stream.id));
  const togglePause = () => run(() => streamsApi.setPaused(stream.id, !paused));

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
      <Text style={styles.progressText}>
        {cancelled
          ? `${fmtUsd(released)} streamed of ${fmtUsd(total)} before cancelling · ${done}/${num} payments`
          : completed
            ? `${fmtUsd(total)} · all ${num} payments sent`
            : `${fmtUsd(released)} of ${fmtUsd(total)} · ${done}/${num} payments`}
      </Text>
      {active && claimable > 0 ? (
        <Text style={styles.progressText}>{fmtUsd(claimable)} ready to claim</Text>
      ) : null}
      {paused ? (
        <Text style={styles.progressText}>Paused, nothing is being released.</Text>
      ) : null}

      {/* Terminal streams get a statement, never controls. */}
      {completed ? (
        <LockedButton icon="checkmark.circle" label="Fully streamed" />
      ) : cancelled ? (
        <LockedButton
          icon="stop.circle"
          label={
            (stream.remainingUsd ?? 0) > 0
              ? `Cancelled · ${fmtUsd(stream.remainingUsd ?? 0)} refunded`
              : "Cancelled"
          }
        />
      ) : isRecipient ? (
        <ClaimButton stream={stream} busy={busy} onClaim={claim} />
      ) : live ? (
        <>
          <ActionButton
            icon={paused ? "play.fill" : "pause.fill"}
            label={busy ? "Working…" : paused ? "Resume stream" : "Pause stream"}
            onPress={busy ? undefined : togglePause}
          />
          <ActionButton
            icon="stop.circle"
            label={busy ? "Cancelling…" : "Cancel & refund remainder"}
            onPress={busy ? undefined : cancel}
          />
        </>
      ) : null}
    </View>
  );
}

/**
 * Recipient claim control. The screen-open auto-fire already pulls whatever is
 * due, so this is the manual fallback plus an honest countdown: claimable while
 * the chain owes something, otherwise counting down to the next tranche's Clock
 * time. Paused streams show why nothing can be pulled.
 */
function ClaimButton({
  stream,
  busy,
  onClaim,
}: {
  stream: Stream;
  busy: boolean;
  onClaim: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  const claimable = (stream.claimableUsd ?? 0) > 0;
  const next = stream.nextTrancheAt ?? null;
  const paused = (stream.state || "").toLowerCase() === "paused";

  useEffect(() => {
    if (paused || claimable || next == null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [paused, claimable, next]);

  if (paused) return <LockedButton icon="pause.fill" label="Paused by the sender" />;
  if (claimable) {
    return (
      <ActionButton
        icon="arrow.down.circle"
        label={busy ? "Claiming…" : `Claim ${fmtUsd(stream.claimableUsd ?? 0)}`}
        tint={colors.greenMint}
        onPress={busy ? undefined : onClaim}
      />
    );
  }
  if (next != null && next > now) {
    return <LockedButton icon="clock" label={`Next payment in ${countdown(next - now)}`} />;
  }
  return <LockedButton icon="clock" label="Waiting on the next payment" />;
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
