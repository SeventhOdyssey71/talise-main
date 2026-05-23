import { NextResponse, after } from "next/server";
import { exchangeCodeForTokens } from "@/lib/auth";
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

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(new URL(`/?err=${encodeURIComponent(error)}`, req.url));
  }
  if (!code || !state) {
    return NextResponse.redirect(new URL(`/?err=missing_code`, req.url));
  }

  const expected = await readStateCookie();
  if (!expected || expected !== state) {
    return NextResponse.redirect(new URL(`/?err=bad_state`, req.url));
  }
  await clearStateCookie();

  try {
    const { id_token } = await exchangeCodeForTokens(code);
    const claims = decodeJwt(id_token);

    if (claims.email_verified === false) {
      return NextResponse.redirect(new URL(`/?err=unverified_email`, req.url));
    }
    if (claims.aud !== process.env.GOOGLE_CLIENT_ID) {
      return NextResponse.redirect(new URL(`/?err=bad_audience`, req.url));
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

    // If the user landed via a payment link (or any return-to flow), prefer
    // that destination over the default home page.
    const returnTo = await consumeReturnTo();
    const defaultDest =
      user.account_type === "business"
        ? "/business"
        : user.account_type === "personal"
          ? "/home"
          : "/onboarding";
    // After onboarding, the return-to is still respected on subsequent sessions.
    const dest =
      user.account_type && returnTo ? returnTo : defaultDest;
    return NextResponse.redirect(new URL(dest, req.url));
  } catch (err) {
    const msg = encodeURIComponent((err as Error).message.slice(0, 120));
    return NextResponse.redirect(new URL(`/?err=${msg}`, req.url));
  }
}
