import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { userById } from "@/lib/db";
import { toBase64 } from "@mysten/sui/utils";
import { sui } from "@/lib/sui";
import {
  buildEnableDefaultCapsTx,
  DEFAULT_AUTO_SWAP_CAPS,
  VaultNotDeployedError,
} from "@/lib/vault";

export const runtime = "nodejs";

/**
 * POST /api/vault/enable-default-caps
 *
 * Builds a single PTB that mints `AutoSwapCap<T>` for every entry in
 * `DEFAULT_AUTO_SWAP_CAPS` (SUI, USDC, USDT) against the user's existing
 * vault. Three MoveCalls in one tx — the user signs ONCE, the cron sees
 * caps for every common deposit coin, and any future inbound transfer of
 * those coins gets swept automatically.
 *
 * Companion to `/api/vault/enable-autoswap` — that route is the per-coin
 * Enable button on the Settings screen. This route is the one-tap "Enable
 * all coins" CTA invoked right after vault creation (or on subsequent
 * visits if a default is missing).
 *
 * Idempotency: we don't block here when a cap already exists for one of
 * the defaults — the Move entry just mints another one, which the cron
 * tolerates (it picks the first matching cap). If we wanted strict
 * dedupe we'd need to read `/api/vault/state` first, but the cost of an
 * extra cap on a low-volume user isn't worth the GraphQL hit on every
 * call. iOS gates the CTA visibility on the missing-cap check anyway.
 *
 * Body: (none)
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

  try {
    const tx = buildEnableDefaultCapsTx(
      user.sui_address,
      user.talise_vault_id,
      DEFAULT_AUTO_SWAP_CAPS
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
