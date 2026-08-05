import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { userById } from "@/lib/db";
import { rateLimitAsync } from "@/lib/rate-limit";
import { lockGrantForClaim, attachDigest, releaseClaim } from "@/lib/rewards/grants";
import { rewardsSendUsdsui, rewardsTreasuryEnabled } from "@/lib/rewards/treasury";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/rewards/grant/claim  { id }
 *
 * Open the gift. This is the ONLY moment a reward's money moves: the grant is
 * locked atomically, the treasury pays the beneficiary's own address, and the
 * settling digest is written back.
 *
 * The recipient address is read from the SESSION, never from the request body.
 * A claim that let the caller name a destination would be a withdrawal endpoint
 * wearing a gift wrapper.
 */
export async function POST(req: Request) {
  const userId = await readEntryIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  // A claim is one tap. Anything hammering this is a bug or an attack, and the
  // atomic lock below already makes a double-claim impossible.
  const rl = await rateLimitAsync({ key: `reward-claim:${userId}`, limit: 10, windowSec: 300 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too many attempts" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec ?? 300) } }
    );
  }

  let body: { id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  if (!rewardsTreasuryEnabled()) {
    // Checked BEFORE the lock: locking a grant we then cannot pay would take
    // the gift off the shelf for nothing.
    return NextResponse.json(
      { error: "Rewards are being set up. Try again shortly.", code: "TREASURY_UNCONFIGURED" },
      { status: 503 }
    );
  }

  const user = await userById(Number(userId));
  if (!user?.sui_address) {
    return NextResponse.json({ error: "user has no wallet address" }, { status: 409 });
  }

  // Atomic take. Exactly one racing tap wins the row; the rest get null here
  // and are told the gift is already open, having moved no money.
  const grant = await lockGrantForClaim(Number(userId), id);
  if (!grant) {
    return NextResponse.json(
      { error: "That gift has already been opened.", code: "ALREADY_CLAIMED" },
      { status: 409 }
    );
  }

  try {
    const digest = await rewardsSendUsdsui(user.sui_address, grant.amountUsd);
    await attachDigest(grant.id, digest);
    console.log(
      `[rewards/claim] user=${userId} grant=${grant.id} $${grant.amountUsd} digest=${digest}`
    );
    return NextResponse.json({ ok: true, amountUsd: grant.amountUsd, digest });
  } catch (e) {
    // Payout failed, so the claim never really happened. Put it back rather
    // than leaving a user staring at an opened gift they were never paid for.
    await releaseClaim(grant.id);
    console.warn(`[rewards/claim] payout failed for grant=${grant.id}: ${(e as Error).message}`);
    return NextResponse.json(
      { error: "Couldn't open that gift right now. Please try again.", code: "PAYOUT_FAILED" },
      { status: 502 }
    );
  }
}
