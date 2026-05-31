import { cookies } from "next/headers";
import { sign, verify } from "./auth";

const SESSION_COOKIE = "talise_session";
const STATE_COOKIE = "talise_oauth_state";

export async function setStateCookie(state: string) {
  const jar = await cookies();
  jar.set(STATE_COOKIE, sign(state), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 300,
  });
}

export async function readStateCookie(): Promise<string | null> {
  const jar = await cookies();
  const raw = jar.get(STATE_COOKIE)?.value;
  if (!raw) return null;
  return verify(raw);
}

export async function clearStateCookie() {
  const jar = await cookies();
  jar.delete(STATE_COOKIE);
}

export async function setSessionCookie(entryId: number) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, sign(String(entryId)), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

export async function readSessionEntryId(): Promise<number | null> {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const v = verify(raw);
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function clearSession() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

const REFERRAL_COOKIE = "talise_ref";

/**
 * Persist a referral code captured from `?ref=` on the landing page. We sign
 * the value so a hostile client can't forge attribution. 30-day TTL — plenty
 * of time for a slow-to-decide visitor to come back and sign up.
 */
export async function setReferralCookie(code: string) {
  const jar = await cookies();
  jar.set(REFERRAL_COOKIE, sign(code), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function readReferralCookie(): Promise<string | null> {
  const jar = await cookies();
  const raw = jar.get(REFERRAL_COOKIE)?.value;
  if (!raw) return null;
  return verify(raw);
}

export async function clearReferralCookie() {
  const jar = await cookies();
  jar.delete(REFERRAL_COOKIE);
}

const RETURN_TO_COOKIE = "talise_return_to";

/**
 * Validate a `returnTo` value as a SAME-ORIGIN absolute path only.
 *
 * `path.startsWith("/")` alone is NOT enough — a protocol-relative URL
 * like `//evil.com` (and the backslash variant `/\evil.com`, which
 * browsers normalize to `//evil.com`) also starts with `/`, and
 * `new URL("//evil.com", origin)` resolves to `https://evil.com`. That
 * turns the post-sign-in redirect into an open redirect: an attacker
 * seeds the cookie, the victim completes a real Google consent screen,
 * and the callback 302s them to the attacker's domain — phishing-grade.
 *
 * Accept only: starts with a single `/`, NOT followed by `/` or `\`,
 * no backslashes anywhere, no control chars, ≤256 chars. Returns the
 * path if safe, else null.
 */
export function safeReturnPath(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.length > 256) return null;
  if (path[0] !== "/") return null;
  // protocol-relative ("//host") or backslash trick ("/\host")
  if (path[1] === "/" || path[1] === "\\") return null;
  if (path.includes("\\")) return null;
  // control chars (incl. CR/LF) and whitespace-leading tricks
  if (/[\x00-\x20\x7f]/.test(path)) return null;
  return path;
}

export async function setReturnTo(path: string) {
  const safe = safeReturnPath(path);
  if (!safe) return;
  const jar = await cookies();
  jar.set(RETURN_TO_COOKIE, sign(safe), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600, // 10 minutes
  });
}

export async function consumeReturnTo(): Promise<string | null> {
  const jar = await cookies();
  const raw = jar.get(RETURN_TO_COOKIE)?.value;
  if (!raw) return null;
  const v = verify(raw);
  jar.delete(RETURN_TO_COOKIE);
  // Re-validate on read too — defence in depth against a cookie minted
  // before this validation existed (or by any other writer).
  return safeReturnPath(v);
}
