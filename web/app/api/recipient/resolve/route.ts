import { NextResponse } from "next/server";
import { readSessionEntryId } from "@/lib/session";
import { resolveRecipient } from "@/lib/suins";

export const runtime = "nodejs";

/**
 * GET /api/recipient/resolve?q=<input>
 *
 * Returns { address, displayName } on a match. Returns 404 when input is well
 * formed but unknown, and 400 when it's malformed. Authenticated only — we
 * don't want to leak the handle table to crawlers.
 */
export async function GET(req: Request) {
  const userId = await readSessionEntryId();
  if (!userId)
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (!q) {
    return NextResponse.json({ error: "empty query" }, { status: 400 });
  }

  const resolved = await resolveRecipient(q);
  if (!resolved) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(resolved);
}
