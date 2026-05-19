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

const RETURN_TO_COOKIE = "talise_return_to";

export async function setReturnTo(path: string) {
  if (!path.startsWith("/") || path.length > 256) return;
  const jar = await cookies();
  jar.set(RETURN_TO_COOKIE, sign(path), {
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
  if (!v || !v.startsWith("/")) return null;
  return v;
}
