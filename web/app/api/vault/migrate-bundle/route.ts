import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { userById } from "@/lib/db";
import { toBase64 } from "@mysten/sui/utils";
import { sui } from "@/lib/sui";
import {
  buildCreateVaultTx,
  buildRepointSubnameTx,
  VaultNotDeployedError,
} from "@/lib/vault";
import { findTaliseSubnameForOwner } from "@/lib/suins-lookup";
import { suins } from "@/lib/suins-operator";

export const runtime = "nodejs";

/**
 * POST /api/vault/migrate-bundle
 *
 * Builds the legacy-user migration. The flow has TWO stages because a
 * single PTB can't atomically reference the vault id created within
 * itself: `vault::create()` uses `transfer::share_object` and the entry
 * function returns nothing, so the new vault's id is only knowable from
 * the digest's objectChanges after settlement. To wire `enable_auto_swap`
 * or a SuiNS `set_target_address` into the same PTB we'd need either a
 * `create_and_share` variant returning the new vault id, or a hot-potato
 * pattern — neither is shipped in the current Move package.
 *
 * Decision: two-stage migration. iOS chains the calls transparently:
 *
 *   stage A:  prepare={ kind:"create-vault", bytesB64 }
 *             → iOS sponsor-executes → captures vaultId from objectChanges
 *             → POST /api/vault/record { vaultId, digest }
 *
 *   stage B:  prepare={ kind:"repoint", bytesB64 } (only when a subname
 *             exists; record's response already contains this — iOS can
 *             reuse it rather than calling migrate-bundle again).
 *
 * `POST /api/vault/migrate-bundle { stage: "create-vault" | "repoint" }`
 *   returns: { ok:true, stage, bytesB64?, sender?, vaultId?, subname?, note? }
 *
 * Notes on auto-swap caps:
 *   We deliberately do NOT mint AutoSwapCap<SUI> as part of stage A or
 *   B. The user can flip it on from AutoSwapSettings after migration —
 *   bundling it here would require yet another stage (caps need vault
 *   id) and adds churn for a feature the user may not want enabled by
 *   default. Surfacing it as a follow-up nudge in the UI is the simpler
 *   call.
 */
type StageBody = { stage?: "create-vault" | "repoint" };

export async function POST(req: Request) {
  const userId = await readEntryIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const user = await userById(userId);
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  let body: StageBody;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const stage = body.stage ?? "create-vault";

  try {
    if (stage === "create-vault") {
      if (user.talise_vault_id) {
        return NextResponse.json(
          {
            error: "vault already exists; skip to stage 'repoint'",
            vaultId: user.talise_vault_id,
          },
          { status: 409 }
        );
      }
      const tx = buildCreateVaultTx(user.sui_address);
      const kind = await tx.build({
        client: sui() as never,
        onlyTransactionKind: true,
      });
      return NextResponse.json({
        ok: true,
        stage: "create-vault",
        bytesB64: toBase64(kind),
        sender: user.sui_address,
        note:
          "Sponsor-execute, then POST { vaultId, digest } to /api/vault/record. " +
          "The record response will include the repoint PTB if needed.",
      });
    }

    if (stage === "repoint") {
      if (!user.talise_vault_id) {
        return NextResponse.json(
          { error: "no vault on file; run stage 'create-vault' first" },
          { status: 409 }
        );
      }
      const sub = await findTaliseSubnameForOwner(user.sui_address);
      if (!sub) {
        return NextResponse.json(
          { error: "no `.talise.sui` subname owned by this wallet" },
          { status: 409 }
        );
      }
      // Skip if already pointed at the vault.
      let currentTarget: string | null = null;
      try {
        const rec = await suins().getNameRecord(sub.fullName);
        currentTarget = rec?.targetAddress ?? null;
      } catch {
        currentTarget = null;
      }
      if (
        currentTarget &&
        currentTarget.toLowerCase() === user.talise_vault_id.toLowerCase()
      ) {
        return NextResponse.json({
          ok: true,
          stage: "repoint",
          bytesB64: null,
          sender: user.sui_address,
          subname: {
            id: sub.nftId,
            fullName: sub.fullName,
            currentTarget,
          },
          note: "already pointed at vault; nothing to do",
        });
      }
      const tx = buildRepointSubnameTx(
        user.sui_address,
        sub.nftId,
        user.talise_vault_id
      );
      const kind = await tx.build({
        client: sui() as never,
        onlyTransactionKind: true,
      });
      return NextResponse.json({
        ok: true,
        stage: "repoint",
        bytesB64: toBase64(kind),
        sender: user.sui_address,
        subname: {
          id: sub.nftId,
          fullName: sub.fullName,
          currentTarget,
        },
        vaultId: user.talise_vault_id,
        note:
          "Sponsor-execute, then POST { digest, stage:'repoint' } to /api/vault/migrate-confirm",
      });
    }

    return NextResponse.json(
      { error: `unknown stage: ${stage}` },
      { status: 400 }
    );
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
