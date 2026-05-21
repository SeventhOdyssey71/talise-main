import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";

export const runtime = "nodejs";

/**
 * Issue a single-use challenge for App Attest key registration. The iOS
 * app generates a key in the Secure Enclave, hashes this challenge, and
 * passes both back to /api/auth/attest/register.
 *
 * The challenge itself is stateless — we don't store it. The register
 * endpoint binds the challenge to the keyId on first use; replays fail
 * because Apple's attestation object embeds the challenge in its receipt.
 */
export async function POST(req: Request) {
  const userId = await readEntryIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const challenge = randomBytes(32).toString("base64");
  return NextResponse.json({ challenge });
}
