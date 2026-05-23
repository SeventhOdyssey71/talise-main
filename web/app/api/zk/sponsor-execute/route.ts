import { NextResponse } from "next/server";
import {
  readEntryIdFromRequest,
  mobileSigningContext,
  isMobileRequest,
} from "@/lib/mobile-sessions";
import { userById } from "@/lib/db";
import { assembleZkLoginSignature, readSigningCookie } from "@/lib/zksigner";
import { onara } from "@/lib/onara";

export const runtime = "nodejs";

/**
 * POST /api/zk/sponsor-execute
 *
 * Trip 2. The user has signed the sponsored TransactionData bytes with their
 * ephemeral key. We:
 *   1. Wrap that ephemeral signature into a zkLoginSignature (sender sig).
 *   2. POST { sender, txBytes, txSignature } to Onara's /sponsor endpoint —
 *      Onara enforces its policy, signs as gasOwner, broadcasts, and returns
 *      the execution result.
 *
 * Onara handles: policy enforcement, gasOwner signing, broadcast, retries.
 * We never see the sponsor private key from the web tier.
 */
export async function POST(req: Request) {
  const onaraUrl = process.env.ONARA_URL;
  if (!onaraUrl) {
    return NextResponse.json(
      { error: "ONARA_URL not configured" },
      { status: 503 }
    );
  }

  const userId = await readEntryIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const user = await userById(userId);
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  // Mobile callers don't have a signing cookie — pull jwt+salt from the
  // mobile_sessions row instead. Web callers stay on the cookie path.
  const signing = isMobileRequest(req)
    ? await mobileSigningContext(userId)
    : await readSigningCookie();
  if (!signing) {
    return NextResponse.json({ error: "No active sign-in" }, { status: 401 });
  }

  let body: {
    bytesB64?: string;
    ephemeralPubKeyB64?: string;
    maxEpoch?: number;
    randomness?: string;
    userSignature?: string;
    /**
     * Optional. If the client has a cached zk proof from a previous sign in
     * this session, pass it here to skip the 2-4s Shinami round trip.
     */
    cachedProof?: import("@/lib/zksigner").CachedZkProof;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (
    !body.bytesB64 ||
    !body.ephemeralPubKeyB64 ||
    !body.userSignature ||
    !body.randomness ||
    typeof body.maxEpoch !== "number"
  ) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }

  // Mobile callers: ALWAYS prefer the (ephPubKey, maxEpoch,
  // randomness) values stored at sign-in time over what the client
  // supplied. The JWT's nonce was Poseidon-hashed from those values,
  // so the prover only accepts proofs minted against them. Letting
  // the client provide its own randomness causes -32602 Invalid
  // params 100% of the time.
  const bound = isMobileRequest(req)
    ? (signing as unknown as {
        ephemeralPubKeyB64: string | null;
        maxEpoch: number | null;
        randomness: string | null;
      })
    : null;
  const ephemeralPubKeyB64 = bound?.ephemeralPubKeyB64 ?? body.ephemeralPubKeyB64;
  const maxEpochToUse = bound?.maxEpoch ?? body.maxEpoch;
  const randomnessToUse = bound?.randomness ?? body.randomness;

  try {
    const t0 = Date.now();
    const { signature: zkLoginSignature, proof, isFresh } =
      await assembleZkLoginSignature({
        ephemeralPubKeyB64,
        maxEpoch: maxEpochToUse,
        randomness: randomnessToUse,
        userSignature: body.userSignature,
        cachedProof: body.cachedProof,
        jwt: signing.jwt,
        salt: signing.salt,
      });
    const tProof = Date.now();

    const onaraClient = onara();
    const result = (await onaraClient.sponsor({
      sender: user.sui_address,
      txBytes: body.bytesB64,
      txSignature: zkLoginSignature,
      waitForExecution: true,
    })) as Record<string, unknown>;
    const tDone = Date.now();

    // Per-leg timing so we can see exactly where the latency goes.
    console.log(
      `[zk/sponsor-execute] proof=${tProof - t0}ms (${isFresh ? "FRESH" : "CACHED"}) · onara+broadcast=${tDone - tProof}ms · total=${tDone - t0}ms`
    );

    return NextResponse.json({
      digest: (result as { digest?: string }).digest ?? "",
      effects: (result as { effects?: unknown }).effects ?? null,
      objectChanges:
        ((result as { objectChanges?: unknown[] }).objectChanges as unknown[]) ??
        [],
      freshProof: isFresh ? proof : undefined,
    });
  } catch (err) {
    const msg = (err as Error).message ?? "execute failed";
    const status = msg.includes("No active sign-in") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
