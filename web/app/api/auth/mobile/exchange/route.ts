import { NextResponse } from "next/server";
import { decodeJwt, deriveSuiAddress, generateSalt } from "@/lib/zklogin";
import {
  upsertUser,
  userByGoogleSub,
  realignAddress,
} from "@/lib/db";
import { shinamiEnabled, shinamiGetWallet } from "@/lib/shinami";
import { mintZkProof } from "@/lib/zksigner";
import { issueMobileBearer } from "@/lib/mobile-sessions";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * Mobile sign-in handshake. iOS does the Google OAuth dance directly (PKCE),
 * obtains an id_token, and posts it here along with the ephemeral key
 * material. We:
 *   1. Decode + sanity-check the JWT (audience must match our iOS client id;
 *      Apple's PKCE handshake already proved the JWT came from Google).
 *   2. Look up the Shinami-managed salt (or fall back to local derivation
 *      on testnet) to derive the deterministic Sui address.
 *   3. Upsert the user row exactly the way /auth/callback does on web.
 *   4. Pre-mint a zkLogin proof so the first /api/zk/sponsor-execute call
 *      doesn't pay the 2-4s Shinami latency.
 *   5. Issue a mobile bearer token bound to this user id.
 *
 * Notes:
 *  - No state cookie / no redirect URI dance — that's all in the iOS PKCE
 *    flow upstream.
 *  - We do NOT set the web session cookie. Mobile is bearer-only.
 *  - The proof is returned to the client so it can show "ready" UI faster,
 *    but the proof is also implicitly cached server-side (any subsequent
 *    /api/zk/sponsor-execute call from this user will re-derive on demand
 *    and serve fast; the cache is per Shinami's behavior, not ours).
 */
export async function POST(req: Request) {
  // Rate-limit: 5 exchanges per 60s per IP. Tight bound — each exchange
  // mints a zkLogin proof and burns Shinami quota.
  const rl = rateLimit({
    key: `mobile-exchange:${getClientIp(req)}`,
    limit: 5,
    windowSec: 60,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec ?? 60) } }
    );
  }

  let body: {
    idToken?: string;
    ephemeralPubKeyB64?: string;
    jwtRandomness?: string;
    maxEpoch?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  if (
    !body.idToken ||
    !body.ephemeralPubKeyB64 ||
    !body.jwtRandomness ||
    typeof body.maxEpoch !== "number"
  ) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }

  let claims: ReturnType<typeof decodeJwt>;
  try {
    claims = decodeJwt(body.idToken);
  } catch (err) {
    return NextResponse.json(
      { error: "malformed id_token: " + (err as Error).message },
      { status: 400 }
    );
  }

  if (claims.iss !== "https://accounts.google.com" && claims.iss !== "accounts.google.com") {
    return NextResponse.json({ error: "bad issuer" }, { status: 401 });
  }
  if (claims.email_verified === false) {
    return NextResponse.json({ error: "email not verified" }, { status: 401 });
  }

  // Audience must match our iOS OAuth client (allow optional web fallback
  // for dev). Configure via env so we don't ship hard-coded client ids.
  const allowedAudiences = [
    process.env.GOOGLE_CLIENT_ID_IOS,
    process.env.GOOGLE_CLIENT_ID,
  ].filter(Boolean) as string[];
  if (allowedAudiences.length === 0 || !allowedAudiences.includes(claims.aud)) {
    return NextResponse.json({ error: "bad audience" }, { status: 401 });
  }

  // Salt + address (Shinami on mainnet, local otherwise).
  let salt: string;
  let suiAddress: string;
  try {
    if (shinamiEnabled()) {
      const wallet = await shinamiGetWallet(body.idToken);
      salt = wallet.salt;
      suiAddress = wallet.address;
    } else {
      const existing = await userByGoogleSub(claims.sub);
      salt = existing?.salt ?? generateSalt();
      suiAddress = existing?.sui_address ?? deriveSuiAddress(body.idToken, salt);
    }
  } catch (err) {
    // Don't surface raw Shinami / SDK error strings — they sometimes
    // include the API key prefix or internal endpoint URLs. Log the
    // full message server-side and return a generic 500 to the caller.
    console.error(
      `[mobile/exchange] wallet setup failed for sub=${claims.sub}: ${
        (err as Error).message
      }`
    );
    return NextResponse.json(
      { error: "wallet setup failed" },
      { status: 500 }
    );
  }

  const country = req.headers.get("x-vercel-ip-country");
  const { user } = await upsertUser({
    googleSub: claims.sub,
    email: claims.email,
    name: claims.name ?? null,
    picture: claims.picture ?? null,
    suiAddress,
    salt,
    country,
  });

  // Migrate prior rows that drifted from Shinami's current salt/address pair.
  if (user.sui_address !== suiAddress || user.salt !== salt) {
    await realignAddress(user.id, suiAddress, salt);
    user.sui_address = suiAddress;
    user.salt = salt;
  }

  // Pre-mint the proof. If Shinami chokes we still return success — the
  // client will retry on first send and pay the cold-start latency then.
  let proof: unknown = null;
  try {
    proof = await mintZkProof({
      ephemeralPubKeyB64: body.ephemeralPubKeyB64,
      maxEpoch: body.maxEpoch,
      randomness: body.jwtRandomness,
      jwt: body.idToken,
      salt,
    });
  } catch (err) {
    console.warn(`[mobile/exchange] proof pre-mint skipped: ${(err as Error).message}`);
  }

  const bearer = await issueMobileBearer(user.id, {
    jwt: body.idToken,
    salt,
  });

  // Waitlist-handle bind hook. Hooked HERE — right after `upsertUser`
  // has returned a row with a real `sui_address`, and BEFORE we look
  // up the user's owned subnames — so that the subsequent
  // `findTaliseSubnameForOwner` call below picks up the freshly-minted
  // handle on the same response. Fire-and-forget semantics live
  // inside `bindWaitlistHandleIfAny`: it swallows all errors and
  // never throws, so sign-in cannot wedge on it. We `await` only so
  // the resolver in the next block can see the new NFT — the bind
  // call itself returns within one PTB round-trip.
  try {
    const { bindWaitlistHandleIfAny } = await import("@/lib/handle-claim");
    await bindWaitlistHandleIfAny({
      userId: user.id,
      userEmail: user.email,
      suiAddress: user.sui_address,
    });
  } catch (e) {
    // bindWaitlistHandleIfAny already catches internally; this is a
    // belt-and-suspenders guard against the dynamic import failing.
    console.warn(
      `[mobile/exchange] handle bind skipped: ${(e as Error).message}`
    );
  }

  // Returning users may already own a *.talise.sui subname — surface it
  // immediately so HomeView shows the canonical handle without an extra
  // round trip. First-time signers will get `null` here UNLESS the
  // waitlist-handle bind above just minted one; in that case the
  // resolver sees the new NFT on the same response.
  const { findTaliseSubnameForOwner } = await import("@/lib/suins-lookup");
  const subname = await findTaliseSubnameForOwner(user.sui_address)
    .catch(() => null);

  return NextResponse.json({
    user: {
      id: String(user.id),
      email: user.email,
      name: user.name,
      picture: user.picture,
      country: user.country,
      suiAddress: user.sui_address,
      accountType: user.account_type,
      businessName: user.business_name,
      businessHandle: user.business_handle,
      taliseHandle: subname?.username ?? null,
      taliseSubname: subname?.fullName ?? null,
    },
    bearer,
    proof,
    maxEpoch: body.maxEpoch,
  });
}
