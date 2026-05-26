import { NextResponse } from "next/server";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { PaymentKitClient } from "@mysten/payment-kit";
import { sui, suiJsonRpc } from "@/lib/sui";
import { ensurePaymentRegistry } from "@/lib/pk-bootstrap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/pk/status
 *
 * Quick read-only probe for the Payment Kit setup. Tells you:
 *   - whether an operator key is configured + that wallet's address
 *   - the deterministic registry id we'd target
 *   - whether the registry object actually exists on chain right now
 *   - the operator's SUI balance (so you know whether mints can pay gas)
 *
 * Use this after a deploy to confirm everything is wired up before
 * users start sending. If `registryExists` is false and the operator
 * has enough gas, `ensurePaymentRegistry()` will mint it on the next
 * /api/zk/warmup call.
 */
export async function GET() {
  const REGISTRY_NAME = "talise";
  const client = sui();
  // Probe paths below use JSON-RPC shapes (`{totalBalance}`,
  // `getObject().data.objectId`) — keep them on the JSON-RPC client.
  const jsonRpcClient = suiJsonRpc();
  const pk = new PaymentKitClient({ client: client as never });
  const registryId = pk.getRegistryIdFromName(REGISTRY_NAME);

  // 1. Operator key + address
  const key =
    process.env.TALISE_PK_OPERATOR_KEY ?? process.env.TALISE_SUINS_OPERATOR_KEY;
  let operatorAddress: string | null = null;
  let operatorBalanceSui: number | null = null;
  if (key) {
    try {
      const kp = Ed25519Keypair.fromSecretKey(key);
      operatorAddress = kp.getPublicKey().toSuiAddress();
      const bal = await jsonRpcClient.getBalance({
        owner: operatorAddress,
        coinType: "0x2::sui::SUI",
      });
      operatorBalanceSui = Number(bal.totalBalance) / 1e9;
    } catch (err) {
      return NextResponse.json({
        ok: false,
        error: `operator key invalid: ${(err as Error).message}`,
      });
    }
  }

  // 2. On-chain existence check (independent of any cache)
  let registryExists = false;
  try {
    const o = await jsonRpcClient.getObject({
      id: registryId,
      options: { showType: true },
    });
    registryExists = !!o?.data?.objectId;
  } catch {
    /* registry doesn't exist */
  }

  // 3. If everything else is wired, opportunistically attempt the mint.
  //    Useful for triggering the bootstrap from a curl in CI.
  if (
    !registryExists &&
    operatorAddress &&
    (operatorBalanceSui ?? 0) > 0.01
  ) {
    try {
      await ensurePaymentRegistry();
      registryExists = true;
    } catch (err) {
      return NextResponse.json({
        ok: false,
        registryId,
        registryExists,
        operatorAddress,
        operatorBalanceSui,
        error: `mint attempt failed: ${(err as Error).message}`,
      });
    }
  }

  return NextResponse.json({
    ok: registryExists && !!operatorAddress,
    registryId,
    registryExists,
    operatorAddress,
    operatorBalanceSui,
    hasOperatorKey: !!key,
    network: process.env.NEXT_PUBLIC_SUI_NETWORK ?? "mainnet",
    explorerUrl: `https://suivision.xyz/object/${registryId}`,
  });
}
