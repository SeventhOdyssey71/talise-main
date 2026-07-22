import { Pressable, StyleSheet, Text, View } from "react-native";

import { HugeIcon, Flag } from "@/design/assets";
import { Icon } from "@/design/Icon";
import { colors } from "@/design/tokens";
import { family } from "@/design/typography";
import { local2, ngn, relativeTime, shortAddr } from "@/lib/format";
import { otherCoinDisplay, type ActivityEntry } from "@/api/wallet";

/**
 * HistoryRow — the shared activity row (Home top-4 + HistoryView), exact from
 * ios HistoryRow.swift. Category → badge/icon/tint; direction → title/subtitle/
 * amount + sign/color. Amounts hidden as "••••" when `hidden`.
 */

type Category = "sent" | "received" | "invest" | "withdraw" | "autoswap" | "cashout" | "team" | "neutral";

function categoryOf(t: ActivityEntry): Category {
  if (t.offramp || (t.direction === "withdraw" && t.venue === "bridge")) return "cashout";
  if (t.team) return "team";
  switch (t.direction) {
    case "sent": return "sent";
    case "received": return "received";
    case "invest": return "invest";
    case "withdraw": return "withdraw";
    case "swap":
    case "autoswap": return "autoswap";
    default: return "neutral";
  }
}

const BADGE: Record<Category, { bg: string; fg: string; symbol: string }> = {
  sent: { bg: "rgba(229,72,77,0.15)", fg: "#FF6B6B", symbol: "arrow.up.right" },
  cashout: { bg: "rgba(229,72,77,0.15)", fg: "#FF6B6B", symbol: "building.columns" },
  team: { bg: "rgba(229,72,77,0.15)", fg: "#FF6B6B", symbol: "hi.team" },
  received: { bg: "rgba(121,217,108,0.15)", fg: "#CAFFB8", symbol: "arrow.down.left" },
  withdraw: { bg: "rgba(121,217,108,0.15)", fg: "#2E5E1F", symbol: "leaf" },
  invest: { bg: "rgba(121,217,108,0.15)", fg: colors.accent, symbol: "leaf.fill" },
  autoswap: { bg: "rgba(121,217,108,0.15)", fg: colors.accent, symbol: "leaf.fill" },
  neutral: { bg: colors.surface2, fg: colors.fg, symbol: "circle" },
};

function who(t: ActivityEntry): string {
  return t.counterpartyName ?? shortAddr(t.counterparty);
}

function titleOf(t: ActivityEntry, cat: Category): string {
  if (cat === "cashout") {
    if (t.offramp?.provider === "linq" || t.offramp) return "Cash out to Nigeria";
    return "Cash out to United States";
  }
  if (t.otherCoin) return `${cat === "sent" ? "Sent" : "Received"} ${t.otherCoin.symbol}`;
  const w = who(t);
  const saved = (t.roundupUsdsui ?? 0) > 0;
  switch (cat) {
    case "sent": return w ? (saved ? `Sent to ${w} + saved` : `Sent to ${w}`) : saved ? "Sent + saved" : "Sent";
    case "team": return t.team?.name ? `Paid ${t.team.name}` : "Paid your team";
    case "received": return w ? `Received from ${w}` : "Received";
    case "invest": return t.venue ? `Invested in ${t.venue}` : "Invested";
    case "withdraw": return t.venue ? `Withdrew from ${t.venue}` : "Withdrew";
    case "autoswap": return "Swapped";
    default: return "Activity";
  }
}

function subtitleOf(t: ActivityEntry): string {
  if (t.offramp) return `${t.offramp.bankName ?? "Bank"} ••••${t.offramp.accountLast4 ?? ""}`;
  if (t.team) return `${t.team.recipientCount} people • ${relativeTime(t.timestampMs)}`;
  if ((t.roundupUsdsui ?? 0) > 0) return `Saved ${local2(t.roundupUsdsui ?? 0)} • ${relativeTime(t.timestampMs)}`;
  return relativeTime(t.timestampMs);
}

function amountOf(t: ActivityEntry, cat: Category): { text: string; color: string } {
  const inflow = cat === "received" || cat === "withdraw";
  let color: string = colors.fg;
  if (cat === "cashout") color = "#E5484D";
  else if (inflow) color = "#4FB35E";

  if (t.offramp) return { text: `−${ngn(t.offramp.amountNgn)}`, color: "#E5484D" };
  if (t.otherCoin) {
    const sign = inflow ? "+" : "−";
    return { text: `${sign}${otherCoinDisplay(t.otherCoin)} ${t.otherCoin.symbol}`, color };
  }
  const sign = inflow ? "+" : "−";
  return { text: `${sign}${local2(Math.abs(t.amountUsdsui ?? 0))}`, color };
}

export function HistoryRow({
  entry,
  hidden = false,
  onPress,
}: {
  entry: ActivityEntry;
  hidden?: boolean;
  onPress?: () => void;
}) {
  const cat = categoryOf(entry);
  const badge = BADGE[cat];
  const amt = amountOf(entry, cat);
  const isCashout = cat === "cashout";
  const flagCode = entry.offramp?.provider === "linq" ? "ng" : "us";

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={[styles.badge, { backgroundColor: badge.bg }]}>
        {badge.symbol.startsWith("hi.") ? (
          <HugeIcon name={badge.symbol} size={18} color={badge.fg} />
        ) : (
          <Icon name={badge.symbol} size={17} color={badge.fg} />
        )}
        {isCashout ? (
          <View style={styles.flagRing}>
            <Flag code={flagCode} size={16} />
          </View>
        ) : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title} numberOfLines={1}>{titleOf(entry, cat)}</Text>
        <Text style={styles.sub}>{subtitleOf(entry)}</Text>
      </View>
      <Text style={[styles.amount, { color: hidden ? colors.fgMuted : amt.color }]}>
        {hidden ? "••••" : amt.text}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, paddingVertical: 12 },
  pressed: { backgroundColor: colors.surface2, borderRadius: 14 },
  badge: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  flagRing: {
    position: "absolute",
    right: -2,
    bottom: -2,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.bg,
    overflow: "hidden",
  },
  title: { fontFamily: family.sans, fontSize: 15, fontWeight: "400", color: colors.fg, letterSpacing: -0.3 },
  sub: { fontFamily: family.mono, fontSize: 11, color: colors.fgDim, marginTop: 3 },
  amount: { fontFamily: family.sans, fontSize: 14, fontWeight: "300", letterSpacing: -0.56 },
});
