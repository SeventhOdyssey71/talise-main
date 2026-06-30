import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { denyUnlessAppApproved } from "@/lib/app-access";
import { storeBlob, readBlob, WalrusError } from "@/lib/walrus";

export const runtime = "nodejs";

/**
 * Agent-memory BLOB rail — opaque ciphertext in/out of Walrus.
 *
 *   POST /api/agent/memory/blob   body = raw ciphertext (application/octet-stream)
 *                                 -> { blobId }
 *   GET  /api/agent/memory/blob?id=<blobId>
 *                                 -> raw ciphertext bytes (application/octet-stream)
 *
 * SERVER IS BLIND. The bytes are AES-256-GCM ciphertext sealed CLIENT-SIDE
 * (see web/lib/agent/memory.ts — version 0x10 | iv | ct | tag); the 32-byte
 * key is held on the device and NEVER sent here. This route only relays opaque
 * bytes to/from Walrus — it never decrypts, parses, or inspects them.
 *
 * Walrus persistence is governed by MEMORY_WALRUS_EPOCHS (default 10 epochs).
 *
 * Gated like the money/agent routes: FEATURE_AGENT_MEMORY (default-on),
 * authenticated entry id, and private-beta app-access.
 */

/** Feature flag — enabled UNLESS explicitly set to "false". */
function memoryDisabled(): boolean {
  return process.env.FEATURE_AGENT_MEMORY?.trim().toLowerCase() === "false";
}

function memoryEpochs(): number {
  const n = Number(process.env.MEMORY_WALRUS_EPOCHS);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

/** POST raw ciphertext bytes → Walrus, return the content-addressed blob id. */
export async function POST(req: Request) {
  if (memoryDisabled()) return NextResponse.json({ disabled: true }, { status: 404 });

  const userId = await readEntryIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  const denied = await denyUnlessAppApproved(userId);
  if (denied) return denied;

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await req.arrayBuffer());
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }
  if (bytes.byteLength === 0) {
    return NextResponse.json({ error: "empty body" }, { status: 400 });
  }

  try {
    const blobId = await storeBlob(bytes, { epochs: memoryEpochs() });
    return NextResponse.json({ blobId });
  } catch (e) {
    const status = e instanceof WalrusError ? 502 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}

/** GET ?id=<blobId> → raw ciphertext bytes back from Walrus. */
export async function GET(req: Request) {
  if (memoryDisabled()) return NextResponse.json({ disabled: true }, { status: 404 });

  const userId = await readEntryIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  const denied = await denyUnlessAppApproved(userId);
  if (denied) return denied;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  try {
    const bytes = await readBlob(id);
    return new NextResponse(bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const status = e instanceof WalrusError ? (e.status ?? 502) : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
