import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { userById } from "@/lib/db";
import { toBase64 } from "@mysten/sui/utils";
import { sui } from "@/lib/sui";
import {
  buildUpgradeCapToV2Tx,
  isValidTypeTag,
  VaultNotDeployedError,
} from "@/lib/vault";

export const runtime = "nodejs";

/**
 * POST /api/vault/upgrade-cap-v2
 *
 * Builds a PTB calling `vault::upgrade_cap_to_v2<T>(cap, max_per_day,
 * clock)` against the LATEST package id (v7+). Burns a v1
 * `AutoSwapCap<T>` and mints an equivalent shared `AutoSwapCapV2<T>`
 * with the v7 per-day-budget throttle. After v7 lands, the cron only
 * sweeps v2 caps; v1 caps require this owner-signed migration.
 *
 * Body:    { capId, sourceType, maxPerDay }   // maxPerDay is u64-as-string
 * Returns: { bytesB64, sender }               // same shape as pause / disable / migrate-cap
 *
 * The Move entry asserts `ctx.sender() == cap.owner`, `max_per_day > 0`,
 * and `max_per_day >= max_per_swap`. We validate the cap id / type tag
 * shape and the maxPerDay numeric range upfront so a malformed input
 * surfaces as a 400 instead of a build-time error 500.
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

  let body: { capId?: string; sourceType?: string; maxPerDay?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const capId = (body.capId ?? "").trim();
  const sourceType = (body.sourceType ?? "").trim();
  const maxPerDayStr = (body.maxPerDay ?? "").trim();

  if (!/^0x[a-fA-F0-9]+$/.test(capId)) {
    return NextResponse.json({ error: "capId malformed" }, { status: 400 });
  }
  if (!isValidTypeTag(sourceType)) {
    return NextResponse.json(
      { error: "sourceType must look like 0x<addr>::<module>::<Name>" },
      { status: 400 }
    );
  }
  // Strict u64 string — non-empty digits only. Catches accidental
  // doubles / hex / leading-sign cases before the SDK trips on them.
  if (!/^[0-9]+$/.test(maxPerDayStr)) {
    return NextResponse.json(
      { error: "maxPerDay must be a u64-as-string (digits only)" },
      { status: 400 }
    );
  }
  let maxPerDay: bigint;
  try {
    maxPerDay = BigInt(maxPerDayStr);
  } catch {
    return NextResponse.json(
      { error: "maxPerDay parse failed" },
      { status: 400 }
    );
  }
  if (maxPerDay <= 0n) {
    return NextResponse.json(
      { error: "maxPerDay must be > 0" },
      { status: 400 }
    );
  }
  // u64 max — also caught downstream, but surfacing a 400 here is nicer.
  if (maxPerDay > 0xffff_ffff_ffff_ffffn) {
    return NextResponse.json(
      { error: "maxPerDay exceeds u64::MAX" },
      { status: 400 }
    );
  }

  try {
    const tx = buildUpgradeCapToV2Tx(
      user.sui_address,
      capId,
      sourceType,
      maxPerDay
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
