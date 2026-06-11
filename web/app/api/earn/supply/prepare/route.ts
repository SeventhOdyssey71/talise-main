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
import { appendNaviSupply } from "@/lib/navi-supply";
import { appendPaymentKitReceipt } from "@/lib/intents/wrap-payment-kit";

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

  try {
    const t0 = Date.now();
    const tx = new Transaction();
    tx.setSender(user.sui_address);

    if (venue === "navi") {
      // NAVI is the real default — live ~5% APY on USDsui supply.
      // @t2000/sdk 2.11's NaviAdapter.addSaveToTx is now public, so
      // we can build the supply PTB inline without going through the
      // web-only /api/t2000/execute route.
      await appendNaviSupply(tx, user.sui_address, amount);
    } else {
      // DeepBook margin pool — USDsui borrow demand is ~0% so the
      // realized APY is also ~0%. We still expose the venue for the
      // user who wants to provide liquidity to bootstrap utilization,
      // but it's no longer the default.
      const capId = await fetchSupplierCapId(user.sui_address).catch(() => null);
      buildSupplyUsdsuiMargin({
        senderAddress: user.sui_address,
        amountUsdsui: amount,
        existingSupplierCapId: capId,
      }).build(tx);
    }

    // Universal Talise receipt — appends a Payment Kit
    // `processRegistryPayment` 1-micro self-ping carrying a typed
    // memo `talise/v1|invest|...|venue=navi|...`. The venue's own
    // MoveCalls above do the real money movement; this just tags
    // the tx so the activity classifier (and any third-party
    // indexer) can recover the kind + venue authoritatively from
    // the on-chain PaymentRecord instead of sniffing MoveCall
    // packages heuristically.
    const { nonce } = appendPaymentKitReceipt(tx, {
      kind: "invest",
      sender: user.sui_address,
      refs: { venue },
    });

    const tAppend = Date.now();
    const kind = await tx.build({
      client: sui() as never,
      onlyTransactionKind: true,
    });

    // Verification log — per the 2026-05-29 sponsorship-matrix directive.
    // Prepare returns transactionKindB64; the gasOwner + gasPrice get set
    // in /api/zk/sponsor (which logs the full `mode=sponsored sponsor=<addr>
    // gasPrice=<n>` shape). Emitting `mode=sponsored` here lets us greppably
    // confirm the prepare→sponsor handoff for the earn supply leg.
    // append/build timings split the venue SDK's RPC chain from coin
    // resolution — the data needed to tell a slow venue from a slow node
    // (a 21s dev prepare turned out to be Lagos→us-east amplification of
    // the SDK's serial reads).
    console.log(
      `[earn/supply/prepare] mode=sponsored venue=${venue} amount=${amount} ` +
        `append=${tAppend - t0}ms build=${Date.now() - tAppend}ms`
    );

    return NextResponse.json({
      transactionKindB64: toBase64(kind),
      venue,
      amount,
      receiptNonce: nonce,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "build failed: " + (err as Error).message },
      { status: 500 }
    );
  }
}
