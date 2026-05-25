import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { userById, setTaliseVaultId } from "@/lib/db";
import { sui } from "@/lib/sui";
import { vaultPackageIds, VaultNotDeployedError } from "@/lib/vault";

export const runtime = "nodejs";

/**
 * POST /api/vault/record
 *
 * Records the user's freshly-minted TaliseVault object id after the
 * client executes `vault::create()`. Verifies the digest on-chain
 * before persisting — we don't trust the body alone.
 *
 * Body: { vaultId, digest }
 * Returns: { ok: true, vaultId } on success.
 *
 * Verification rules:
 *   • The digest must resolve via getTransactionBlock.
 *   • The digest's sender must equal the user's wallet address.
 *   • The vaultId must appear as a `created` shared object in the tx's
 *     objectChanges, with type `<package>::vault::TaliseVault`.
 *
 * If any check fails we return 400 — the client should not retry with
 * the same payload, the data is wrong.
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

  let body: { vaultId?: string; digest?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const vaultId = (body.vaultId ?? "").trim();
  const digest = (body.digest ?? "").trim();
  if (!vaultId || !digest) {
    return NextResponse.json(
      { error: "vaultId and digest required" },
      { status: 400 }
    );
  }
  if (!/^0x[a-fA-F0-9]+$/.test(vaultId)) {
    return NextResponse.json({ error: "vaultId malformed" }, { status: 400 });
  }

  let packageId: string;
  try {
    ({ packageId } = vaultPackageIds());
  } catch (err) {
    if (err instanceof VaultNotDeployedError) {
      return NextResponse.json(
        { error: "auto-swap package not yet deployed" },
        { status: 503 }
      );
    }
    throw err;
  }

  // On-chain verification — we trust nothing the client sends.
  try {
    const tx = await sui().getTransactionBlock({
      digest,
      options: { showObjectChanges: true, showInput: true, showEffects: true },
    });

    // 1. Sender matches the authenticated user. A logged-in user can't
    //    record someone *else's* vault as their own.
    const sender = (tx.transaction?.data?.sender ?? "").toLowerCase();
    if (sender !== user.sui_address.toLowerCase()) {
      return NextResponse.json(
        { error: "digest sender does not match user wallet" },
        { status: 400 }
      );
    }

    // 2. vaultId appears as a created object of the right Move type.
    const expectedType = `${packageId}::vault::TaliseVault`;
    const changes = tx.objectChanges ?? [];
    const match = changes.find((c) => {
      if (c.type !== "created") return false;
      const obj = c as { objectId?: string; objectType?: string };
      return (
        (obj.objectId ?? "").toLowerCase() === vaultId.toLowerCase() &&
        obj.objectType === expectedType
      );
    });
    if (!match) {
      return NextResponse.json(
        {
          error: "vaultId not present in tx as a created TaliseVault",
          expectedType,
        },
        { status: 400 }
      );
    }

    // 3. Tx didn't abort. `effects.status` shape: { status: "success" | "failure" }.
    const status = tx.effects?.status?.status;
    if (status !== "success") {
      return NextResponse.json(
        { error: `tx status not success: ${status ?? "unknown"}` },
        { status: 400 }
      );
    }
  } catch (err) {
    return NextResponse.json(
      { error: "digest verification failed: " + (err as Error).message },
      { status: 400 }
    );
  }

  try {
    await setTaliseVaultId(userId, vaultId);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 409 }
    );
  }

  // TODO(suins-repoint): once the vault is recorded, repoint the user's
  // `@<handle>.talise.sui` SuiNS subname target from their wallet address
  // to `vaultId` so incoming sends land inside the vault. This requires
  // an operator-signed `setTargetAddress` call — see
  // `lib/suins-lookup.ts` for the read side and `lib/suins-operator.ts`
  // for the write helpers. After success, call
  // `markVaultSubnameRepointed(userId)`.
  return NextResponse.json({ ok: true, vaultId });
}
