import { NextResponse } from "next/server";
import { readSessionEntryId } from "@/lib/session";
import { createInvoice, invoicesFor, userById } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const userId = await readSessionEntryId();
  if (!userId)
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  const user = await userById(userId);
  if (!user || user.account_type !== "business") {
    return NextResponse.json(
      { error: "business account required" },
      { status: 403 }
    );
  }

  let body: { amount?: string; reference?: string; customerEmail?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const amt = Number(body.amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return NextResponse.json({ error: "amount must be > 0" }, { status: 400 });
  }

  const inv = await createInvoice({
    businessUserId: user.id,
    amountUsdc: amt.toFixed(2),
    reference: body.reference?.trim() || null,
    customerEmail: body.customerEmail?.trim() || null,
  });

  return NextResponse.json({ ok: true, invoice: inv });
}

export async function GET() {
  const userId = await readSessionEntryId();
  if (!userId)
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  const user = await userById(userId);
  if (!user || user.account_type !== "business") {
    return NextResponse.json(
      { error: "business account required" },
      { status: 403 }
    );
  }
  const invoices = await invoicesFor(user.id);
  return NextResponse.json({ invoices });
}
