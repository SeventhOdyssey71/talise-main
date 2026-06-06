"use client";

import { useCurrency } from "@/components/app";
import { DirectionBadge } from "./DirectionBadge";
import {
  type ActivityRow,
  type Category,
  categoryOf,
  titleOf,
  counterpartyLabel,
  relativeTime,
  isInflow,
  otherCoinOf,
  formatCoinAmount,
} from "./types";

/**
 * One activity row. Borderless at rest; on hover it picks up a faint
 * directional fill (warm red = sent, forest = received/invest/swap) via the
 * `.talise-history-row` rule in globals.css.
 *
 * Wise-style layout: circular direction chip (size-9, accent-soft disc) left,
 * title + grey sublabel middle, big tabular amount right.
 */
export function HistoryRow({
  row,
  onOpen,
}: {
  row: ActivityRow;
  onOpen: () => void;
}) {
  const { formatLocal } = useCurrency();
  const category = categoryOf(row);
  const sub = counterpartyLabel(row);
  const time = relativeTime(row.timestampMs);

  return (
    <button
      type="button"
      onClick={onOpen}
      data-direction={directionAttr(category)}
      className="talise-history-row group relative flex w-full items-center gap-3 px-3 py-3 text-left transition-[transform,background-color,border-color] duration-150 ease-out active:scale-[0.995]"
    >
      {/* Direction chip — circular, size-9 (36px) */}
      <DirectionBadge category={category} />

      {/* Title + sublabel */}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className="truncate text-[14px] font-medium text-fg"
          style={{ letterSpacing: "-0.01em" }}
        >
          {titleOf(row)}
        </span>
        <span className="flex min-w-0 items-center gap-1 text-[12px] text-fg-dim">
          {sub && <span className="truncate">{sub}</span>}
          {sub && <span className="opacity-40">·</span>}
          <span className="shrink-0">{time}</span>
        </span>
      </span>

      {/* Amount — tabular, semibold for inflow (forest), medium for outflow (ink) */}
      <span className="relative shrink-0 pl-2">
        <Amount row={row} formatLocal={formatLocal} />
      </span>
    </button>
  );
}

/**
 * Map category onto the `data-direction` attribute consumed by the
 * `.app-clean .talise-history-row` hover rules in globals.css.
 */
function directionAttr(
  category: Category
): "sent" | "received" | "invest" | "withdraw" | undefined {
  switch (category) {
    case "sent":
      return "sent";
    case "received":
      return "received";
    case "withdraw":
      return "withdraw";
    case "invest":
    case "swap":
      return "invest";
    default:
      return undefined;
  }
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
  const prefix = inflow ? "+" : "−";
  // Inflow = forest green (positive credit); outflow = ink (neutral debit)
  const color = inflow ? "text-accent" : "text-fg";
  const weight = "font-semibold";

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
      className={`whitespace-nowrap text-[15px] tabular-nums ${weight} ${color}`}
      style={{ letterSpacing: "-0.02em" }}
    >
      {text}
    </span>
  );
}
