import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { userById } from "@/lib/db";
import { toBase64 } from "@mysten/sui/utils";
import { sui } from "@/lib/sui";
import { buildCreateVaultTx, VaultNotDeployedError } from "@/lib/vault";

export const runtime = "nodejs";

/**
 * POST /api/vault/create
 *
 * Builds a sponsored-ready PTB calling `talise::vault::create()` for the
 * signed-in user. The vault is a shared object owned by the caller —
 * one per user, post-onboarding.
 *
 * Body: (none)
 * Returns: { bytesB64, sender }
 *
 * Flow:
 *   1. Client POSTs here, gets `bytesB64`.
 *   2. Client zk-signs + executes the tx (via /api/zk/sponsor-execute).
 *   3. Client extracts the new vault id from `objectChanges` and POSTs
 *      it to /api/vault/record, which persists it to the user row.
 *
 * We deliberately *don't* write the vault id from this route — the tx
 * could fail server-side after the client signed it (rare but possible),
 * and we'd leak a stale row. /api/vault/record verifies the digest
 * on-chain before committing.
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
  if (user.talise_vault_id) {
    return NextResponse.json(
      { error: "vault already exists", vaultId: user.talise_vault_id },
      { status: 409 }
    );
  }

  try {
    const tx = buildCreateVaultTx(user.sui_address);
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
