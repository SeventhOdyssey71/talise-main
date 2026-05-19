import "server-only";

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { PaymentKitClient } from "@mysten/payment-kit";
import { sui } from "./sui";
import { memoTtl } from "./perf-cache";

const REGISTRY_NAME = "talise";

/**
 * Lazily mints the global `talise` PaymentRegistry on chain if it doesn't
 * exist yet. Idempotent — repeated calls within the process lifetime no-op
 * after the first success, and across processes the on-chain object check
 * short-circuits the mint.
 *
 * Without this, `processRegistryPayment` aborts and the tx falls back to
 * a plain transfer — which is exactly why suivision was showing "none" as
 * the transaction kind.
 *
 * Called from `/api/zk/warmup` so the registry is ready before the user's
 * first send. Also safe to call from anywhere else that needs to ensure
 * the registry exists.
 */
export async function ensurePaymentRegistry(): Promise<{ ok: true; minted: boolean }>
export async function ensurePaymentRegistry() {
  // In-process cache: once we've verified the registry exists, never check
  // again for the life of this Node process. Effectively a singleton.
  return memoTtl("pk:registry:exists", 24 * 60 * 60 * 1000, async () => {
    const client = sui();
    const pk = new PaymentKitClient({ client: client as never });
    const registryId = pk.getRegistryIdFromName(REGISTRY_NAME);

    // Fast path: registry already exists on chain (idempotent across procs).
    try {
      const existing = await client.getObject({
        id: registryId,
        options: { showType: true },
      });
      if (existing?.data?.objectId) {
        return { ok: true as const, minted: false };
      }
    } catch {
      /* fall through to mint */
    }

    // Need to mint. The operator key (the same wallet that owns talise.sui
    // and mints subnames) pays its own gas — one-time ~0.005 SUI cost.
    const key = process.env.TALISE_PK_OPERATOR_KEY ?? process.env.TALISE_SUINS_OPERATOR_KEY;
    if (!key) {
      throw new Error(
        "ensurePaymentRegistry: no operator key in env (TALISE_PK_OPERATOR_KEY / TALISE_SUINS_OPERATOR_KEY)"
      );
    }
    const operator = Ed25519Keypair.fromSecretKey(key);
    const operatorAddr = operator.getPublicKey().toSuiAddress();

    const tx = new Transaction();
    // create_registry returns RegistryAdminCap. MUST be transferred or
    // the tx aborts with UnusedValueWithoutDrop. Hand the cap to the
    // operator wallet so we keep admin powers (set config, withdraw funds).
    const adminCap = tx.add(
      pk.calls.createRegistry({ registryName: REGISTRY_NAME })
    );
    tx.transferObjects([adminCap], operatorAddr);
    tx.setSender(operatorAddr);

    const bytes = await tx.build({ client: client as never });
    const { signature } = await operator.signTransaction(bytes);

    const result = await client.executeTransactionBlock({
      transactionBlock: bytes,
      signature,
      options: { showEffects: true },
    });

    if (result.effects?.status?.status !== "success") {
      throw new Error(
        `ensurePaymentRegistry: mint failed — ${
          result.effects?.status?.error ?? "unknown"
        }`
      );
    }

    console.log(
      `[pk-bootstrap] minted PaymentRegistry "${REGISTRY_NAME}" (digest=${result.digest})`
    );
    return { ok: true as const, minted: true };
  });
}
