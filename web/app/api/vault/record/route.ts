import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { userById, setTaliseVaultId } from "@/lib/db";
import { sui, suiJsonRpc } from "@/lib/sui";
import {
  vaultPackageIds,
  VaultNotDeployedError,
  buildRepointSubnameTx,
} from "@/lib/vault";
import { findTaliseSubnameForOwner } from "@/lib/suins-lookup";
import { suins } from "@/lib/suins-operator";
import { toBase64 } from "@mysten/sui/utils";

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
  // iOS can't extract the new vault id locally (vault::create transfers
  // via share_object and the entry returns void), so the client is
  // allowed to omit `vaultId` and we resolve it from the digest's
  // object-changes below. Web callers that already know the id pass
  // both and we verify match-up as a defense-in-depth check.
  let vaultId = (body.vaultId ?? "").trim();
  const digest = (body.digest ?? "").trim();
  if (!digest) {
    return NextResponse.json({ error: "digest required" }, { status: 400 });
  }
  if (vaultId && !/^0x[a-fA-F0-9]+$/.test(vaultId)) {
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
    // JSON-RPC: `getTransactionBlock` response shape
    // (`transaction.data.sender`, `objectChanges[].type === "created"`,
    // `effects.status.status`) is what this verifier consumes.
    const tx = await suiJsonRpc().getTransactionBlock({
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

    // 2. Locate the freshly-created `TaliseVault` in the digest's
    //    object-changes. If the client supplied a vaultId we verify it
    //    matches one; if not, we adopt the first match (there's only
    //    ever one created vault per `vault::create` call).
    const expectedType = `${packageId}::vault::TaliseVault`;
    const changes = tx.objectChanges ?? [];
    const createdVaults = changes.filter((c) => {
      if (c.type !== "created") return false;
      const obj = c as { objectType?: string };
      return obj.objectType === expectedType;
    }) as Array<{ objectId?: string; objectType?: string }>;

    if (createdVaults.length === 0) {
      return NextResponse.json(
        {
          error: "no TaliseVault was created in this tx",
          expectedType,
        },
        { status: 400 }
      );
    }

    if (vaultId) {
      const found = createdVaults.find(
        (c) => (c.objectId ?? "").toLowerCase() === vaultId.toLowerCase()
      );
      if (!found) {
        return NextResponse.json(
          { error: "vaultId not present in tx as a created TaliseVault" },
          { status: 400 }
        );
      }
    } else {
      // Adopt the derived id. We've already verified type + sender,
      // so this is safe.
      vaultId = createdVaults[0].objectId ?? "";
      if (!vaultId) {
        return NextResponse.json(
          { error: "TaliseVault created but objectId missing from receipt" },
          { status: 502 }
        );
      }
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

  // SuiNS repoint stage. After the vault is on record we attempt to build
  // a follow-up PTB that re-targets the user's `*.talise.sui` subname at
  // the new vault id so incoming sends land *inside* the vault instead
  // of the user's plain wallet address.
  //
  // Why this is a separate PTB (not folded into vault::create):
  //   • The subname NFT is owned by the user; only the NFT owner can sign
  //     `set_target_address`. The operator key that minted the subname
  //     no longer has authority over it.
  //   • `vault::create()` uses `transfer::share_object`, so the new
  //     vault id is only knowable from the digest's objectChanges. A
  //     single PTB can chain `create → enable → set_target_address` if
  //     it referenced the create's TransactionResult, but `create` is an
  //     entry function that returns nothing — we'd need a `create_and_share`
  //     variant that returns the vault id, which doesn't exist yet.
  //
  // So we return `repoint` as an optional companion PTB. iOS calls
  // `signAndSubmit` once more, then POSTs to `/api/vault/repoint-confirm`
  // to flip the `talise_vault_subname_repointed` flag. The vault create
  // is durable on its own — repoint failure is non-fatal.
  let repoint:
    | {
        bytesB64: string;
        sender: string;
        nftId: string;
        fullName: string;
        currentTarget: string | null;
        newTarget: string;
      }
    | null = null;
  try {
    const sub = await findTaliseSubnameForOwner(user.sui_address);
    if (sub) {
      let currentTarget: string | null = null;
      try {
        const rec = await suins().getNameRecord(sub.fullName);
        currentTarget = rec?.targetAddress ?? null;
      } catch {
        currentTarget = null;
      }
      // Skip if it's already pointing at the vault.
      if (
        !currentTarget ||
        currentTarget.toLowerCase() !== vaultId.toLowerCase()
      ) {
        const tx = buildRepointSubnameTx(user.sui_address, sub.nftId, vaultId);
        const kind = await tx.build({
          client: sui() as never,
          onlyTransactionKind: true,
        });
        repoint = {
          bytesB64: toBase64(kind),
          sender: user.sui_address,
          nftId: sub.nftId,
          fullName: sub.fullName,
          currentTarget,
          newTarget: vaultId,
        };
      }
    }
  } catch (err) {
    // Repoint construction failure is non-fatal — the vault is already
    // recorded. Log and return repoint:null; iOS shows a banner that the
    // user can act on later.
    console.warn(
      `[vault/record] repoint build failed for user ${userId}: ${(err as Error).message}`
    );
    repoint = null;
  }

  return NextResponse.json({ ok: true, vaultId, repoint });
}
