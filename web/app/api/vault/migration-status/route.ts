import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { userById } from "@/lib/db";
import { findTaliseSubnameForOwner } from "@/lib/suins-lookup";
import { suins } from "@/lib/suins-operator";
import { vaultPackageIds, VaultNotDeployedError } from "@/lib/vault";
import { memoTtl } from "@/lib/perf-cache";

export const runtime = "nodejs";

/**
 * Migration state changes only when the user:
 *   • claims a subname (rare, once per user)
 *   • creates a vault (one-time)
 *   • repoints the subname (one-time)
 *
 * None of those happen mid-session, so a 90s TTL is comfortable. The
 * banner shows up reliably on appear; once the user takes the action,
 * the post-action refresh inside AutoSwapMigrationBanner already busts
 * via a fresh authed request after the TTL elapses.
 */
const MIGRATION_CACHE_TTL_MS = 90_000;

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

  // Cache the heavy lookup (subname scan + getNameRecord) keyed by the
  // user. Cache key includes the current vault id so a just-created
  // vault doesn't keep returning "no-vault" until the TTL elapses.
  const vaultId = user.talise_vault_id ?? null;
  const cacheKey = `migration:${user.sui_address.toLowerCase()}:${vaultId ?? "novault"}`;
  const status = await memoTtl(cacheKey, MIGRATION_CACHE_TTL_MS, async () => {
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

    return {
      needsMigration:
        reason === "no-vault" || reason === "subname-not-repointed",
      reason,
      subname: subnameDTO,
      vaultId,
    } satisfies Status;
  });

  return NextResponse.json(status, {
    headers: {
      // 30s edge cache + SWR — banner state changes are non-urgent.
      "Cache-Control":
        "private, max-age=0, s-maxage=30, stale-while-revalidate=120",
    },
  });
}
