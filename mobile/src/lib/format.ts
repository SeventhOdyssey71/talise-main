/**
 * Money + time formatting — mirrors ios DesignSystem/TaliseFormat.swift.
 * Display currency defaults to USD; local2() becomes currency-aware when the
 * CurrencySettings/FX store lands (Profile phase).
 */

/** usd(v): under $1 → 4 decimals, otherwise 2. Locale en-US, literal "$". */
export function usd(v: number): string {
  const n = Number.isFinite(v) ? v : 0;
  const digits = Math.abs(n) < 1 ? 4 : 2;
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** usd2(v): always 2 decimals. */
export function usd2(v: number): string {
  const n = Number.isFinite(v) ? v : 0;
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** local2(usd): USD → display currency (currently USD 1:1), 2 decimals. */
export function local2(usdValue: number): string {
  return usd2(usdValue);
}

/** ngn(v): "₦142,350.00". */
export function ngn(v: number, decimals = 2): string {
  const n = Number.isFinite(v) ? v : 0;
  return "₦" + n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Abbreviated relative time ("just now", "5m", "3h", "2d", or a short date). */
export function relativeTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const diff = Date.now() - ms;
  if (diff < 0) return "now";
  const s = Math.floor(diff / 1000);
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** 0x6…4 short address. */
export function shortAddr(a: string | null | undefined): string {
  if (!a) return "";
  if (a.startsWith("0x") && a.length > 12) return `${a.slice(0, 6)}…${a.slice(-4)}`;
  return a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a;
}

/** Split a formatted money string at the last "." into whole + fractional parts. */
export function splitAmount(formatted: string): { whole: string; frac: string } {
  const i = formatted.lastIndexOf(".");
  if (i < 0) return { whole: formatted, frac: "" };
  return { whole: formatted.slice(0, i), frac: formatted.slice(i) };
}
