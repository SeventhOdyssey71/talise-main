"use client";

import { useState } from "react";
import { useCurrency } from "@/components/app";
import { DirectionBadge, tintColor } from "./DirectionBadge";
import {
  type ActivityRow,
  categoryOf,
  titleOf,
  counterpartyLabel,
  relativeTime,
  isInflow,
  otherCoinOf,
  formatCoinAmount,
} from "./types";

/**
 * One activity row. Neutral liquid-glass at rest; on hover/press it picks up
 * a faint directional tint (red = sent, green = received/withdraw, mint =
 * invest/swap). The whole row is a button that opens the receipt sheet.
 *
 * Layout is responsive without a media query: the badge + title/subtitle
 * stack flexes left, the amount sits hard-right with tabular numerals, so it
 * reads as a comfortable wide list row on desktop and a stacked card on
 * mobile.
 */
export function HistoryRow({
  row,
  onOpen,
}: {
  row: ActivityRow;
  onOpen: () => void;
}) {
  const { formatLocal } = useCurrency();
  const [hover, setHover] = useState(false);
  const category = categoryOf(row);
  const tint = tintColor(category);
  const sub = counterpartyLabel(row);
  const time = relativeTime(row.timestampMs);

  return (
    <button
      type="button"
      onClick={onOpen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onPointerDown={() => setHover(true)}
      onPointerUp={() => setHover(false)}
      className="talise-glass group relative flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-[transform,background-color] duration-200 ease-out active:scale-[0.995] sm:px-5"
      style={{ borderRadius: 18 }}
    >
      {/* Directional tint wash — only while hovered/pressed */}
      {tint && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 transition-opacity duration-200"
          style={{
            borderRadius: 18,
            background: `color-mix(in srgb, ${tint} 16%, transparent)`,
            opacity: hover ? 1 : 0,
          }}
        />
      )}
      <span className="relative flex min-w-0 flex-1 items-center gap-3.5">
        <DirectionBadge category={category} />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span
            className="truncate text-[14px] font-medium text-fg"
            style={{ letterSpacing: "-0.01em" }}
          >
            {titleOf(row)}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-fg-dim">
            {sub && <span className="truncate">{sub}</span>}
            {sub && <span className="text-fg-dim/50">·</span>}
            <span className="shrink-0">{time}</span>
          </span>
        </span>
      </span>
      <span className="relative shrink-0 pl-2">
        <Amount row={row} formatLocal={formatLocal} />
      </span>
    </button>
  );
}

/** Trailing amount. Swaps render "X → Y"; everything else a signed credit. */
function Amount({
  row,
  formatLocal,
}: {
  row: ActivityRow;
  formatLocal: (usd: number, o?: { fixed?: boolean }) => string;
}) {
  const category = categoryOf(row);
  const coin = otherCoinOf(row);

  if (category === "swap") {
    const legs: string[] = [];
    if (row.amountSui && row.amountSui > 0) {
      legs.push(`${row.amountSui.toFixed(4).replace(/\.?0+$/, "")} SUI`);
    }
    if (coin && coin.symbol.toUpperCase() !== "USDSUI") {
      legs.push(`${formatCoinAmount(coin)} ${coin.symbol}`);
    }
    if (row.amountUsdsui && row.amountUsdsui > 0) {
      legs.push(formatLocal(Math.abs(row.amountUsdsui), { fixed: true }));
    }
    const text =
      legs.length === 0
        ? "—"
        : legs.length === 1
          ? `→ ${legs[0]}`
          : `${legs[0]} → ${legs[1]}`;
    return (
      <span className="whitespace-nowrap text-[13px] tabular-nums text-fg-muted">
        {text}
      </span>
    );
  }

  const inflow = isInflow(row);
  const prefix = inflow ? "+" : "-";
  const color = inflow ? "text-accent" : "text-fg";

  let text: string;
  if (coin && coin.symbol.toUpperCase() !== "USDSUI") {
    text = `${prefix}${formatCoinAmount(coin)} ${coin.symbol}`;
  } else if (row.amountUsdsui != null) {
    text = `${prefix}${formatLocal(Math.abs(row.amountUsdsui), { fixed: true })}`;
  } else if (row.amountSui != null) {
    text = `${prefix}${Math.abs(row.amountSui).toFixed(4).replace(/\.?0+$/, "")} SUI`;
  } else {
    text = `${prefix}—`;
  }

  return (
    <span
      className={`whitespace-nowrap text-[15px] font-medium tabular-nums ${color}`}
      style={{ letterSpacing: "-0.02em" }}
    >
      {text}
    </span>
  );
}
