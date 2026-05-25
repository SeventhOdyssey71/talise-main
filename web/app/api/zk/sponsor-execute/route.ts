import { NextResponse } from "next/server";
import {
  readEntryIdFromRequest,
  mobileSigningContext,
  isMobileRequest,
} from "@/lib/mobile-sessions";
import { userById } from "@/lib/db";
import { assembleZkLoginSignature, readSigningCookie } from "@/lib/zksigner";
import { onara } from "@/lib/onara";
import { awardForTx, type EarnTrigger } from "@/lib/rewards/earn";
import { maybeRoundupForSend } from "@/lib/rewards/roundup";

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
    /**
     * Optional rewards-accounting hint from iOS. The PTB it just signed
     * was minted by one of our prepare routes, so iOS knows whether
     * this was a send / invest / withdraw and how many USD it moved.
     * Server validates `kind` against a closed enum + clips `amountUsd`
     * before crediting — a malicious client can at worst inflate their
     * own points balance, never anyone else's money.
     */
    meta?: {
      kind?: "send" | "invest" | "withdraw" | "roundup" | "goal";
      amountUsd?: number;
      venue?: string;
    };
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
  // randomness) values stored at sign-in time. The JWT's nonce was
  // Poseidon-hashed from those values, so the prover only accepts
  // proofs minted against them.
  const bound = isMobileRequest(req)
    ? (signing as unknown as {
        ephemeralPubKeyB64: string | null;
        maxEpoch: number | null;
        randomness: string | null;
      })
    : null;

  // Sessions minted before the Poseidon-nonce fix (commit 6f0a919)
  // have NULL binding columns. Their JWT's nonce is just random
  // bytes, so any proof mint will -32602. Force a re-sign-in
  // instead of trying anyway and surfacing an opaque Shinami error.
  if (isMobileRequest(req)) {
    if (
      !bound?.ephemeralPubKeyB64 ||
      bound.maxEpoch == null ||
      !bound.randomness
    ) {
      return NextResponse.json(
        {
          error: "Sign in again — your session predates the latest fix.",
          code: "session_rebind_required",
        },
        { status: 401 }
      );
    }
  }

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

    // Rewards earn — fire-and-forget. The user's money already moved;
    // if the points write fails (DB hiccup, etc.) we don't block the
    // response. Validation here is server-side: only the closed kind
    // enum, only positive amounts up to a per-tx cap (defends against
    // a malicious client inflating their own points balance — at worst
    // a single tx earns the cap, never more).
    const meta = body.meta;
    if (
      meta &&
      typeof meta.kind === "string" &&
      typeof meta.amountUsd === "number" &&
      meta.amountUsd > 0
    ) {
      const ALLOWED: ReadonlySet<EarnTrigger> = new Set([
        "send",
        "invest",
        "withdraw",
        "roundup",
        "goal",
      ]);
      const trigger = meta.kind as EarnTrigger;
      if (ALLOWED.has(trigger)) {
        // 10k USD per-tx cap on the points-earning amount. Real txs
        // can exceed this — the user just doesn't farm extra points
        // beyond it.
        const amountUsd = Math.min(meta.amountUsd, 10_000);
        // Don't await — we'll return to iOS as soon as we have the
        // digest. The .catch() prevents an unhandled promise rejection
        // from crashing the request handler.
        awardForTx({
          userId,
          trigger,
          amountUsd,
          digest: undefined, // filled below once we extract it
          venue: meta.venue,
        }).catch((e) =>
          console.warn("[zk/sponsor-execute] awardForTx failed:", e)
        );
      }
    }

    // Onara returns the raw gRPC `TransactionResult` from its
    // executeTransaction — a discriminated union shaped like:
    //   { $kind: 'Transaction',       Transaction:       { digest, effects, ... } }
    //   { $kind: 'FailedTransaction', FailedTransaction: { digest, ... } }
    // So `result.digest` is undefined; the digest is one level deeper.
    // Fall through several known shapes for resilience to upstream
    // changes — we'd rather extract a digest than fail the send over
    // a field-name diff.
    const r = result as Record<string, unknown>;
    const txInner =
      (r.Transaction as { digest?: string; effects?: unknown } | undefined) ??
      (r.FailedTransaction as { digest?: string; effects?: unknown } | undefined) ??
      (r.transaction as { digest?: string; effects?: unknown } | undefined);
    const digest =
      (r.digest as string | undefined) ??
      txInner?.digest ??
      "";
    if (!digest) {
      // Log the raw shape so we can fix the extractor without guessing.
      console.error(
        "[zk/sponsor-execute] no digest in Onara response — shape:",
        JSON.stringify(Object.keys(r))
      );
    }

    // Phase 2 — Round-up & Save. Fire-and-forget AFTER digest
    // extraction. Only triggers on outbound sends; idempotent on the
    // source digest inside `maybeRoundupForSend`. We deliberately do
    // NOT await — the user's money already moved, and a slow roundup
    // hook shouldn't extend the response. We also deliberately do NOT
    // call `/api/zk/sponsor-execute` recursively from inside the
    // roundup hook (v1 only books the points + lifetime tally; the
    // actual on-chain NAVI supply is stubbed pending delegation-key
    // support — see `lib/rewards/roundup.ts` for the TODO).
    if (
      digest &&
      meta &&
      meta.kind === "send" &&
      typeof meta.amountUsd === "number" &&
      meta.amountUsd > 0
    ) {
      maybeRoundupForSend({
        userId,
        sendAmountUsd: meta.amountUsd,
        sourceDigest: digest,
      }).catch((e) =>
        console.warn("[zk/sponsor-execute] maybeRoundupForSend failed:", e)
      );
    }

    return NextResponse.json({
      digest,
      effects:
        (r.effects as unknown) ??
        (txInner?.effects as unknown) ??
        null,
      objectChanges:
        ((r.objectChanges as unknown[]) ?? []) as unknown[],
      freshProof: isFresh ? proof : undefined,
    });
  } catch (err) {
    const msg = (err as Error).message ?? "execute failed";
    const status = msg.includes("No active sign-in") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
