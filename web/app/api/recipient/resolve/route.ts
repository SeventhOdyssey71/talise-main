import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
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
  const userId = await readEntryIdFromRequest(req);
  if (!userId)
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (!q) {
    return NextResponse.json({ error: "empty query" }, { status: 400 });
  }

  try {
    const resolved = await resolveRecipient(q);
    if (!resolved) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json(resolved);
  } catch (err) {
    // Resolution touches SuiNS RPC + DB; either can transiently flake.
    // 502 instead of 500 so callers can distinguish "I couldn't reach
    // the lookup service" from a code bug.
    console.warn(
      `[recipient/resolve] q=${q.slice(0, 32)} failed: ${(err as Error).message}`
    );
    return NextResponse.json(
      { error: "lookup failed" },
      { status: 502 }
    );
  }
}
