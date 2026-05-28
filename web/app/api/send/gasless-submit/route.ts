import { NextResponse } from "next/server";
import {
  readEntryIdFromRequest,
  mobileSigningContext,
  isMobileRequest,
} from "@/lib/mobile-sessions";
import { userById } from "@/lib/db";
import { assembleZkLoginSignature, readSigningCookie } from "@/lib/zksigner";
import { sui } from "@/lib/sui";
import { fromBase64 } from "@mysten/sui/utils";
import { awardForTx, type EarnTrigger } from "@/lib/rewards/earn";
import { requireAppAttestStructural } from "@/lib/app-attest";

export const runtime = "nodejs";

/**
 * POST /api/send/gasless-submit
 *
 * Plain USDsui sends use Sui's gasless stablecoin path:
 * `0x2::coin::send_funds<T>` with `gasPrice=0` and no gas owner.
 * No Onara round-trip — we just assemble the user's zkLogin signature
 * and broadcast directly to the fullnode.
 *
 * Mirrors `/api/zk/sponsor-execute` for everything except the gas /
 * broadcast path. Rewards crediting + proof caching behave the same.
 */
export async function POST(req: Request) {
  const attestBlock = requireAppAttestStructural(req);
  if (attestBlock) return attestBlock;

  const userId = await readEntryIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const user = await userById(userId);
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

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
    cachedProof?: import("@/lib/zksigner").CachedZkProof;
    meta?: { kind?: string; amountUsd?: number; venue?: string };
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (
    !body.bytesB64 ||
    !body.ephemeralPubKeyB64 ||
    body.maxEpoch == null ||
    !body.randomness ||
    !body.userSignature
  ) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }

  try {
    const t0 = Date.now();
    const { signature: zkLoginSignature, proof, isFresh } =
      await assembleZkLoginSignature({
        ephemeralPubKeyB64: body.ephemeralPubKeyB64,
        maxEpoch: body.maxEpoch,
        randomness: body.randomness,
        userSignature: body.userSignature,
        cachedProof: body.cachedProof,
        jwt: signing.jwt,
        salt: signing.salt,
      });
    const tProof = Date.now();

    // Submit directly to the fullnode. Gasless txs need only the
    // user's zkLogin signature — no sponsor signature involved. The
    // gRPC client auto-detects gasless eligibility, so no extra flag
    // needed here (prepare already set gasPrice=0 on the build).
    const result = (await sui().executeTransaction({
      transaction: fromBase64(body.bytesB64),
      signatures: [zkLoginSignature],
    })) as Record<string, unknown>;
    const tDone = Date.now();

    console.log(
      `[send/gasless-submit] proof=${tProof - t0}ms (${isFresh ? "FRESH" : "CACHED"}) · broadcast=${tDone - tProof}ms · total=${tDone - t0}ms`
    );

    // Same discriminated-union shape Onara returns:
    //   { $kind: "Transaction",       Transaction:       { digest, ... } }
    //   { $kind: "FailedTransaction", FailedTransaction: { digest, ... } }
    const txInner =
      (result.Transaction as { digest?: string } | undefined) ??
      (result.FailedTransaction as { digest?: string } | undefined);
    const digest = (result.digest as string | undefined) ?? txInner?.digest ?? "";
    if (!digest) {
      console.error("[send/gasless-submit] no digest in response:", result);
      return NextResponse.json(
        { error: "no digest in broadcast response" },
        { status: 500 }
      );
    }

    // Rewards earn — fire-and-forget, same shape as sponsor-execute.
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
        const amountUsd = Math.min(meta.amountUsd, 10_000);
        awardForTx({
          userId,
          trigger,
          amountUsd,
          digest,
          venue: meta.venue,
        }).catch((e) =>
          console.warn("[send/gasless-submit] awardForTx failed:", e)
        );
      }
    }

    return NextResponse.json({
      digest,
      // Echo the proof iOS sent (or the one we minted) so iOS can
      // re-cache and skip the prover on the next send.
      freshProof: isFresh ? proof : undefined,
    });
  } catch (err) {
    const msg = (err as Error).message ?? "submit failed";
    console.warn(`[send/gasless-submit] user=${userId} failed: ${msg}`);
    const status = msg.includes("No active sign-in") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
