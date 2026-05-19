import { NextResponse } from "next/server";
import { normalizeHandle, RESERVED_USERNAMES } from "@/lib/handle";
import { suins } from "@/lib/suins-operator";

export const runtime = "nodejs";

/**
 * GET /api/username/check?u=<input>
 *
 * Availability comes from SuiNS on chain — `getNameRecord` returns null if
 * `<name>.talise.sui` hasn't been minted yet. Source of truth is chain;
 * no DB.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = (url.searchParams.get("u") ?? "").trim();
  if (!raw) {
    return NextResponse.json({ available: false, reason: "empty" });
  }
  const username = normalizeHandle(raw);
  if (!username) {
    return NextResponse.json({ available: false, reason: "invalid" });
  }
  if (RESERVED_USERNAMES.has(username)) {
    return NextResponse.json({ available: false, reason: "reserved" });
  }
  try {
    const record = await suins().getNameRecord(`${username}.talise.sui`);
    if (record) {
      return NextResponse.json({ available: false, reason: "taken" });
    }
    return NextResponse.json({ available: true });
  } catch (e) {
    // SuinsClient throws `ObjectError` when the dynamic field for the name
    // doesn't exist. That means the name is unclaimed — available, not a
    // failure. Any other error is a real RPC issue.
    const msg = (e as Error).message ?? "";
    if (/does not exist/i.test(msg) || /not exist/i.test(msg)) {
      return NextResponse.json({ available: true });
    }
    return NextResponse.json({ available: false, reason: "rpc" });
  }
}
