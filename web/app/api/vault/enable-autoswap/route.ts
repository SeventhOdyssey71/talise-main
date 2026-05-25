import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { userById } from "@/lib/db";
import { toBase64 } from "@mysten/sui/utils";
import { sui } from "@/lib/sui";
import {
  buildEnableAutoSwapTx,
  isValidTypeTag,
  VaultNotDeployedError,
} from "@/lib/vault";

export const runtime = "nodejs";

/**
 * POST /api/vault/enable-autoswap
 *
 * Builds a PTB that calls `talise::auto_swap::enable<Source>(vault_id,
 * max_per_swap, expires_at_ms)`. Mints an `AutoSwapCap<Source>` and
 * transfers it to the user.
 *
 * Body: { sourceType, maxPerSwap, expiresAtMs }
 *   • sourceType  — canonical Move type tag (`0x...::module::Name`).
 *                   Validated against TYPE_TAG_RE in lib/vault.
 *   • maxPerSwap  — u64 in the source coin's native decimals.
 *   • expiresAtMs — unix ms expiry; 0 = no expiry.
 *
 * Returns: { bytesB64, sender }
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
  if (!user.talise_vault_id) {
    return NextResponse.json(
      { error: "no vault for user; call /api/vault/create first" },
      { status: 409 }
    );
  }

  let body: {
    sourceType?: string;
    maxPerSwap?: number | string;
    expiresAtMs?: number | string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const sourceType = (body.sourceType ?? "").trim();
  if (!isValidTypeTag(sourceType)) {
    return NextResponse.json(
      { error: "sourceType must look like 0x<addr>::<module>::<Name>" },
      { status: 400 }
    );
  }

  // u64 parsing — accept either number or numeric string so big values
  // survive a JSON roundtrip without precision loss.
  let maxPerSwap: bigint;
  let expiresAtMs: bigint;
  try {
    maxPerSwap = BigInt(body.maxPerSwap as string | number);
    expiresAtMs = BigInt(body.expiresAtMs as string | number);
  } catch {
    return NextResponse.json(
      { error: "maxPerSwap and expiresAtMs must be integers (u64)" },
      { status: 400 }
    );
  }
  if (maxPerSwap <= 0n) {
    return NextResponse.json(
      { error: "maxPerSwap must be > 0 (Move asserts E_INVALID_MAX otherwise)" },
      { status: 400 }
    );
  }
  if (expiresAtMs < 0n) {
    return NextResponse.json(
      { error: "expiresAtMs must be >= 0" },
      { status: 400 }
    );
  }

  try {
    const tx = buildEnableAutoSwapTx(
      user.sui_address,
      user.talise_vault_id,
      sourceType,
      maxPerSwap,
      expiresAtMs
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
