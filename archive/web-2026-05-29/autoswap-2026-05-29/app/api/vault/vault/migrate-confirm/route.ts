import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import {
  userById,
  setTaliseVaultId,
  markVaultSubnameRepointed,
  db,
  ensureSchema,
} from "@/lib/db";
import { getNormalizedTransaction } from "@/lib/sui-shapes";
import { vaultPackageIds, VaultNotDeployedError } from "@/lib/vault";

export const runtime = "nodejs";

/**
 * POST /api/vault/migrate-confirm
 *
 * Confirms one stage of the legacy-user migration started by
 * `/api/vault/migrate-bundle`. Two stage variants:
 *
 *   { stage: "create-vault", vaultId, digest }
 *     → verify on chain (same checks as /api/vault/record) and persist
 *       talise_vault_id.
 *
 *   { stage: "repoint", digest }
 *     → verify on chain (same checks as /api/vault/repoint-confirm) and
 *       flip talise_vault_subname_repointed.
 *
 * When the caller knows both stages have already happened (e.g. they
 * coalesce the two response digests into one round-trip), they can pass
 * `{ stage: "both", vaultId, createDigest, repointDigest }` — we do the
 * two verifications and persist both columns in a single batch.
 *
 * The single-stage variants exist because iOS chains the two PTBs back
 * to back; each call here is keyed to the digest that just landed so the
 * UI can show a precise success/failure boundary per stage.
 */
type Body = {
  stage?: "create-vault" | "repoint" | "both";
  vaultId?: string;
  digest?: string;
  createDigest?: string;
  repointDigest?: string;
};

export async function POST(req: Request) {
  const userId = await readEntryIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const user = await userById(userId);
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const stage = body.stage ?? "both";

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

  // ───────────────────────────────────────────────────────────────
  // Helpers — both shapes call into the same verifiers.

  const verifyCreate = async (
    digest: string,
    expectedVaultId: string
  ): Promise<{ ok: true } | { ok: false; error: string }> => {
    if (!/^0x[a-fA-F0-9]+$/.test(expectedVaultId)) {
      return { ok: false, error: "vaultId malformed" };
    }
    try {
      // gRPC: normalized shape from `sui-shapes.ts` — `sender`,
      // `objectChanges[].kind === "created"`, `status` are the canonical
      // fields the verifiers consume.
      const tx = await getNormalizedTransaction(digest);
      if (tx.sender !== user.sui_address.toLowerCase()) {
        return { ok: false, error: "create-tx sender mismatch" };
      }
      const expectedType = `${packageId}::vault::TaliseVault`;
      const match = tx.objectChanges.find(
        (c) =>
          c.kind === "created" &&
          c.objectId === expectedVaultId.toLowerCase() &&
          c.objectType === expectedType
      );
      if (!match) {
        return { ok: false, error: "vaultId not created in tx" };
      }
      if (tx.status !== "success") {
        return {
          ok: false,
          error: `create tx status: ${tx.errorMessage ?? tx.status}`,
        };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  };

  const verifyRepoint = async (
    digest: string
  ): Promise<{ ok: true } | { ok: false; error: string }> => {
    try {
      // gRPC: normalized shape from `sui-shapes.ts` — `sender` and `status`
      // are the canonical fields the repoint verifier consumes.
      const tx = await getNormalizedTransaction(digest);
      if (tx.sender !== user.sui_address.toLowerCase()) {
        return { ok: false, error: "repoint-tx sender mismatch" };
      }
      if (tx.status !== "success") {
        return {
          ok: false,
          error: `repoint tx status: ${tx.errorMessage ?? tx.status}`,
        };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  };

  if (stage === "create-vault") {
    const digest = (body.digest ?? "").trim();
    const vaultId = (body.vaultId ?? "").trim();
    if (!digest || !vaultId) {
      return NextResponse.json(
        { error: "vaultId and digest required" },
        { status: 400 }
      );
    }
    const r = await verifyCreate(digest, vaultId);
    if (!r.ok) {
      return NextResponse.json({ error: r.error }, { status: 400 });
    }
    try {
      await setTaliseVaultId(userId, vaultId);
    } catch (err) {
      return NextResponse.json(
        { error: (err as Error).message },
        { status: 409 }
      );
    }
    return NextResponse.json({ ok: true, stage: "create-vault", vaultId });
  }

  if (stage === "repoint") {
    const digest = (body.digest ?? "").trim();
    if (!digest) {
      return NextResponse.json({ error: "digest required" }, { status: 400 });
    }
    const r = await verifyRepoint(digest);
    if (!r.ok) {
      return NextResponse.json({ error: r.error }, { status: 400 });
    }
    await markVaultSubnameRepointed(userId);
    return NextResponse.json({ ok: true, stage: "repoint" });
  }

  if (stage === "both") {
    const vaultId = (body.vaultId ?? "").trim();
    const createDigest = (body.createDigest ?? "").trim();
    const repointDigest = (body.repointDigest ?? "").trim();
    if (!vaultId || !createDigest || !repointDigest) {
      return NextResponse.json(
        { error: "vaultId, createDigest, repointDigest all required" },
        { status: 400 }
      );
    }
    const c = await verifyCreate(createDigest, vaultId);
    if (!c.ok) {
      return NextResponse.json(
        { error: `create stage: ${c.error}` },
        { status: 400 }
      );
    }
    const r = await verifyRepoint(repointDigest);
    if (!r.ok) {
      return NextResponse.json(
        { error: `repoint stage: ${r.error}` },
        { status: 400 }
      );
    }
    // Both verified — persist in a single DB hit so a partial write can't
    // leave the user row half-migrated.
    await ensureSchema();
    await db().execute({
      sql: "UPDATE users SET talise_vault_id = ?, talise_vault_subname_repointed = 1 WHERE id = ?",
      args: [vaultId, userId],
    });
    return NextResponse.json({ ok: true, stage: "both", vaultId });
  }

  return NextResponse.json(
    { error: `unknown stage: ${stage}` },
    { status: 400 }
  );
}
