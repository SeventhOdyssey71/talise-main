import { api, ApiError } from "@/api/client";

/**
 * Shared money-tools helpers — DTOs + rails verbatim from the ios money features
 * (Cheques/Streams/Invoices/Contracts/Requests/Rules). USD is shown to 2dp; wire
 * amounts are micros (1e6) as strings for BigInt safety.
 */

export function usdToMicros(usd: number): string {
  return String(Math.round(usd * 1_000_000));
}
export function microsToUsd(micros: string | number): number {
  return Number(micros) / 1_000_000;
}

/** "$1,234.50" — 2dp USD. */
export function fmtUsd(usd: number): string {
  return `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function shortAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

/**
 * Maps a money-tool failure to friendly copy. Rollout-gated endpoints (404/503 or
 * a "disabled"/"not configured"/"unavailable" message) get a "rolling out" line;
 * 429 a rate-limit line; otherwise the server's own error string, else fallback.
 * Mirrors the ios status mapping shared across the money features.
 */
export function moneyErrorCopy(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const msg = (err.message || "").toLowerCase();
    if (
      err.status === 404 ||
      err.status === 503 ||
      msg.includes("disabled") ||
      msg.includes("not configured") ||
      msg.includes("not found") ||
      msg.includes("unavailable")
    ) {
      return "This is rolling out — check back soon.";
    }
    if (err.status === 429) return "Too many requests — give it a moment and try again.";
    if (err.message) return err.message;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export type ResolvedRecipient = { address: string; display: string };

/** GET /api/recipient/resolve?q= — @handle | name.talise.sui | 0x address → address + label. */
export async function resolveRecipient(q: string, signal?: AbortSignal): Promise<ResolvedRecipient> {
  const r = await api<{ address?: string; displayName?: string; display?: string }>(
    `/api/recipient/resolve?q=${encodeURIComponent(q.trim())}`,
    { signal },
  );
  if (!r.address) throw new Error("No one found by that name");
  return { address: r.address, display: r.display ?? r.displayName ?? shortAddr(r.address) };
}

export { ApiError };
