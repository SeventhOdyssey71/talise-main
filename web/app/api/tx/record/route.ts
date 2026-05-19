import { NextResponse } from "next/server";
import { readSessionEntryId } from "@/lib/session";
import { markInvoicePaid, recordTx, userById } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const userId = await readSessionEntryId();
  if (!userId) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const user = await userById(userId);
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  let body: {
    digest?: string;
    kind?: string;
    amount?: string;
    asset?: string;
    recipient?: string;
    memo?: string;
    invoiceSlug?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  if (!body.digest || typeof body.digest !== "string") {
    return NextResponse.json({ error: "digest required" }, { status: 400 });
  }

  await recordTx({
    userId: user.id,
    digest: body.digest,
    kind: body.kind ?? "send",
    amount: body.amount ?? null,
    asset: body.asset ?? null,
    recipient: body.recipient ?? null,
    memo: body.memo ?? null,
  });

  // If this payment satisfied an invoice, close it out.
  if (body.invoiceSlug) {
    try {
      await markInvoicePaid(body.invoiceSlug, body.digest, user.sui_address);
    } catch (e) {
      console.warn(`[tx/record] invoice close failed: ${(e as Error).message}`);
    }
  }

  return NextResponse.json({ ok: true });
}
