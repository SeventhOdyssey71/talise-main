import { NextResponse } from "next/server";
import { readSessionEntryId } from "@/lib/session";
import { userById } from "@/lib/db";
import { assembleZkLoginSignature, readSigningCookie } from "@/lib/zksigner";
import { OnaraClient } from "@/lib/onara";

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

  const userId = await readSessionEntryId();
  if (!userId) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const user = await userById(userId);
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  const signing = await readSigningCookie();
  if (!signing) {
    return NextResponse.json({ error: "No active sign-in" }, { status: 401 });
  }

  let body: {
    bytesB64?: string;
    ephemeralPubKeyB64?: string;
    maxEpoch?: number;
    randomness?: string;
    userSignature?: string;
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

  try {
    const zkLoginSignature = await assembleZkLoginSignature({
      ephemeralPubKeyB64: body.ephemeralPubKeyB64,
      maxEpoch: body.maxEpoch,
      randomness: body.randomness,
      userSignature: body.userSignature,
    });

    const onara = new OnaraClient(onaraUrl);
    const result = (await onara.sponsor({
      sender: user.sui_address,
      txBytes: body.bytesB64,
      txSignature: zkLoginSignature,
      waitForExecution: true,
    })) as Record<string, unknown>;

    return NextResponse.json({
      digest: (result as { digest?: string }).digest ?? "",
      effects: (result as { effects?: unknown }).effects ?? null,
      objectChanges:
        ((result as { objectChanges?: unknown[] }).objectChanges as unknown[]) ??
        [],
    });
  } catch (err) {
    const msg = (err as Error).message ?? "execute failed";
    const status = msg.includes("No active sign-in") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
