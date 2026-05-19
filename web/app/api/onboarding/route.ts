import { NextResponse } from "next/server";
import { readSessionEntryId } from "@/lib/session";
import { isHandleTaken, setAccountType, userById } from "@/lib/db";

export const runtime = "nodejs";

const HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

export async function POST(req: Request) {
  const id = await readSessionEntryId();
  if (!id) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const user = await userById(id);
  if (!user) return NextResponse.json({ error: "user not found" }, { status: 404 });

  if (user.account_type) {
    return NextResponse.json(
      { error: "account type already set" },
      { status: 409 }
    );
  }

  let body: {
    accountType?: string;
    businessName?: string;
    businessHandle?: string;
    businessIndustry?: string | null;
    interests?: string[];
    country?: string | null;
    notify?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  if (body.accountType === "personal") {
    await setAccountType(id, {
      accountType: "personal",
      interests: Array.isArray(body.interests) ? body.interests : null,
      country: body.country ?? null,
      notifyOnReceive: !!body.notify,
    });
    return NextResponse.json({ ok: true, redirect: "/home" });
  }

  if (body.accountType === "business") {
    const name = (body.businessName ?? "").trim();
    const handle = (body.businessHandle ?? "").trim().toLowerCase();
    if (name.length < 2) {
      return NextResponse.json({ error: "business name too short" }, { status: 400 });
    }
    if (!HANDLE_RE.test(handle)) {
      return NextResponse.json(
        { error: "handle must be 2-32 chars of a-z, 0-9, hyphen" },
        { status: 400 }
      );
    }
    if (await isHandleTaken(handle)) {
      return NextResponse.json({ error: "handle is taken" }, { status: 409 });
    }
    await setAccountType(id, {
      accountType: "business",
      businessName: name,
      businessHandle: handle,
      businessIndustry: body.businessIndustry || null,
      country: body.country ?? null,
      notifyOnReceive: true,
    });
    return NextResponse.json({ ok: true, redirect: "/business" });
  }

  return NextResponse.json({ error: "unknown account type" }, { status: 400 });
}
