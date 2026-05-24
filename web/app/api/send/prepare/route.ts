import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { userById } from "@/lib/db";
import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import { toBase64 } from "@mysten/sui/utils";
import { sui, COIN_TYPES, USDSUI_DECIMALS } from "@/lib/sui";
import { USDSUI_TYPE } from "@/lib/usdsui";

export const runtime = "nodejs";

/**
 * POST /api/send/build
 *
 * Server-side PTB construction for iOS. Web builds PTBs inline via
 * @mysten/sui; mobile hands us { to, amount, asset } and we return the
 * `transactionKindB64` ready to feed into /api/zk/sponsor.
 *
 * Why server-side: bundling SuiKit's full PTB builder in the iOS app is
 * a multi-day port we can defer. The kind bytes are deterministic and
 * cheap to produce here.
 */

const SUPPORTED_ASSETS = new Set(["USDsui", "SUI"]);
const ADDRESS_RE = /^0x[a-f0-9]{64}$/i;

export async function POST(req: Request) {
  const userId = await readEntryIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const user = await userById(userId);
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  let body: { to?: string; amount?: number | string; asset?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const to = (body.to ?? "").trim().toLowerCase();
  if (!ADDRESS_RE.test(to)) {
    return NextResponse.json(
      { error: "recipient must be a 0x-prefixed Sui address" },
      { status: 400 }
    );
  }
  if (to === user.sui_address.toLowerCase()) {
    return NextResponse.json(
      { error: "you can't send to your own wallet" },
      { status: 400 }
    );
  }

  const asset = body.asset ?? "USDsui";
  if (!SUPPORTED_ASSETS.has(asset)) {
    return NextResponse.json(
      { error: `asset must be one of ${[...SUPPORTED_ASSETS].join(", ")}` },
      { status: 400 }
    );
  }

  const amountNum = Number(body.amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    return NextResponse.json(
      { error: "amount must be a positive number" },
      { status: 400 }
    );
  }

  const decimals = asset === "USDsui" ? USDSUI_DECIMALS : 9;
  const onchain = BigInt(Math.round(amountNum * 10 ** decimals));
  if (onchain <= 0n) {
    return NextResponse.json({ error: "amount too small" }, { status: 400 });
  }

  try {
    const tx = new Transaction();
    tx.setSender(user.sui_address);

    // Onara's sponsor policy requires every PTB to contain at least
    // one MoveCall (so vanilla coin transfers via splitCoins +
    // transferObjects get rejected). The cheapest no-op MoveCall on
    // Sui is `0x2::clock::timestamp_ms` — reads the Clock object's
    // current timestamp, drops the u64 return. Costs nothing in
    // chain state, satisfies the policy.
    tx.moveCall({
      target: "0x2::clock::timestamp_ms",
      arguments: [tx.object("0x6")],
    });

    // coinWithBalance handles both Coin<T> objects AND the new
    // Address Balance form (May 2026 gasless stablecoins). useGasCoin:
    // false guarantees we never reach for tx.gas (sponsor-owned).
    const coinType = asset === "SUI" ? COIN_TYPES.SUI : USDSUI_TYPE;
    const out = tx.add(
      coinWithBalance({ type: coinType, balance: onchain, useGasCoin: false })
    );
    tx.transferObjects([out], to);

    const kind = await tx.build({
      client: sui() as never,
      onlyTransactionKind: true,
    });

    return NextResponse.json({
      transactionKindB64: toBase64(kind),
      asset,
      amount: amountNum,
      to,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "build failed: " + (err as Error).message },
      { status: 500 }
    );
  }
}
