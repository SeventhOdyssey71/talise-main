import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { userById } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/me — current user, shape matches the iOS UserDTO.
 *
 * Mobile bootstrap calls this immediately after sign-in to decide
 * whether to show KYC or jump to Home. Cookie-based web pages keep
 * reading the user via server components; this is purely a mobile
 * convenience endpoint.
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
  });
}
