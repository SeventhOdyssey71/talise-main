import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { userById } from "@/lib/db";
import { findTaliseSubnameForOwner } from "@/lib/suins-lookup";
import { suins } from "@/lib/suins-operator";
import { vaultPackageIds, VaultNotDeployedError } from "@/lib/vault";

export const runtime = "nodejs";

type Status = {
  needsMigration: boolean;
  reason: "no-subname" | "no-vault" | "subname-not-repointed" | "done";
  subname: {
    id: string;
    fullName: string;
    currentTarget: string | null;
  } | null;
  vaultId: string | null;
};

/**
 * GET /api/vault/migration-status
 *
 * Read-only snapshot the iOS Home view polls on appear/foreground to
 * decide whether to surface the "Upgrade to USDsui-native wallet"
 * banner. Mirrors what `/api/vault/state` would tell us about the vault
 * but adds a SuiNS-resolution check so we can spot users who pre-date
 * the vault feature and still have `@talise` subnames pointing at their
 * plain wallet.
 *
 * Returns one of four states:
 *   • `done`                    — no banner needed (vault exists, repointed)
 *   • `no-subname`              — banner suppressed; user has nothing to migrate
 *   • `no-vault`                — primary trigger; user has subname, no vault
 *   • `subname-not-repointed`   — vault exists but the subname still resolves
 *                                  to the plain wallet; one-tap repoint
 *
 * 503s gracefully when the auto-swap package isn't deployed yet — the
 * banner stays hidden in that environment so we don't tease a feature
 * the backend can't fulfil.
 */
export async function GET(req: Request) {
  const userId = await readEntryIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const user = await userById(userId);
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  // If the package isn't published, return a synthetic "done" so iOS
  // suppresses the banner cleanly. 503 here would force the client to
  // render an error state for what is effectively an unshipped feature.
  try {
    vaultPackageIds();
  } catch (err) {
    if (err instanceof VaultNotDeployedError) {
      const body: Status = {
        needsMigration: false,
        reason: "done",
        subname: null,
        vaultId: user.talise_vault_id ?? null,
      };
      return NextResponse.json(body, { status: 503 });
    }
    throw err;
  }

  const sub = await findTaliseSubnameForOwner(user.sui_address);
  let currentTarget: string | null = null;
  if (sub) {
    try {
      const rec = await suins().getNameRecord(sub.fullName);
      currentTarget = rec?.targetAddress ?? null;
    } catch {
      currentTarget = null;
    }
  }

  const vaultId = user.talise_vault_id ?? null;
  const subnameDTO = sub
    ? { id: sub.nftId, fullName: sub.fullName, currentTarget }
    : null;

  // Decision matrix:
  //   no subname             -> nothing to migrate
  //   subname, no vault      -> needs full migration
  //   subname, vault, points-at-vault -> done (auto-mark flag)
  //   subname, vault, points-elsewhere -> needs repoint only
  let reason: Status["reason"];
  if (!sub) {
    reason = "no-subname";
  } else if (!vaultId) {
    reason = "no-vault";
  } else if (
    currentTarget &&
    currentTarget.toLowerCase() === vaultId.toLowerCase()
  ) {
    reason = "done";
  } else {
    reason = "subname-not-repointed";
  }

  const status: Status = {
    needsMigration: reason === "no-vault" || reason === "subname-not-repointed",
    reason,
    subname: subnameDTO,
    vaultId,
  };
  return NextResponse.json(status);
}
