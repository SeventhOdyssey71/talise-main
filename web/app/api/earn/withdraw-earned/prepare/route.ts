import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { denyUnlessAppApproved } from "@/lib/app-access";
import { userById } from "@/lib/db";
import { Transaction } from "@mysten/sui/transactions";
import { toBase64 } from "@mysten/sui/utils";
import { sui } from "@/lib/sui";
import {
  appendNaviClaimRewards,
  fetchNaviCurrentValue,
  fetchNaviUsdsuiSupplyApy,
  naviPositionFromActivity,
} from "@/lib/navi-supply";
import { appendPaymentKitReceipt } from "@/lib/intents/wrap-payment-kit";
import { getRecentActivity } from "@/lib/activity";
import { getEarnSnapshot } from "@/lib/yield";

export const runtime = "nodejs";

/**
 * Per-leg timeout wrapper, mirrors `withTimeout` in `lib/activity.ts`
 * and `withdraw/prepare/route.ts`. Returns `fallback` on timeout/error
 * and logs which leg wedged.
 */
function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  leg: string,
  fallback: T
): Promise<T> {
  const start = Date.now();
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => {
      console.warn(
        `[earn/withdraw-earned-prepare] ${leg} timed out after ${Date.now() - start}ms`
      );
      resolve(fallback);
    }, ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        console.warn(
          `[earn/withdraw-earned-prepare] ${leg} failed after ${Date.now() - start}ms: ${(e as Error).message}`
        );
        resolve(fallback);
      }
    );
  });
}

const BUILD_FAILED: Uint8Array = new Uint8Array(0);

/**
 * POST /api/earn/withdraw-earned/prepare
 *
 * Withdraws ONLY the accrued yield from the user's NAVI USDsui position,
 * leaving the principal supplied to keep earning. The server computes
 * `earned = currentValue − principalSupplied` at request time so the
 * value is always fresh-on-chain, the client never sends an amount.
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
  const denied = await denyUnlessAppApproved(userId);
  if (denied) return denied;
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
    // amount, a partial yield-only redeem isn't trivially expressible
    // until we wire share-to-USDsui conversion. Surface this clearly
    // so the iOS UI can hide the button for non-navi venues.
    return NextResponse.json(
      { error: 'venue "navi" only, partial yield-only withdraw is not supported on deepbook (exit-only venue: withdraw the full position instead)' },
      { status: 400 }
    );
  }

  const OUTER_CAP_MS = 10_000;
  const TIMEOUT_MARKER = Symbol("withdraw-earned-prepare-outer-timeout");
  let outerTimer: ReturnType<typeof setTimeout> | undefined;
  const outerTimeout = new Promise<typeof TIMEOUT_MARKER>((resolve) => {
    outerTimer = setTimeout(() => resolve(TIMEOUT_MARKER), OUTER_CAP_MS);
  });

  const work = (async () => {
    const t0 = Date.now();
  try {
    // CLAIM REWARDS — not a capital withdraw.
    //
    // This route used to compute "earned" (current − principal) and pull that
    // much USDsui out of the supply with appendNaviWithdraw. That is a
    // withdrawal wearing a claim's label: it shrinks the position the user
    // deliberately left earning, and it never touched the incentive tokens NAVI
    // actually owes them.
    //
    // NAVI pays lenders separate reward coins (vSUI on the USDsui pool) that
    // accrue alongside interest and have their own claim call. Claiming them
    // leaves supplied capital exactly where it is, and because NAVI keeps them
    // claimable until taken, a first claim also sweeps any long-unclaimed
    // backlog on the account.
    const tx = new Transaction();
    tx.setSender(user.sui_address);

    let claimed: Awaited<ReturnType<typeof appendNaviClaimRewards>>["claimed"] = [];
    try {
      const res = await appendNaviClaimRewards(tx, user.sui_address);
      claimed = res.claimed;
    } catch (e) {
      const msg = (e as Error).message;
      // "nothing to claim" is a normal state, not a failure.
      const empty = /no NAVI rewards/i.test(msg);
      return NextResponse.json(
        { error: empty ? "You have no NAVI rewards to claim yet." : msg, code: empty ? "NO_REWARDS" : "CLAIM_FAILED" },
        { status: empty ? 422 : 502 }
      );
    }
    const tPosition = Date.now();
    const tRewards = tPosition;

    const { nonce } = appendPaymentKitReceipt(tx, {
      kind: "withdraw",
      sender: user.sui_address,
      refs: { venue: "navi" },
    });

    const kind = await withTimeout(
      tx.build({
        client: sui() as never,
        onlyTransactionKind: true,
      }),
      5_000,
      "tx-build",
      BUILD_FAILED
    );
    const tBuild = Date.now();
    if (kind === BUILD_FAILED) {
      return NextResponse.json(
        {
          error:
            "Withdraw is taking longer than usual, try again in a few seconds.",
        },
        { status: 504 }
      );
    }

    console.log(
      `[earn/withdraw-earned-prepare] position=${tPosition - t0}ms rewards=${tRewards - tPosition}ms build=${tBuild - tRewards}ms total=${tBuild - t0}ms`
    );
    // Verification log, per the 2026-05-29 sponsorship-matrix directive.
    // gasOwner + gasPrice get set in /api/zk/sponsor (see its log line
    // with the full `mode=sponsored sponsor=<addr> gasPrice=<n>` shape).
    console.log(
      `[earn/withdraw-earned-prepare] mode=sponsored venue=${venue} ` +
        `claimed=${claimed.map((c) => `${c.amount}@${c.rewardCoinType.split("::").pop()}`).join(",")}`
    );

    return NextResponse.json({
      transactionKindB64: toBase64(kind),
      venue,
      // What this claim actually moves: reward coins, in their own units.
      // `earned` is deliberately NOT returned any more — it described a
      // capital withdrawal this route no longer performs.
      claimed,
      receiptNonce: nonce,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "build failed: " + (err as Error).message },
      { status: 500 }
    );
  }
  })();

  const winner = await Promise.race([work, outerTimeout]);
  if (outerTimer) clearTimeout(outerTimer);
  if (winner === TIMEOUT_MARKER) {
    console.warn(
      `[earn/withdraw-earned-prepare] outer cap fired at ${OUTER_CAP_MS}ms (user=${userId})`
    );
    return NextResponse.json(
      {
        error:
          "Withdraw is taking longer than usual, try again in a few seconds.",
      },
      { status: 504 }
    );
  }
  return winner as NextResponse;
}
