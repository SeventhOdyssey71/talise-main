import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { sign } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * Kick off the OAuth flow from inside ASWebAuthenticationSession on iOS.
 *
 * Difference from the web flow:
 * - The web app generates `state` client-side and POSTs it to /api/auth/state
 *   before redirecting. The mobile webview can't do that — it can only follow
 *   a redirect. So this endpoint generates state server-side, stashes it in
 *   the same `talise_oauth_state` cookie, AND tags the state with a `m1.`
 *   prefix so the callback knows to redirect to the talise:// scheme.
 *
 * The `ephemeralPubKey` query param ties the OAuth nonce to the device's
 * Secure Enclave key so a hostile redirect can't bind the session to a
 * different key. Stored alongside the state cookie under the same TTL.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const ephemeralPubKey = url.searchParams.get("ephemeralPubKey") ?? "";
  if (ephemeralPubKey.length < 8 || ephemeralPubKey.length > 256) {
    return NextResponse.json({ error: "bad ephemeralPubKey" }, { status: 400 });
  }

  const rawState = randomBytes(24).toString("base64url");
  // m1. prefix signals "mobile callback" — pop in /auth/callback.
  const state = `m1.${rawState}`;

  const jar = await cookies();
  jar.set("talise_oauth_state", sign(state), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 300,
  });
  jar.set("talise_mobile_pubkey", sign(ephemeralPubKey), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 300,
  });

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return NextResponse.json({ error: "oauth not configured" }, { status: 500 });
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce: rawState,
    prompt: "select_account",
  });
  return NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  );
}
