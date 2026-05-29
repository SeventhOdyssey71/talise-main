import type { ActivityEntry } from "@/lib/activity";
import { formatLocal, type Currency } from "@/lib/fx";
import Link from "next/link";

/**
 * Single activity row — mirrors the iOS `HistoryRow.swift` layout.
 *
 *   ┌─────────────────────────────────────────────────┐
 *   │ ◯  Sent + saved                       −₦50.00   │
 *   │     27 min ago                       +₦2 to Navi │
 *   └─────────────────────────────────────────────────┘
 *
 *   • Icon disc tinted by direction (sent=red, received=green,
 *     invest=accent green, withdraw=mossy green).
 *   • Title varies by direction; compound spend+save renders a
 *     two-line amount stack with the round-up shown in accent green.
 *   • Whole row is a link to /home/[digest] (no detail page yet —
 *     for now just opens Suiscan in a new tab).
 */
export function HistoryRow({
  entry,
  currency = "NGN",
}: {
  entry: ActivityEntry;
  currency?: Currency;
}) {
  const { tint, fg, iconKey, title } = classify(entry);
  const amountPrimary = formatAmountPrimary(entry, currency);
  const isCompound = (entry.roundupUsdsui ?? 0) > 0;
  const relTime = formatRelativeTime(entry.timestampMs);

  return (
    <Link
      href={`https://suiscan.xyz/mainnet/tx/${entry.digest}`}
      target="_blank"
      rel="noreferrer noopener"
      className="talise-history-row block px-4 py-3"
      data-direction={entry.direction}
    >
      <div className="flex items-center gap-3.5">
        <div
          className="grid place-items-center w-8 h-8 rounded-full"
          style={{ background: `color-mix(in srgb, ${tint} 32%, transparent)` }}
        >
          <DirectionGlyph icon={iconKey} fg={fg} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] text-[var(--color-fg)] truncate">{title}</div>
          <div className="text-[10px] font-mono text-[var(--color-fg-dim)] mt-0.5">
            {relTime}
          </div>
        </div>
        <div className="text-right">
          <div
            className="text-[14px] text-[var(--color-fg)]"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {amountPrimary}
          </div>
          {isCompound ? (
            <div
              className="text-[10px] font-mono text-[var(--color-accent)] mt-0.5"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              + {formatLocal(entry.roundupUsdsui ?? 0, currency)} saved
            </div>
          ) : (
            <div className="text-[10px] font-mono text-[var(--color-fg-muted)] mt-0.5">
              Details
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

// ───────────────────────────────────────────────────────────────────
// Helpers — kept inline so the component file is self-contained.

function classify(entry: ActivityEntry) {
  const isCompound = (entry.roundupUsdsui ?? 0) > 0;
  const venue = entry.venue ?? "";
  const venueLabel =
    venue === "navi" ? "Navi" : venue === "deepbook" ? "Deepbook" : "";

  if (isCompound) {
    return {
      tint: "#c95a4a",
      fg: "#f0a99e",
      iconKey: "send" as const,
      title: "Sent + saved",
    };
  }
  switch (entry.direction) {
    case "received":
      return { tint: "#4fb35e", fg: "#a9dfb3", iconKey: "received" as const, title: "Received" };
    case "invest":
      return {
        tint: "#79d96c",
        fg: "#79d96c",
        iconKey: "leaf" as const,
        title: venueLabel ? `Invested in ${venueLabel}` : "Invested",
      };
    case "withdraw":
      return {
        tint: "#4fb35e",
        fg: "#a9dfb3",
        iconKey: "leaf" as const,
        title: venueLabel ? `Withdrew from ${venueLabel}` : "Withdrew",
      };
    default:
      return { tint: "#c95a4a", fg: "#f0a99e", iconKey: "send" as const, title: "Sent" };
  }
}

function DirectionGlyph({
  icon,
  fg,
}: {
  icon: "send" | "received" | "leaf";
  fg: string;
}) {
  if (icon === "leaf") {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill={fg} stroke={fg} strokeWidth="1.5">
        <path d="M20 4c-7 0-14 4-14 12 0 2 1 4 3 4 8 0 12-7 12-14a4 4 0 0 0-1-2z" />
      </svg>
    );
  }
  if (icon === "received") {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={fg} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 7 7 17" />
        <path d="M17 17H7V7" />
      </svg>
    );
  }
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={fg} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 17 17 7" />
      <path d="M7 7h10v10" />
    </svg>
  );
}

function formatAmountPrimary(e: ActivityEntry, ccy: Currency): string {
  const inflow = e.direction === "received" || e.direction === "withdraw";
  const sign = inflow ? "+" : "−";
  const usd = e.amountUsdsui ?? 0;
  if (usd > 0) return `${sign} ${formatLocal(usd, ccy)}`;
  const sui = e.amountSui ?? 0;
  if (sui > 0) return `${sign} ${sui.toFixed(4)} SUI`;
  return `${sign} —`;
}

function formatRelativeTime(ms: number): string {
  if (!ms) return "—";
  const diffMs = Date.now() - ms;
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec} sec ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day} day${day > 1 ? "s" : ""} ago`;
  return new Date(ms).toLocaleDateString();
}
