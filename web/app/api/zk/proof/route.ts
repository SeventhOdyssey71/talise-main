import { NextResponse } from "next/server";
import { isProverSessionError } from "@/lib/zksigner";
import {
  readEntryIdFromRequest,
  mobileSigningContext,
  isMobileRequest,
} from "@/lib/mobile-sessions";
import { userById } from "@/lib/db";
import { mintZkProof } from "@/lib/zksigner";
import { rateLimitAsync } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * POST /api/zk/proof
 *
 * Mints a zkLogin proof and returns it. Pure pre-fetch, no transaction
 * broadcast, no Onara, no signing of bytes. Used by the home page on first
 * load to warm the proof cache so the user's first send doesn't pay the
 * 2-4s Shinami cost.
 *
 * The client stores the returned proof in localStorage alongside the
 * ephemeral key. Every subsequent /api/zk/sponsor-execute or
 * /api/t2000/execute call sends `cachedProof` in the body and the server
 * skips Shinami entirely.
 */
export async function POST(req: Request) {
  const userId = await readEntryIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  // Per-user global rate limit, the prover is expensive (Shinami quota +
  // compute); cap warm-cache prefetch abuse without hurting normal load.
  const rl = await rateLimitAsync({ key: `zk-proof:user:${userId}`, limit: 60, windowSec: 3600 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec ?? 3600) } }
    );
  }
  const user = await userById(userId);
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  let body: {
    ephemeralPubKeyB64?: string;
    maxEpoch?: number;
    randomness?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (
    !body.ephemeralPubKeyB64 ||
    !body.randomness ||
    typeof body.maxEpoch !== "number"
  ) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }

  // Mobile callers: pull JWT + salt from the bearer's signing context.
  // ALSO prefer the (ephPubKey, maxEpoch, randomness) bound at sign-in
  // time over the client-supplied values, those are the only ones the
  // JWT's nonce was Poseidon-hashed from, so they're the only ones the
  // prover will accept.
  const mobileCtx = isMobileRequest(req) ? await mobileSigningContext(userId) : null;
  const ephemeralPubKeyB64 = mobileCtx?.ephemeralPubKeyB64 ?? body.ephemeralPubKeyB64;
  const maxEpochToUse = mobileCtx?.maxEpoch ?? body.maxEpoch;
  const randomnessToUse = mobileCtx?.randomness ?? body.randomness;

  try {
    const t0 = Date.now();
    const { proof } = await mintZkProof({
      ephemeralPubKeyB64,
      maxEpoch: maxEpochToUse,
      randomness: randomnessToUse,
      jwt: mobileCtx?.jwt,
      salt: mobileCtx?.salt,
    });
    console.log(`[zk/proof] warmed in ${Date.now() - t0}ms`);
    return NextResponse.json({ proof });
  } catch (err) {
    const msg = (err as Error).message ?? "proof mint failed";
    if (msg.includes("No active sign-in")) {
      return NextResponse.json({ error: msg }, { status: 401 });
    }
    // A prover that rejects the INPUTS is telling us this sign-in can no
    // longer mint a proof — re-auth fixes it, retrying cannot. Same mapping
    // sponsor-execute already used; without it here the raw prover body went
    // to the browser and a user saw
    //   prover 400 (mysten): {"name":"InputValidationError","message":"…
    // sitting under their token bucket.
    if (isProverSessionError(err)) {
      return NextResponse.json(
        {
          error: "Sign in again, your session needs a refresh.",
          code: "session_rebind_required",
        },
        { status: 401 }
      );
    }
    // Genuine prover trouble. Log the detail, tell the user something true and
    // retryable — an upstream error body is never a message for a person.
    console.warn(`[zk/proof] mint failed: ${msg}`);
    return NextResponse.json(
      { error: "Couldn't prepare your signature. Try again in a moment.", code: "PROOF_FAILED" },
      { status: 502 }
    );
  }
}
