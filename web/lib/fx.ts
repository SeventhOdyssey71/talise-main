/**
 * Thin FX/currency layer for Talise.
 *
 * The underlying balance is held in USDsui (Sui-native USD, pegged 1:1 to
 * USD just like USDC). Users see a local African currency (Naira ₦ by
 * default) as primary, with USD as a small secondary line.
 *
 * Rates are a hardcoded Q2 2026 snapshot; a live feed will replace `FX` later.
 * No I/O — these helpers are pure.
 */

export type Currency = "NGN" | "KES" | "GHS" | "ZAR" | "USD";

/** Units of `currency` per 1 USD. */
export const FX: Record<Currency, number> = {
  NGN: 1620,
  KES: 132,
  GHS: 14,
  ZAR: 18.5,
  USD: 1,
};

/** Display prefix for each currency (note trailing space on multi-char prefixes). */
export const SYMBOL: Record<Currency, string> = {
  NGN: "₦",
  KES: "KSh ",
  GHS: "GH₵ ",
  ZAR: "R ",
  USD: "$",
};

/**
 * Convert a USDsui amount (treated 1:1 with USD) to the given local currency.
 * Returns a number rounded to whole units for NGN/KES/GHS and 2 decimals for ZAR/USD.
 */
export function usdcToLocal(amountUsdsui: number, currency: Currency): number {
  const raw = amountUsdsui * FX[currency];
  if (currency === "ZAR" || currency === "USD") {
    return Math.round(raw * 100) / 100;
  }
  return Math.round(raw);
}

/** Locale used for grouping/decimals in each currency's display. */
const LOCALE: Record<Currency, string> = {
  NGN: "en-NG",
  KES: "en-KE",
  GHS: "en-GH",
  ZAR: "en-ZA",
  USD: "en-US",
};

/**
 * Format a USDsui balance for display in the given local currency.
 * e.g. `formatLocal(100, "NGN")` -> `"₦162,000"`,
 *      `formatLocal(100, "USD")` -> `"$100.00"`.
 */
export function formatLocal(amountUsdsui: number, currency: Currency): string {
  const local = usdcToLocal(amountUsdsui, currency);
  const fractionDigits = currency === "ZAR" || currency === "USD" ? 2 : 0;
  const formatted = new Intl.NumberFormat(LOCALE[currency], {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(local);
  return `${SYMBOL[currency]}${formatted}`;
}

/** Default display currency. Geo-detection will replace this later. */
export function defaultCurrency(): Currency {
  return "NGN";
}

/**
 * Inverse of `usdcToLocal`. Convert a local-currency amount back to USDsui
 * (treated 1:1 with USD). Used when the user types an amount in their
 * preferred currency and we need to settle in USDsui under the hood.
 */
export function localToUsdsui(amountLocal: number, currency: Currency): number {
  return amountLocal / FX[currency];
}
