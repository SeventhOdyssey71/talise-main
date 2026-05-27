import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { userById } from "@/lib/db";
import { Transaction } from "@mysten/sui/transactions";
import { toBase64 } from "@mysten/sui/utils";
import { sui } from "@/lib/sui";
import {
  appendNaviWithdraw,
  fetchNaviCurrentValue,
  fetchNaviUsdsuiSupplyApy,
  naviPositionFromActivity,
} from "@/lib/navi-supply";
import { appendPaymentKitReceipt } from "@/lib/intents/wrap-payment-kit";
import { getRecentActivity } from "@/lib/activity";
import { getEarnSnapshot } from "@/lib/yield";

export const runtime = "nodejs";

/**
 * POST /api/earn/withdraw-earned/prepare
 *
 * Withdraws ONLY the accrued yield from the user's NAVI USDsui position,
 * leaving the principal supplied to keep earning. The server computes
 * `earned = currentValue − principalSupplied` at request time so the
 * value is always fresh-on-chain — the client never sends an amount.
 *
 * Today this only supports `venue: "navi"`. DeepBook redeems shares, not
 * USDsui units, so a partial yield-only withdraw isn't a clean primitive
 * there and is omitted until we wire share-to-USDsui conversion.
 *
 * Body: { venue: "navi" }
 * Returns: { transactionKindB64, sender, earned }
 */

export async function POST(req: Request) {
  const userId = await readEntryIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const user = await userById(userId);
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  let body: { venue?: string };
  try {
    body = (await req.json()) as { venue?: string };
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const venue = (body.venue ?? "navi").toLowerCase();
  if (venue !== "navi") {
    // DeepBook's withdraw redeems supplier shares, not a typed USDsui
    // amount — a partial yield-only redeem isn't trivially expressible
    // until we wire share-to-USDsui conversion. Surface this clearly
    // so the iOS UI can hide the button for non-navi venues.
    return NextResponse.json(
      { error: 'venue "navi" only — partial yield-only withdraw isn\'t supported on deepbook yet' },
      { status: 400 }
    );
  }

  try {
    // Fetch the position + activity in parallel. `getEarnSnapshot` is
    // already memoized inside `@t2000/sdk`'s adapter; we also fall back
    // to `fetchNaviCurrentValue` if the snapshot somehow lacks a value
    // (shouldn't happen in practice but the guard is cheap).
    const [snap, apyLive, activity, fallbackCurrent] = await Promise.all([
      getEarnSnapshot(user.sui_address).catch(() => null),
      fetchNaviUsdsuiSupplyApy().catch(() => null),
      getRecentActivity(user.sui_address, 200, { includeNonTalise: false }).catch(
        () => []
      ),
      fetchNaviCurrentValue(user.sui_address).catch(() => 0),
    ]);
    const currentValue = snap?.supplied ?? fallbackCurrent;
    const apy = apyLive ?? snap?.apy ?? 0;
    if (currentValue <= 0) {
      return NextResponse.json(
        { error: "no NAVI USDsui position to withdraw" },
        { status: 404 }
      );
    }

    const naviRows = activity
      .filter((a) => (a.venue ?? "").toLowerCase() === "navi")
      .map((a) => ({
        direction: a.direction,
        venue: a.venue,
        amountUsdsui: a.amountUsdsui,
        // Earliest-invest timestamp feeds the time-weighted
        // projection in naviPositionFromActivity when naive principal
        // exceeds currentValue (USDsui-dust rounding case).
        timestampMs: a.timestampMs,
      }));
    const detail = naviPositionFromActivity({
      currentValue,
      apy,
      naviActivity: naviRows,
    });

    // Dust floor: anything under 1 cent of USDsui is rounding noise
    // for the integer-u64 conversion. The button on iOS uses a more
    // conservative ₦10 / ~$0.01 floor; we mirror that on the server
    // so a stale client doesn't try to ship a 0-amount withdraw.
    const DUST_USDSUI = 0.01;
    if (detail.earned < DUST_USDSUI) {
      return NextResponse.json(
        {
          error: "no accrued yield to withdraw yet",
          earned: detail.earned,
          currentValue: detail.currentValue,
          principalSupplied: detail.principalSupplied,
        },
        { status: 422 }
      );
    }

    const tx = new Transaction();
    tx.setSender(user.sui_address);

    // Pass the exact earned USDsui amount to Navi's withdraw entry.
    // The adapter takes a USDsui amount (positive number, human
    // units) — same path the partial-withdraw uses. Pyth refresh
    // for the health check is appended internally.
    await appendNaviWithdraw(tx, user.sui_address, detail.earned);

    // Tag the tx with a typed Payment-Kit memo so the activity
    // classifier later subtracts THIS withdraw from the principal
    // replay correctly — `kind: withdraw, venue: navi`, amount =
    // the earned USDsui. The receipt nonce is the source of truth
    // the next position-detail read uses.
    const { nonce } = appendPaymentKitReceipt(tx, {
      kind: "withdraw",
      sender: user.sui_address,
      refs: { venue: "navi" },
    });

    const kind = await tx.build({
      client: sui() as never,
      onlyTransactionKind: true,
    });

    return NextResponse.json({
      transactionKindB64: toBase64(kind),
      venue,
      earned: detail.earned,
      currentValue: detail.currentValue,
      principalSupplied: detail.principalSupplied,
      receiptNonce: nonce,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "build failed: " + (err as Error).message },
      { status: 500 }
    );
  }
}
