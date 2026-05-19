import { NextResponse } from "next/server";
import { readSessionEntryId } from "@/lib/session";
import {
  setTaliseUsername,
  userById,
  userByTaliseUsername,
} from "@/lib/db";
import { normalizeHandle, RESERVED_USERNAMES } from "@/lib/handle";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const userId = await readSessionEntryId();
  if (!userId)
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  const user = await userById(userId);
  if (!user)
    return NextResponse.json({ error: "user not found" }, { status: 404 });

  if (user.talise_username) {
    return NextResponse.json(
      { error: "username already set" },
      { status: 409 }
    );
  }

  let body: { username?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const username = normalizeHandle(body.username ?? "");
  if (!username) {
    return NextResponse.json(
      { error: "username must be 3-20 chars of a-z, 0-9, _" },
      { status: 400 }
    );
  }
  if (RESERVED_USERNAMES.has(username)) {
    return NextResponse.json(
      { error: "that username is reserved" },
      { status: 400 }
    );
  }

  // Cheap pre-check; UNIQUE constraint is the real guard against races.
  const taken = await userByTaliseUsername(username);
  if (taken) {
    return NextResponse.json({ error: "that username is taken" }, { status: 409 });
  }

  try {
    await setTaliseUsername(user.id, username);
  } catch (e) {
    const msg = String((e as Error).message);
    if (msg.toUpperCase().includes("UNIQUE")) {
      return NextResponse.json(
        { error: "that username is taken" },
        { status: 409 }
      );
    }
    throw e;
  }

  return NextResponse.json({ ok: true, username });
}
