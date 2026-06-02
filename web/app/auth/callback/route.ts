import { NextResponse, after } from "next/server";
import {
  exchangeCodeForTokens,
  googleRedirectUri,
  redirectUriFromRequest,
} from "@/lib/auth";
import { decodeJwt, deriveSuiAddress, generateSalt } from "@/lib/zklogin";
import {
  upsertUser,
  userByGoogleSub,
  markNotified,
  realignAddress,
} from "@/lib/db";
import { shinamiEnabled, shinamiGetWallet } from "@/lib/shinami";
import {
  clearStateCookie,
  consumeReturnTo,
  readStateCookie,
  setSessionCookie,
} from "@/lib/session";
import { sendWelcomeWithAddress } from "@/lib/email";
import { setSigningCookie } from "@/lib/zksigner";
import { issueMobileBearer } from "@/lib/mobile-sessions";

export const runtime = "nodejs";

/**
 * Build the right "something went wrong" redirect for this leg of the auth
 * flow. The web flow sends users back to `/?err=...`; the mobile flow has
 * to bounce them through the `talise://` custom scheme so that
 * `ASWebAuthenticationSession` on iOS resolves and surfaces the error
 * inside the app — otherwise the in-app browser just lands on the public
 * web home page and the iOS continuation never fires.
 *
 * Mobile state strings are minted by `/api/auth/mobile/start` with an
 * `m1.` prefix; presence of that prefix is the unambiguous signal that
 * we owe the caller a `talise://` redirect instead of a web one.
 */
function redirectAuthError(
  req: Request,
  state: string | null,
  err: string
): NextResponse {
  if (state && state.startsWith("m1.")) {
    const callback = new URL("talise://auth/callback");
    callback.searchParams.set("err", err);
    return NextResponse.redirect(callback.toString());
  }
  return NextResponse.redirect(
    new URL(`/?err=${encodeURIComponent(err)}`, req.url)
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    // Never forward a raw, attacker-controllable provider error string into
    // the landing banner. Legit OAuth errors are lowercase_snake codes; pass
    // only a sanitized code, else a generic one. (The render side maps codes
    // to fixed copy too — defense in depth.)
    const safe = /^[a-z_]{1,40}$/.test(error) ? error : "oauth_error";
    return redirectAuthError(req, state, safe);
  }
  if (!code || !state) {
    return redirectAuthError(req, state, "missing_code");
  }

  const expected = await readStateCookie();
  if (!expected || expected !== state) {
    return redirectAuthError(req, state, "bad_state");
  }
  await clearStateCookie();

  try {
    // Pick the redirect URI based on whether this is the mobile flow
    // (state.startsWith("m1.")) or the web flow. Mobile derives from the
    // request host (app.talise.io ↔ app.talise.io). Web uses the static
    // GOOGLE_REDIRECT_URI env — has to be a single fixed string because
    // Vercel may 307 the apex to www (or vice versa), changing
    // req.host between authorize and callback. The env is the only
    // thing guaranteed to match what the client used at authorize-time.
    const isMobileCallback = state.startsWith("m1.");
    const redirectUriForExchange = isMobileCallback
      ? redirectUriFromRequest(req)
      : googleRedirectUri();
    const { id_token } = await exchangeCodeForTokens(
      code,
      redirectUriForExchange
    );
    const claims = decodeJwt(id_token);

    if (claims.email_verified === false) {
      return redirectAuthError(req, state, "unverified_email");
    }
    if (claims.aud !== process.env.GOOGLE_CLIENT_ID) {
      return redirectAuthError(req, state, "bad_audience");
    }

    const country = req.headers.get("x-vercel-ip-country");

    // Pick the salt source. Shinami manages salt server-side on mainnet
    // (their prover requires the address they assign), so we always resolve
    // through them when the key is configured. Otherwise fall back to a
    // locally-derived salt — fine for testnet, broken for mainnet.
    const existing = await userByGoogleSub(claims.sub);

    let salt: string;
    let suiAddress: string;
    if (shinamiEnabled()) {
      const wallet = await shinamiGetWallet(id_token);
      salt = wallet.salt;
      suiAddress = wallet.address;
    } else {
      salt = existing?.salt ?? generateSalt();
      suiAddress = existing?.sui_address ?? deriveSuiAddress(id_token, salt);
    }

    const { user, isNew } = await upsertUser({
      googleSub: claims.sub,
      email: claims.email,
      name: claims.name ?? null,
      picture: claims.picture ?? null,
      suiAddress,
      salt,
      country,
    });

    // Migrate rows that carry a pre-Shinami salt/address pair. A stale pair
    // makes the account unusable because the proof won't anchor to it.
    if (!isNew && (user.sui_address !== suiAddress || user.salt !== salt)) {
      await realignAddress(user.id, suiAddress, salt);
      user.sui_address = suiAddress;
      user.salt = salt;
    }

    // Waitlist handle bind. The zkLogin wallet is the same address on
    // web and iOS (deterministic from googleSub + salt), so a user can
    // claim on the waitlist and complete sign-in on EITHER surface to
    // trigger the on-chain mint. This mirrors the hook in
    // /api/auth/mobile/exchange. Wrapped + the helper internally
    // swallows errors so sign-in cannot wedge.
    try {
      const { bindWaitlistHandleIfAny } = await import("@/lib/handle-claim");
      await bindWaitlistHandleIfAny({
        userId: user.id,
        userEmail: user.email,
        suiAddress: user.sui_address,
      });
    } catch (e) {
      console.warn(
        `[callback/handle-bind] ${user.email}: ${(e as Error).message}`
      );
    }

    await setSessionCookie(user.id);
    // Stash the JWT + salt server-side so /api/sign can call the prover
    // without ever exposing them to client JS.
    await setSigningCookie(id_token, user.salt);

    if (isNew && !user.notified_at) {
      after(async () => {
        const firstName = (user.name ?? "").split(/\s+/)[0] || null;
        const result = await sendWelcomeWithAddress(user.email, {
          firstName,
          suiAddress: user.sui_address,
          position: user.id,
        });
        if (result.ok) {
          await markNotified(user.id);
        } else {
          console.error(`[welcome-email] ${user.email}: ${result.reason}`);
        }
      });
    }

    // Mobile flow: state was prefixed with "m1." by /api/auth/mobile/start.
    // Mint a bearer token and bounce back to the app via custom scheme.
    if (state.startsWith("m1.")) {
      // Read the (ephPubKey, maxEpoch, randomness) triple stashed by
      // /api/auth/mobile/start. These are the EXACT values that bound
      // the JWT's nonce; we must persist them so future proof mints
      // recompute the same Poseidon hash the Shinami prover sees in
      // jwt.nonce. Without this every send fails -32602 Invalid params.
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
            const decoded = JSON.parse(
              Buffer.from(verified, "base64url").toString("utf8")
            );
            bindingPubKey = decoded.ephemeralPubKey ?? null;
            bindingMaxEpoch =
              typeof decoded.maxEpoch === "number" ? decoded.maxEpoch : null;
            bindingRandomness = decoded.randomness ?? null;
          } catch {
            // Malformed — fall through; signing still works but a
            // future send will need its own randomness generation.
          }
        }
      }
      jar.delete("talise_m1_binding");

      const bearer = await issueMobileBearer(user.id, {
        jwt: id_token,
        salt: user.salt,
        ephemeralPubKeyB64: bindingPubKey ?? undefined,
        maxEpoch: bindingMaxEpoch ?? undefined,
        randomness: bindingRandomness ?? undefined,
      });
      const callback = new URL("talise://auth/callback");
      callback.searchParams.set("token", bearer);
      callback.searchParams.set("userId", String(user.id));
      return NextResponse.redirect(callback.toString());
    }

    // Destination priority:
    //   1. Explicit returnTo cookie set by the caller (payment link, /waitlist
    //      sign-in CTA, etc.) — ALWAYS honored, regardless of account_type.
    //      A user who deliberately landed at /waitlist to claim a handle
    //      should bounce straight back there, not to a non-existent
    //      /onboarding page.
    //   2. account_type → /business or /home for fully-set-up users.
    //   3. Fallback for brand-new users with no returnTo and no
    //      account_type: send to /waitlist (the canonical first-step
    //      surface for a Google-signed-in but unprovisioned user).
    //      `/onboarding` was the historical default and is now a 404 —
    //      do NOT regress to it.
    const returnTo = await consumeReturnTo();
    const dest = returnTo
      ?? (user.account_type === "business"
            ? "/business"
            : user.account_type === "personal"
              ? "/app"
              : "/waitlist");
    return NextResponse.redirect(new URL(dest, req.url));
  } catch (err) {
    // Log the real cause server-side; never reflect raw exception text (it can
    // echo provider token-endpoint detail) into the client-facing ?err=.
    console.error(
      `[auth/callback] sign-in failed: ${(err as Error).message?.slice(0, 200)}`
    );
    return redirectAuthError(req, state, "signin_failed");
  }
}
