import { NextResponse } from "next/server";
import {
  readEntryIdFromRequest,
  mobileSigningContext,
  isMobileRequest,
} from "@/lib/mobile-sessions";
import { userById } from "@/lib/db";
import { mintZkProof } from "@/lib/zksigner";

export const runtime = "nodejs";

/**
 * POST /api/zk/proof
 *
 * Mints a zkLogin proof and returns it. Pure pre-fetch — no transaction
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
  const mobileCtx = isMobileRequest(req) ? await mobileSigningContext(userId) : null;

  try {
    const t0 = Date.now();
    const proof = await mintZkProof({
      ephemeralPubKeyB64: body.ephemeralPubKeyB64,
      maxEpoch: body.maxEpoch,
      randomness: body.randomness,
      jwt: mobileCtx?.jwt,
      salt: mobileCtx?.salt,
    });
    console.log(`[zk/proof] warmed in ${Date.now() - t0}ms`);
    return NextResponse.json({ proof });
  } catch (err) {
    const msg = (err as Error).message ?? "proof mint failed";
    const status = msg.includes("No active sign-in") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
