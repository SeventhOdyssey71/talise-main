import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { userById } from "@/lib/db";
import { toBase64 } from "@mysten/sui/utils";
import { sui } from "@/lib/sui";
import {
  buildWithdrawFromVaultTx,
  isValidTypeTag,
  VaultNotDeployedError,
} from "@/lib/vault";

export const runtime = "nodejs";

/**
 * POST /api/vault/withdraw
 *
 * Builds a PTB that calls
 * `talise::vault::withdraw_and_send<T>(&mut vault, amount, recipient)`,
 * pulling the requested coin out of the user's `TaliseVault` bag and
 * transferring the resulting `Coin<T>` to their wallet address. This is
 * the spendable-balance leg for the auto-swap flow: deposits land in
 * the vault and get swapped to USDsui; this endpoint lets the user move
 * that USDsui (or any other vault balance) back to their main wallet.
 *
 * Body:
 *   {
 *     coinType: string,  // canonical type tag, e.g. the USDsui type
 *     amount:   string,  // u64-as-string in the coin's native decimals
 *   }
 *
 * The Move entry asserts `ctx.sender() == vault.owner` — the DB lookup
 * here is just an ergonomic 4xx guard so we don't ship a tx that would
 * abort on chain.
 *
 * Returns: { bytesB64, sender } — matches every other vault PTB endpoint.
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
  if (!user.talise_vault_id) {
    return NextResponse.json(
      { error: "no vault for user; nothing to withdraw" },
      { status: 409 }
    );
  }

  let body: { coinType?: string; amount?: string | number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const coinType = (body.coinType ?? "").trim();
  if (!isValidTypeTag(coinType)) {
    return NextResponse.json(
      { error: "coinType must look like 0x<addr>::<module>::<Name>" },
      { status: 400 }
    );
  }

  // u64 parsing — accept either number or numeric string so big values
  // survive a JSON roundtrip without precision loss. We never accept a
  // float here; the client is expected to scale to native decimals.
  let amount: bigint;
  try {
    amount = BigInt(body.amount as string | number);
  } catch {
    return NextResponse.json(
      { error: "amount must be an integer (u64-as-string) in native decimals" },
      { status: 400 }
    );
  }
  if (amount <= 0n) {
    // Move asserts E_ZERO_AMOUNT — bounce the request before signing.
    return NextResponse.json(
      { error: "amount must be > 0" },
      { status: 400 }
    );
  }

  try {
    const tx = buildWithdrawFromVaultTx(
      user.sui_address,
      user.talise_vault_id,
      coinType,
      amount
    );
    const kind = await tx.build({
      client: sui() as never,
      onlyTransactionKind: true,
    });
    return NextResponse.json({
      bytesB64: toBase64(kind),
      sender: user.sui_address,
    });
  } catch (err) {
    if (err instanceof VaultNotDeployedError) {
      return NextResponse.json(
        { error: "auto-swap package not yet deployed" },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: "build failed: " + (err as Error).message },
      { status: 500 }
    );
  }
}
