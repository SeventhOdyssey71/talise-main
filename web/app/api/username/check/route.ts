import { NextResponse } from "next/server";
import { userByTaliseUsername } from "@/lib/db";
import { normalizeHandle, RESERVED_USERNAMES } from "@/lib/handle";

export const runtime = "nodejs";

/**
 * GET /api/username/check?u=<input>
 * Public-ish: any signed-out caller can probe. We expose only availability,
 * never the user behind a taken handle.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = (url.searchParams.get("u") ?? "").trim();
  if (!raw) {
    return NextResponse.json(
      { available: false, reason: "empty" },
      { status: 200 }
    );
  }
  const username = normalizeHandle(raw);
  if (!username) {
    return NextResponse.json(
      { available: false, reason: "invalid" },
      { status: 200 }
    );
  }
  if (RESERVED_USERNAMES.has(username)) {
    return NextResponse.json(
      { available: false, reason: "reserved" },
      { status: 200 }
    );
  }
  const existing = await userByTaliseUsername(username);
  if (existing) {
    return NextResponse.json(
      { available: false, reason: "taken" },
      { status: 200 }
    );
  }
  return NextResponse.json({ available: true });
}
