import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowUpRightIcon,
  ArrowDownLeftIcon,
  PlantIcon,
  ArrowDataTransferHorizontalIcon,
  Coins01Icon,
} from "@hugeicons/core-free-icons";
import type { Category } from "./types";

/**
 * Directional palette — mirrors the iOS HistoryRow/TxReceipt treatment:
 *   sent     → dusty red
 *   received → forest green
 *   withdraw → forest green (pool → wallet credit)
 *   invest   → Talise mint accent (yield motion)
 *   swap     → Talise mint accent (system/DEX conversion)
 *   neutral  → plain glass
 *
 * The disc fill is a low-alpha wash of the colour; the glyph sits at a
 * brighter saturation so it reads as a coloured icon on a coloured disc.
 */
const RED = "#c95a4a";
const RED_FG = "#f0a99e";
const GREEN = "#4fb35e";
const GREEN_FG = "#a9dfb3";

export type BadgeStyle = {
  bg: string;
  fg: string;
  icon: typeof ArrowUpRightIcon;
};

export function badgeStyle(category: Category): BadgeStyle {
  switch (category) {
    case "sent":
      return {
        bg: `color-mix(in srgb, ${RED} 30%, transparent)`,
        fg: RED_FG,
        icon: ArrowUpRightIcon,
      };
    case "received":
      return {
        bg: `color-mix(in srgb, ${GREEN} 30%, transparent)`,
        fg: GREEN_FG,
        icon: ArrowDownLeftIcon,
      };
    case "withdraw":
      return {
        bg: `color-mix(in srgb, ${GREEN} 30%, transparent)`,
        fg: GREEN_FG,
        icon: PlantIcon,
      };
    case "invest":
      return {
        bg: "color-mix(in srgb, var(--color-accent) 20%, transparent)",
        fg: "var(--color-accent)",
        icon: PlantIcon,
      };
    case "swap":
      return {
        bg: "color-mix(in srgb, var(--color-accent) 20%, transparent)",
        fg: "var(--color-accent)",
        icon: ArrowDataTransferHorizontalIcon,
      };
    default:
      return {
        bg: "var(--color-surface-2)",
        fg: "var(--color-fg)",
        icon: Coins01Icon,
      };
  }
}

/** The directional tint used on row hover/press (transparent for neutral). */
export function tintColor(category: Category): string | null {
  switch (category) {
    case "sent":
      return RED;
    case "received":
    case "withdraw":
      return GREEN;
    case "invest":
    case "swap":
      return "var(--color-accent)";
    default:
      return null;
  }
}

export function DirectionBadge({
  category,
  size = 38,
  iconSize,
}: {
  category: Category;
  size?: number;
  iconSize?: number;
}) {
  const s = badgeStyle(category);
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full"
      style={{ width: size, height: size, background: s.bg }}
    >
      <HugeiconsIcon
        icon={s.icon}
        size={iconSize ?? Math.round(size * 0.42)}
        color={s.fg}
        strokeWidth={2}
      />
    </span>
  );
}
