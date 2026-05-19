import { NextResponse } from "next/server";
import { readSessionEntryId } from "@/lib/session";
import { updateUserProfile, userById } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const userId = await readSessionEntryId();
  if (!userId)
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  const user = await userById(userId);
  if (!user)
    return NextResponse.json({ error: "user not found" }, { status: 404 });

  let body: {
    name?: string;
    businessName?: string;
    businessIndustry?: string;
    country?: string;
    notifyOnReceive?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  await updateUserProfile(userId, {
    name: body.name?.trim() || null,
    businessName: body.businessName?.trim() || null,
    businessIndustry: body.businessIndustry?.trim() || null,
    country: body.country?.trim() || null,
    notifyOnReceive: body.notifyOnReceive,
  });

  return NextResponse.json({ ok: true });
}
