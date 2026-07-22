import { api } from "@/api/client";

/** Username / handle claim — `.talise.sui` subname. From ios ClaimHandleSheet.swift. */

export type UsernameReason = "taken" | "reserved" | "invalid" | "rpc" | string;

export const usernameApi = {
  /** Availability check — server mirrors the same normalize rules. */
  check: (u: string): Promise<{ available: boolean; reason?: UsernameReason | null }> =>
    api(`/api/username/check?u=${encodeURIComponent(u)}`),

  /** Claim — the operator wallet sponsors the SuiNS mint; the user pays nothing (plain REST). */
  claim: (username: string): Promise<{ ok?: boolean; username?: string; digest?: string; subnameNftId?: string; error?: string | null }> =>
    api("/api/username/claim", { method: "POST", body: { username } }),
};

/** Sanitize to [a-z0-9_], lowercase, max 20 — mirrors server normalizeHandle(). */
export function sanitizeHandle(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20);
}

export function handleValid(u: string): boolean {
  return u.length >= 3 && u.length <= 20 && /^[a-z0-9_]+$/.test(u);
}
