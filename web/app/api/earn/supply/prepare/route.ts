import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { userById } from "@/lib/db";
import { Transaction } from "@mysten/sui/transactions";
import { toBase64 } from "@mysten/sui/utils";
import { sui } from "@/lib/sui";
import {
  buildSupplyUsdsuiMargin,
  fetchSupplierCapId,
} from "@/lib/deepbook-margin";

export const runtime = "nodejs";

/**
 * POST /api/earn/supply/build
 *
 * Constructs a sponsored-ready PTB that supplies USDsui to the chosen
 * yield venue. Today only the DeepBook margin pool is wired (Talise's
 * highest-APY USDsui venue); NAVI follows the same pattern and will be
 * added when we port the @t2000 SDK PTB builder.
 *
 * Body: { venue: "deepbook" | "navi", amount: number }
 * Returns: { transactionKindB64 } — feed straight into /api/zk/sponsor.
 */

const SUPPORTED_VENUES = new Set(["deepbook", "navi"]);

export async function POST(req: Request) {
  const userId = await readEntryIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const user = await userById(userId);
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  let body: { venue?: string; amount?: number | string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const venue = (body.venue ?? "deepbook").toLowerCase();
  if (!SUPPORTED_VENUES.has(venue)) {
    return NextResponse.json(
      { error: `venue must be one of ${[...SUPPORTED_VENUES].join(", ")}` },
      { status: 400 }
    );
  }
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { error: "amount must be a positive number" },
      { status: 400 }
    );
  }

  if (venue === "navi") {
    // NAVI supply uses the @t2000/sdk PTB builder; we already expose
    // /api/t2000/execute for the web flow. Until that helper is split
    // into a pure builder, mobile uses DeepBook as the default.
    return NextResponse.json(
      { error: "NAVI venue not yet exposed to mobile — try venue=deepbook" },
      { status: 501 }
    );
  }

  try {
    const tx = new Transaction();
    tx.setSender(user.sui_address);

    const capId = await fetchSupplierCapId(user.sui_address).catch(() => null);
    buildSupplyUsdsuiMargin({
      senderAddress: user.sui_address,
      amountUsdsui: amount,
      existingSupplierCapId: capId,
    }).build(tx);

    const kind = await tx.build({
      client: sui() as never,
      onlyTransactionKind: true,
    });

    return NextResponse.json({
      transactionKindB64: toBase64(kind),
      venue,
      amount,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "build failed: " + (err as Error).message },
      { status: 500 }
    );
  }
}
