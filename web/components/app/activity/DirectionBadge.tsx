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
 * Directional palette — light-mint treatment. On the white→faint-mint
 * card the disc is a soft tinted fill and the glyph sits at full
 * saturation so it reads as a coloured icon on a coloured disc:
 *   sent     → warm danger red   (outflow)
 *   received → forest green       (inflow credit)
 *   withdraw → forest green       (pool → wallet credit)
 *   invest   → forest accent      (yield motion)
 *   swap     → forest accent      (system/DEX conversion)
 *   neutral  → pale-mint disc, forest glyph
 *
 * The disc fill is a low-alpha wash of the colour over white; the glyph
 * uses the deep saturation so it stays legible on the light canvas.
 */
const RED = "#c95a4a";
const RED_FG = "#b3473b";
const GREEN_FG = "var(--color-accent)";

export type BadgeStyle = {
  bg: string;
  fg: string;
  icon: typeof ArrowUpRightIcon;
};

export function badgeStyle(category: Category): BadgeStyle {
  switch (category) {
    case "sent":
      return {
        bg: `color-mix(in srgb, ${RED} 16%, #ffffff)`,
        fg: RED_FG,
        icon: ArrowUpRightIcon,
      };
    case "received":
      return {
        bg: "var(--color-accent-soft)",
        fg: GREEN_FG,
        icon: ArrowDownLeftIcon,
      };
    case "withdraw":
      return {
        bg: "var(--color-accent-soft)",
        fg: GREEN_FG,
        icon: PlantIcon,
      };
    case "invest":
      return {
        bg: "var(--color-accent-soft)",
        fg: "var(--color-accent)",
        icon: PlantIcon,
      };
    case "swap":
      return {
        bg: "var(--color-accent-soft)",
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
      return "var(--color-accent-deep)";
    case "invest":
    case "swap":
      return "var(--color-accent-deep)";
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
