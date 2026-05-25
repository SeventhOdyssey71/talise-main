import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { userById } from "@/lib/db";
import { Transaction } from "@mysten/sui/transactions";
import { toBase64 } from "@mysten/sui/utils";
import { sui } from "@/lib/sui";
import {
  buildWithdrawUsdsuiMargin,
  fetchSupplierCapId,
} from "@/lib/deepbook-margin";
import { appendNaviWithdraw } from "@/lib/navi-supply";
import { appendPaymentKitReceipt } from "@/lib/intents/wrap-payment-kit";

export const runtime = "nodejs";

/**
 * POST /api/earn/withdraw/prepare
 *
 * Mirror of /api/earn/supply/prepare for the opposite leg. Builds a
 * sponsored-ready PTB that redeems the user's USDsui shares from the
 * chosen venue back to their wallet.
 *
 * Body:
 *   {
 *     venue: "deepbook" | "navi",
 *     // omit to withdraw the entire position (interest + principal)
 *     amount?: number,
 *   }
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

  let body: { venue?: string; amount?: number | string | null };
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

  // amount is optional. Null / undefined / 0 means "withdraw all".
  // Anything positive is treated as a partial withdrawal in USDsui.
  const amountNum =
    body.amount == null || body.amount === "" ? undefined : Number(body.amount);
  if (amountNum !== undefined && (!Number.isFinite(amountNum) || amountNum < 0)) {
    return NextResponse.json(
      { error: "amount must be a non-negative number, or omit for full withdraw" },
      { status: 400 }
    );
  }

  try {
    const tx = new Transaction();
    tx.setSender(user.sui_address);

    if (venue === "navi") {
      // NAVI withdraw refreshes the Pyth oracle in the same PTB
      // (required for the position-health check). `undefined` =
      // "withdraw the full supplied amount" — the adapter reads the
      // user's live position internally.
      await appendNaviWithdraw(
        tx,
        user.sui_address,
        amountNum && amountNum > 0 ? amountNum : undefined
      );
    } else {
      const capId = await fetchSupplierCapId(user.sui_address);
      if (!capId) {
        return NextResponse.json(
          { error: "you don't have a DeepBook position to withdraw" },
          { status: 404 }
        );
      }
      buildWithdrawUsdsuiMargin({
        senderAddress: user.sui_address,
        supplierCapId: capId,
        amountUsdsui: amountNum && amountNum > 0 ? amountNum : undefined,
      }).build(tx);
    }

    // Universal Talise receipt — see /api/earn/supply/prepare for the
    // full rationale. The venue's withdraw MoveCalls above redeem the
    // position; this 1-micro self-ping just tags the tx with a typed
    // memo so the activity classifier can render "Withdrew from Navi"
    // authoritatively from the PaymentRecord nonce.
    const { nonce } = appendPaymentKitReceipt(tx, {
      kind: "withdraw",
      sender: user.sui_address,
      refs: { venue },
    });

    const kind = await tx.build({
      client: sui() as never,
      onlyTransactionKind: true,
    });

    return NextResponse.json({
      transactionKindB64: toBase64(kind),
      venue,
      amount: amountNum ?? null,
      withdrawAll: !amountNum,
      receiptNonce: nonce,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "build failed: " + (err as Error).message },
      { status: 500 }
    );
  }
}
