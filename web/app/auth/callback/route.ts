import { NextResponse } from "next/server";
import { redirectUriFromRequest } from "@/lib/auth";
import { clearStateCookie, readStateCookie, cookieDomain } from "@/lib/session";
import { completeSignIn } from "@/lib/auth-exchange";
import { issueMobileBearer } from "@/lib/mobile-sessions";

export const runtime = "nodejs";

/**
 * GET /auth/callback — Google's OAuth redirect target.
 *
 * Three flows split here, by the shape of the OAuth `state`:
 *
 *   • WEB (default): NO work on this request. Bounce instantly to /auth/finish,
 *     which POSTs code+state to /api/auth/exchange so the staged loader animates
 *     WHILE the real exchange runs. The exchange validates + consumes the state.
 *
 *   • MOBILE (`m1.` prefix, from /api/auth/mobile/start): single-request flow —
 *     ASWebAuthenticationSession needs a plain redirect to the `talise://` scheme,
 *     so we run the full exchange here and bounce with the bearer.
 *
 *   • CLI (`cli.<port>.<csrf>.…` prefix, from /api/auth/cli/start): same exchange
 *     as mobile, but redirect the bearer + the zkLogin binding (maxEpoch,
 *     randomness) to the CLI's loopback server on http://127.0.0.1:<port> so
 *     `talise login` can sign locally. The ephemeral private key never leaves the
 *     user's machine — only the maxEpoch/randomness it was bound to travel back.
 */
function redirectAuthError(req: Request, state: string | null, err: string): NextResponse {
  if (state && state.startsWith("cli.")) {
    const parsed = parseCliState(state);
    if (parsed) {
      const cb = new URL(`http://127.0.0.1:${parsed.port}/cb`);
      cb.searchParams.set("err", err);
      cb.searchParams.set("csrf", parsed.csrf);
      return NextResponse.redirect(cb.toString());
    }
  }
  if (state && state.startsWith("m1.")) {
    const callback = new URL("talise://auth/callback");
    callback.searchParams.set("err", err);
    return NextResponse.redirect(callback.toString());
  }
  return NextResponse.redirect(new URL(`/?err=${encodeURIComponent(err)}`, req.url));
}

/** Parse `cli.<port>.<csrf>.<rand>` — port + csrf to build the loopback redirect. */
function parseCliState(state: string): { port: number; csrf: string } | null {
  const parts = state.split(".");
  // ["cli", "<port>", "<csrf>", "<rand…>"] — csrf is base64url (no dots), rand may
  // itself be dot-free base64url, so exactly 4 segments.
  if (parts.length < 4 || parts[0] !== "cli") return null;
  const port = Number(parts[1]);
  const csrf = parts[2] ?? "";
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return null;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(csrf)) return null;
  return { port, csrf };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    const safe = /^[a-z_]{1,40}$/.test(error) ? error : "oauth_error";
    return redirectAuthError(req, state, safe);
  }
  if (!code || !state) {
    return redirectAuthError(req, state, "missing_code");
  }

  // ── CLI: run the full exchange, then redirect the bearer + binding to the
  // loopback server. Handled BEFORE the web branch because a `cli.` state does
  // not start with `m1.` and would otherwise be misrouted to /auth/finish.
  if (state.startsWith("cli.")) {
    const parsed = parseCliState(state);
    if (!parsed) return redirectAuthError(req, state, "bad_state");
    const done = await completeMobileExchange(req, state);
    if (!done.ok) return redirectAuthError(req, state, done.err);
    const cb = new URL(`http://127.0.0.1:${parsed.port}/cb`);
    cb.searchParams.set("token", done.bearer);
    cb.searchParams.set("userId", String(done.userId));
    cb.searchParams.set("csrf", parsed.csrf);
    cb.searchParams.set("existing", done.isNew ? "0" : "1");
    // The CLI needs the exact binding it will sign against.
    if (done.maxEpoch != null) cb.searchParams.set("maxEpoch", String(done.maxEpoch));
    if (done.randomness) cb.searchParams.set("randomness", done.randomness);
    return NextResponse.redirect(cb.toString());
  }

  // ── WEB: hand off to the staged-loader page WITHOUT consuming the state
  // cookie — /api/auth/exchange validates + clears it.
  if (!state.startsWith("m1.")) {
    const finish = new URL("/auth/finish", req.url);
    finish.searchParams.set("code", code);
    finish.searchParams.set("state", state);
    return NextResponse.redirect(finish);
  }

  // ── MOBILE (`m1.`): full exchange, bounce to the app scheme.
  const done = await completeMobileExchange(req, state);
  if (!done.ok) return redirectAuthError(req, state, done.err);
  const callback = new URL("talise://auth/callback");
  callback.searchParams.set("token", done.bearer);
  callback.searchParams.set("userId", String(done.userId));
  callback.searchParams.set("existing", done.isNew ? "0" : "1");
  return NextResponse.redirect(callback.toString());
}

type ExchangeResult =
  | {
      ok: true;
      bearer: string;
      userId: number | string;
      isNew: boolean;
      maxEpoch: number | null;
      randomness: string | null;
    }
  | { ok: false; err: string };

/**
 * Shared mobile/CLI leg: validate the state cookie, read the (ephPubKey,
 * maxEpoch, randomness) binding stashed by the start route, complete the Google
 * sign-in, persist the signing material into `mobile_sessions`, and mint the
 * bearer. Returns the bearer + the binding the client must sign against.
 */
async function completeMobileExchange(req: Request, state: string): Promise<ExchangeResult> {
  const expected = await readStateCookie();
  if (!expected || expected !== state) {
    return { ok: false, err: "bad_state" };
  }
  await clearStateCookie();

  const url = new URL(req.url);
  const code = url.searchParams.get("code")!;

  const result = await completeSignIn({
    code,
    redirectUri: redirectUriFromRequest(req),
    country: req.headers.get("x-vercel-ip-country"),
  });
  if (!result.ok) return { ok: false, err: result.err };
  const { user, idToken, isNew } = result;

  // Read the (ephPubKey, maxEpoch, randomness) triple stashed by the start route
  // so future proof mints recompute the same Poseidon nonce the prover checks.
  const { cookies: cookieJar } = await import("next/headers");
  const { verify } = await import("@/lib/auth");
  const jar = await cookieJar();
  const bindingRaw = jar.get("talise_m1_binding")?.value;
  let bindingPubKey: string | null = null;
  let bindingMaxEpoch: number | null = null;
  let bindingRandomness: string | null = null;
  if (bindingRaw) {
    const verified = verify(bindingRaw);
    if (verified) {
      try {
        const decoded = JSON.parse(Buffer.from(verified, "base64url").toString("utf8"));
        bindingPubKey = decoded.ephemeralPubKey ?? null;
        bindingMaxEpoch = typeof decoded.maxEpoch === "number" ? decoded.maxEpoch : null;
        bindingRandomness = decoded.randomness ?? null;
      } catch {
        /* malformed — signing still works but a future send needs its own randomness */
      }
    }
  }
  // Clear with the SAME Domain/path the binding cookie was set with.
  jar.delete({ name: "talise_m1_binding", domain: cookieDomain(), path: "/" });

  const bearer = await issueMobileBearer(user.id, {
    jwt: idToken,
    salt: user.salt,
    ephemeralPubKeyB64: bindingPubKey ?? undefined,
    maxEpoch: bindingMaxEpoch ?? undefined,
    randomness: bindingRandomness ?? undefined,
  });

  return {
    ok: true,
    bearer,
    userId: user.id,
    isNew,
    maxEpoch: bindingMaxEpoch,
    randomness: bindingRandomness,
  };
}
