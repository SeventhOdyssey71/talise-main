import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { userById } from "@/lib/db";
import { toBase64 } from "@mysten/sui/utils";
import { sui } from "@/lib/sui";
import {
  buildResumeAutoSwapTx,
  isValidTypeTag,
  VaultNotDeployedError,
} from "@/lib/vault";

export const runtime = "nodejs";

/**
 * POST /api/vault/resume
 *
 * Builds a PTB calling `auto_swap::resume<T>(&mut cap)` — flips `paused`
 * back to false. Companion to /api/vault/pause.
 *
 * Body: { capId, sourceType }
 * Returns: { bytesB64, sender }
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

  let body: { capId?: string; sourceType?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const capId = (body.capId ?? "").trim();
  const sourceType = (body.sourceType ?? "").trim();
  if (!/^0x[a-fA-F0-9]+$/.test(capId)) {
    return NextResponse.json({ error: "capId malformed" }, { status: 400 });
  }
  if (!isValidTypeTag(sourceType)) {
    return NextResponse.json(
      { error: "sourceType must look like 0x<addr>::<module>::<Name>" },
      { status: 400 }
    );
  }

  try {
    const tx = buildResumeAutoSwapTx(user.sui_address, capId, sourceType);
    const kind = await tx.build({
      client: sui() as never,
      onlyTransactionKind: true,
    });
    return NextResponse.json({
      bytesB64: toBase64(kind),
      sender: user.sui_address,
    });
  } catch (err) {
    if (err instanceof VaultNotDeployedError) {
      return NextResponse.json(
        { error: "auto-swap package not yet deployed" },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: "build failed: " + (err as Error).message },
      { status: 500 }
    );
  }
}
