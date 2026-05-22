import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { userById } from "@/lib/db";
import { getSuiBalance } from "@/lib/sui";
import { getSuiUsdcPrice } from "@/lib/deepbook";

export const runtime = "nodejs";

/**
 * POST /api/sweep/prepare
 *
 * Builds an Onara-sponsored Cetus swap PTB that converts every non-USDsui
 * coin the wallet holds into USDsui. Design intent: Talise displays one
 * unit (USDsui) — any incoming SUI / other coin should be silently
 * normalized so the headline balance always means $.
 *
 * Wiring status:
 *   ▢ Endpoint surface + auth + balance detection (this file) — done.
 *   ▢ Cetus aggregator integration (`@cetusprotocol/aggregator-sdk`) —
 *     PENDING. The SDK does pool discovery + slippage calc + PTB build
 *     server-side. Same Transaction.build({ onlyTransactionKind: true })
 *     pattern as /api/send/prepare, so the existing /api/zk/sponsor +
 *     /api/zk/sponsor-execute pipeline (Onara) handles broadcast.
 *
 * For now we return what the iOS banner needs (the human-readable
 * amounts to display) plus a 501 on the actual swap action so the
 * Convert button surfaces a clear "coming soon" instead of a fake tx.
 */
const DUST_SUI = 0.005; // ~$0.02 — below this the swap fee dominates.

export async function POST(req: Request) {
  const userId = await readEntryIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const user = await userById(userId);
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  let body: { action?: "preview" | "execute" };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const [sui, suiUsd] = await Promise.all([
    getSuiBalance(user.sui_address).catch(() => ({ sui: 0, mist: "0" })),
    getSuiUsdcPrice().catch(() => 0),
  ]);

  const swappableSui = sui.sui;
  const valueUsd = swappableSui * (suiUsd || 0);
  const eligible = swappableSui >= DUST_SUI && suiUsd > 0;

  if (body.action === "execute") {
    if (!eligible) {
      return NextResponse.json(
        { error: "Nothing to sweep — SUI balance is below the dust threshold." },
        { status: 400 }
      );
    }
    // TODO(cetus): build the swap PTB:
    //   1. import { AggregatorClient } from "@cetusprotocol/aggregator-sdk"
    //   2. const route = await client.findRouters({
    //        from: COIN_TYPES.SUI,
    //        target: COIN_TYPES.USDC,
    //        amount: toMist(swappableSui),
    //        byAmountIn: true,
    //      })
    //   3. const tx = new Transaction(); tx.setSender(user.sui_address)
    //   4. const out = await client.fastRouterSwap({ routers: route, ... })(tx)
    //   5. tx.transferObjects([out], user.sui_address)
    //   6. const kind = await tx.build({ client: sui(), onlyTransactionKind: true })
    //   7. return { transactionKindB64: toBase64(kind) }
    // Once that's in, iOS pipes the kind bytes into /api/zk/sponsor →
    // sign with ephemeral → /api/zk/sponsor-execute (existing flow).
    return NextResponse.json(
      {
        error: "Sweep execution not yet wired",
        message:
          "Cetus aggregator integration ships next. For now this preview tells iOS what's swappable.",
      },
      { status: 501 }
    );
  }

  // Preview path — fast, read-only.
  return NextResponse.json({
    eligible,
    from: { coin: "SUI", amount: swappableSui },
    to: { coin: "USDsui", estimateUsd: valueUsd },
    route: "cetus-aggregator",
    sponsored: true,
  });
}
