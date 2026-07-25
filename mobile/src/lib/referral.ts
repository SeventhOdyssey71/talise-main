import AsyncStorage from "@react-native-async-storage/async-storage";

import { api } from "@/api/client";

/**
 * Referral capture + attribution for the native app.
 *
 * Why this exists: web attribution reads a signed httpOnly cookie set by
 * `/r/<CODE>`. A native app has no cookie jar, and the sign-in leg
 * (`/api/auth/mobile/start` → `/auth/callback` → `talise://auth/callback`) never
 * carries one, so EVERY invite that produced an app install was silently
 * unattributed. The device therefore has to remember the code itself.
 *
 * Flow:
 *   1. An invite deep link (`https://talise.io/r/<CODE>`, now claimed via
 *      assetlinks.json, or `talise://r/<CODE>`) hits `app/r/[code].tsx`, which
 *      calls `capturePendingReferral`.
 *   2. The code is stashed in AsyncStorage with a 30-day window, mirroring the
 *      web cookie's TTL, so an install-now-sign-in-later user still counts.
 *   3. Right after the FIRST sign-in, `claimPendingReferral` posts it to
 *      /api/auth/exchange/referral with the freshly issued bearer.
 *
 * The server decides everything that matters: it takes the referee from the
 * bearer (so you can only attribute yourself), refuses unless the account row
 * is minutes old, refuses self-referral, and claims the referee with an atomic
 * compare-and-swap so exactly one inviter is ever credited. This file is only
 * a courier.
 */

const PENDING_KEY = "io.talise.referral.pending.v1";

/** Mirrors REFERRAL_CODE_RE in web/lib/db.ts (no ambiguous O/I/L/0/1). */
const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;

/** Same 30-day window as the web `talise_ref` cookie. */
const PENDING_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type Pending = { code: string; at: number };

/** Uppercase + validate, or null. */
export function normalizeReferralCode(raw: string | null | undefined): string | null {
  const code = (raw ?? "").trim().toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

/**
 * Pull a referral code out of any invite URL shape we hand out or accept:
 *   https://www.talise.io/r/ABCD2345
 *   talise://r/ABCD2345
 *   https://talise.io/?ref=ABCD2345
 * Returns null when there isn't a valid one. Deliberately string-based, RN's
 * URL polyfill is inconsistent about `host` for custom schemes.
 */
export function parseReferralCode(url: string): string | null {
  if (!url) return null;
  const [beforeHash] = url.split("#");
  const [path, query = ""] = beforeHash.split("?");

  // …/r/<CODE> for https, talise://r/<CODE> for the custom scheme.
  const m = path.match(/(?:^talise:\/\/r\/|\/r\/)([^/?#]+)/i);
  const fromPath = normalizeReferralCode(m?.[1] ? decodeURIComponent(m[1]) : null);
  if (fromPath) return fromPath;

  for (const pair of query.split("&")) {
    const eq = pair.indexOf("=");
    const key = eq < 0 ? pair : pair.slice(0, eq);
    if (decodeURIComponent(key) !== "ref") continue;
    const val = eq < 0 ? "" : decodeURIComponent(pair.slice(eq + 1));
    return normalizeReferralCode(val);
  }
  return null;
}

/** Stash a code for the next sign-in. No-op for an invalid code. */
export async function capturePendingReferral(code: string | null): Promise<string | null> {
  const valid = normalizeReferralCode(code);
  if (!valid) return null;
  const payload: Pending = { code: valid, at: Date.now() };
  try {
    await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(payload));
  } catch {
    /* storage full / unavailable: attribution is best-effort, never fatal */
  }
  return valid;
}

/** Capture straight from a deep-link URL. Returns the code it stored, if any. */
export function capturePendingReferralFromUrl(url: string): Promise<string | null> {
  return capturePendingReferral(parseReferralCode(url));
}

/** The stored code, or null when absent / malformed / past its 30-day window. */
export async function pendingReferral(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Pending;
    const code = normalizeReferralCode(p?.code);
    if (!code) return null;
    if (!p.at || Date.now() - p.at > PENDING_TTL_MS) {
      await clearPendingReferral();
      return null;
    }
    return code;
  } catch {
    return null;
  }
}

export async function clearPendingReferral(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PENDING_KEY);
  } catch {
    /* no-op */
  }
}

/**
 * Post the pending code after a first sign-in. Call once the bearer is set.
 *
 * Clears the pending code on any DEFINITIVE answer (credited, or refused for a
 * reason that will never change: stale link, already attributed, own code).
 * A network/5xx failure keeps it so the next launch can retry. Never throws,
 * this hangs off the sign-in path and must not be able to block it.
 */
export async function claimPendingReferral(): Promise<{ ok: boolean; reason?: string } | null> {
  const code = await pendingReferral();
  if (!code) return null;
  try {
    const res = await api<{ ok: boolean; reason?: string }>("/api/auth/exchange/referral", {
      method: "POST",
      body: { code },
    });
    await clearPendingReferral();
    return res;
  } catch {
    // Transient (offline, 5xx, timeout). Leave it queued; the server's
    // first-sign-in window is 30 minutes, so a retry can still land.
    return null;
  }
}

/**
 * Tell the server an invite left the device. This is the DENOMINATOR of
 * K-factor, without it "invites per user" is unknowable. Fire-and-forget.
 */
export function reportInviteSent(code: string, channel: "share" | "copy"): void {
  const valid = normalizeReferralCode(code);
  if (!valid) return;
  void api("/api/referral/event", {
    method: "POST",
    body: { name: "invite_sent", code: valid, surface: "android", channel },
  }).catch(() => {});
}

/**
 * Tell the server an invite deep link opened the APP. Once /r/* is a verified
 * App Link the web handler never runs for users who have Talise installed, so
 * their clicks would otherwise vanish from the funnel. Unauthenticated is fine,
 * the clicker usually isn't signed in yet.
 */
export function reportInviteClicked(code: string): void {
  const valid = normalizeReferralCode(code);
  if (!valid) return;
  void api("/api/referral/event", {
    method: "POST",
    body: { name: "invite_clicked", code: valid, surface: "android" },
  }).catch(() => {});
}

/**
 * OFFLINE FALLBACK ONLY. The canonical invite copy lives in
 * web/components/app/rewards/share-copy.ts and arrives on the `share` block of
 * /api/referral/summary; render that whenever it is present. This mirror exists
 * so a share still works against an older server or a cold cache. Keep the two
 * in sync (no em-dashes, a send finalizes "in under a second").
 */
export const INVITE_SHARE_FALLBACK_TEXT =
  "Join me on Talise. Send dollars to anyone, anywhere, and it finalizes in under a second.";

/** Canonical invite URL. Matches `inviteUrl` in share-copy.ts. */
export function inviteUrl(code: string): string {
  return `https://www.talise.io/r/${code.trim().toUpperCase()}`;
}

/** Fallback share payload when the server didn't send one. */
export function inviteShareFallback(code: string): string {
  return `${INVITE_SHARE_FALLBACK_TEXT} ${inviteUrl(code)}`;
}
