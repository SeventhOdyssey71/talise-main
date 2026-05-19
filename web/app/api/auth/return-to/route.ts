import { NextResponse } from "next/server";
import { setReturnTo } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { returnTo?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const path = (body.returnTo ?? "").trim();
  if (!path.startsWith("/")) {
    return NextResponse.json({ error: "must be a path" }, { status: 400 });
  }
  await setReturnTo(path);
  return NextResponse.json({ ok: true });
}
