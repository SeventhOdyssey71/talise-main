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
 * Per-leg timeout wrapper — mirrors `withTimeout` in `lib/activity.ts`.
 * Duplicated locally (rather than imported) so a stalled NAVI read in
 * the activity feed and a stalled NAVI read here can't share a stack
 * frame and both wedge at once. Returns `fallback` on timeout / error
 * and logs `[earn/withdraw-prepare] <leg> timed out after Nms`.
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
        `[earn/withdraw-prepare] ${leg} timed out after ${Date.now() - start}ms`
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
          `[earn/withdraw-prepare] ${leg} failed after ${Date.now() - start}ms: ${(e as Error).message}`
        );
        resolve(fallback);
      }
    );
  });
}

// Sentinel — distinguishes "build timed out / threw" from "build returned
// an empty buffer". Tested by reference equality in the route below.
const BUILD_FAILED: Uint8Array = new Uint8Array(0);

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

  // Outer 10s cap — same shape as `/api/activity`. If the whole
  // pipeline below stalls (typically a NAVI position read going dark),
  // we surface a clean 504 with a user-friendly message instead of
  // iOS's NSURLErrorTimedOut at 60s.
  const OUTER_CAP_MS = 10_000;
  const TIMEOUT_MARKER = Symbol("withdraw-prepare-outer-timeout");
  let outerTimer: ReturnType<typeof setTimeout> | undefined;
  const outerTimeout = new Promise<typeof TIMEOUT_MARKER>((resolve) => {
    outerTimer = setTimeout(() => resolve(TIMEOUT_MARKER), OUTER_CAP_MS);
  });

  const work = (async () => {
    const t0 = Date.now();
    let tPosition = t0;
    let tBuild = t0;
    try {
      const tx = new Transaction();
      tx.setSender(user.sui_address);

      if (venue === "navi") {
        // NAVI withdraw refreshes the Pyth oracle in the same PTB
        // (required for the position-health check). `undefined` =
        // "withdraw the full supplied amount" — the adapter reads the
        // user's live position internally.
        //
        // `appendNaviWithdraw` is the slow leg in the wild — its
        // internal position lookup + Pyth refresh can take 4-8s on a
        // sluggish RPC. Wrap in a 5s timeout: on miss, the route
        // surfaces a clean 504 below rather than letting iOS hit its
        // 60s URLSession default.
        const wrappedAmount =
          amountNum && amountNum > 0 ? amountNum : undefined;
        const ok = await withTimeout(
          appendNaviWithdraw(tx, user.sui_address, wrappedAmount).then(
            () => true
          ),
          5_000,
          "navi-position",
          false
        );
        tPosition = Date.now();
        if (!ok) {
          return NextResponse.json(
            {
              error:
                "Withdraw is taking longer than usual — try again in a few seconds.",
            },
            { status: 504 }
          );
        }
      } else {
        const capId = await withTimeout(
          fetchSupplierCapId(user.sui_address),
          5_000,
          "deepbook-cap",
          null
        );
        tPosition = Date.now();
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

      const kind = await withTimeout(
        tx.build({
          client: sui() as never,
          onlyTransactionKind: true,
        }),
        5_000,
        "tx-build",
        BUILD_FAILED
      );
      tBuild = Date.now();
      if (kind === BUILD_FAILED) {
        return NextResponse.json(
          {
            error:
              "Withdraw is taking longer than usual — try again in a few seconds.",
          },
          { status: 504 }
        );
      }

      console.log(
        `[earn/withdraw-prepare] position=${tPosition - t0}ms rewards=0ms build=${tBuild - tPosition}ms total=${tBuild - t0}ms venue=${venue}`
      );
      // Verification log — per the 2026-05-29 sponsorship-matrix directive.
      // gasOwner + gasPrice get set in /api/zk/sponsor (see its log line
      // with the full `mode=sponsored sponsor=<addr> gasPrice=<n>` shape).
      console.log(
        `[earn/withdraw-prepare] mode=sponsored venue=${venue} amount=${amountNum ?? "all"}`
      );

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
  })();

  const winner = await Promise.race([work, outerTimeout]);
  if (outerTimer) clearTimeout(outerTimer);
  if (winner === TIMEOUT_MARKER) {
    console.warn(
      `[earn/withdraw-prepare] outer cap fired at ${OUTER_CAP_MS}ms (user=${userId}, venue=${venue})`
    );
    return NextResponse.json(
      {
        error:
          "Withdraw is taking longer than usual — try again in a few seconds.",
      },
      { status: 504 }
    );
  }
  return winner as NextResponse;
}
