import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { userById } from "@/lib/db";
import { findTaliseSubnameForOwner } from "@/lib/suins-lookup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/me — current user, shape matches the iOS UserDTO.
 *
 * Mobile bootstrap calls this immediately after sign-in to decide
 * whether to show KYC or jump to Home. We also include the user's
 * on-chain `<handle>.talise.sui` subname when present (reverse SuiNS
 * lookup), so HomeView/ReceiveView can show the canonical display
 * name instead of a derived fallback.
 */
export async function GET(req: Request) {
  const userId = await readEntryIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const user = await userById(userId);
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  // Best-effort on-chain handle lookup. If RPC is slow or the user
  // hasn't minted a subname yet, return null — iOS falls back to a
  // derived `you@talise` placeholder.
  const subname = await findTaliseSubnameForOwner(user.sui_address)
    .catch(() => null);

  return NextResponse.json({
    id: String(user.id),
    email: user.email,
    name: user.name,
    picture: user.picture,
    country: user.country,
    suiAddress: user.sui_address,
    accountType: user.account_type,
    businessName: user.business_name,
    businessHandle: user.business_handle,
    taliseHandle: subname?.username ?? null,
    taliseSubname: subname?.fullName ?? null,
  });
}
