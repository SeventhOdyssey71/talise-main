import * as WebBrowser from "expo-web-browser";

import { API_BASE } from "@/api/client";

/**
 * Server-mediated Google OAuth — matches ios GoogleSignInService. We do NOT use
 * the native Google SDK or app-side PKCE: the wallet address derives from the
 * JWT's (iss, aud, sub), so we must go through the WEB OAuth client server-side
 * (same `aud` → same Sui address as web). Open /api/auth/mobile/start with the
 * base64URL ephemeral pubkey; the backend runs OAuth and redirects to
 * talise://auth/callback?token&userId&existing.
 */

export class AuthCancelled extends Error {
  constructor() {
    super("Sign-in cancelled");
    this.name = "AuthCancelled";
  }
}

export type OAuthResult = { token: string; userId: string; existing: boolean };

const REDIRECT = "talise://auth/callback";

export async function googleSignIn(ephemeralPubKeyB64Url: string): Promise<OAuthResult> {
  const startUrl = `${API_BASE}/api/auth/mobile/start?ephemeralPubKey=${encodeURIComponent(ephemeralPubKeyB64Url)}`;
  const res = await WebBrowser.openAuthSessionAsync(startUrl, REDIRECT);

  if (res.type === "cancel" || res.type === "dismiss" || res.type === "locked") {
    throw new AuthCancelled();
  }
  if (res.type !== "success" || !res.url) {
    throw new Error("Sign-in did not complete.");
  }

  const q = parseQuery(res.url);
  const err = q.err ?? q.error;
  if (err) throw new Error(decodeURIComponent(err));
  const token = q.token;
  const userId = q.userId;
  if (!token || !userId) throw new Error("Sign-in returned no session.");
  return { token, userId, existing: q.existing === "1" };
}

/** Parse a callback URL's query string without relying on RN's URL polyfill. */
function parseQuery(url: string): Record<string, string> {
  const qi = url.indexOf("?");
  if (qi < 0) return {};
  const out: Record<string, string> = {};
  for (const pair of url.slice(qi + 1).split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const key = eq < 0 ? pair : pair.slice(0, eq);
    const val = eq < 0 ? "" : pair.slice(eq + 1);
    out[decodeURIComponent(key)] = val;
  }
  return out;
}
