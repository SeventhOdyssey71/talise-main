import { NextResponse } from "next/server";
import { denyUnlessAppApproved } from "@/lib/app-access";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { rateLimitAsync } from "@/lib/rate-limit";
import { userById } from "@/lib/db";
import { onara } from "@/lib/onara";
import { screenTransfer } from "@/lib/screening";
import { sui } from "@/lib/sui";
import { Transaction } from "@mysten/sui/transactions";
import { toBase64 } from "@mysten/sui/utils";
import {
  shieldConfigured,
  shieldRelayerAddress,
  shieldRelayerKeypair,
} from "@/lib/shield/relayer-config";
import {
  validateTransactCommands,
  ShieldValidationError,
} from "@/lib/shield/validate-commands";

export const runtime = "nodejs";

const ADDRESS_RE = /^0x[a-f0-9]{1,64}$/i;

/**
 * POST /api/shield/relay  { txBytes, exitAddress? }
 *
 * The relayer half of the shielded pool (Workstream C). Mirrors the
 * gate→screen→limit→sponsor flow of `/api/send/sponsor-prepare`, but for a
 * shielded `transact` PTB the CLIENT built (proof generated client-side; the
 * relayer is a gas sponsor + submitter only, NEVER a witness-holder):
 *
 *   1. Gate     — denyUnlessAppApproved + per-user rate limit (anti-abuse).
 *   2. Screen   — screenTransfer on the exit (withdraw) address. ExtData
 *                 carries no recipient by design, so a WITHDRAW must declare
 *                 its exit address here for the compliance screen; an internal
 *                 transfer / deposit has no exit address and skips it.
 *   3. Validate — THE security control: `validateTransactCommands` asserts the
 *                 PTB is exactly a pinned `shielded_pool::transact[_with_account]`
 *                 shape and that ExtData.relayer == ours + fee <= MAX. Reject =>
 *                 400, bytes NEVER forwarded.
 *   4. Sponsor  — set sender = relayer, relayer signs, Onara sponsors gas +
 *                 executes.
 *
 * 503 when the relayer is not configured.
 */
export async function POST(req: Request) {
  if (!shieldConfigured()) {
    return NextResponse.json(
      { error: "shield relayer not configured" },
      { status: 503 }
    );
  }
  const onaraUrl = process.env.ONARA_URL;
  if (!onaraUrl) {
    return NextResponse.json(
      { error: "ONARA_URL not configured" },
      { status: 503 }
    );
  }

  const userId = await readEntryIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  // Gate reads concurrently (allowlist → rate-limit → user-row), same
  // precedence as sponsor-prepare.
  const [denied, rl, user] = await Promise.all([
    denyUnlessAppApproved(userId),
    rateLimitAsync({
      key: `shield-relay:user:${userId}`,
      limit: 30,
      windowSec: 3600,
    }),
    userById(userId),
  ]);
  if (denied) return denied;
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec ?? 3600) } }
    );
  }
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  let body: { txBytes?: string; exitAddress?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const txBytes = (body.txBytes ?? "").trim();
  if (!txBytes) {
    return NextResponse.json({ error: "txBytes required" }, { status: 400 });
  }

  // ── Compliance screen on the exit address (withdraw leg) ──────────────────
  // ExtData has no on-chain recipient field; the relayer screens the declared
  // exit address off-chain before sponsoring. For internal transfers / deposits
  // there is no exit, so `exitAddress` is omitted and the screen is skipped.
  const exitAddress = (body.exitAddress ?? "").trim().toLowerCase();
  if (exitAddress) {
    if (!ADDRESS_RE.test(exitAddress)) {
      return NextResponse.json(
        { error: "exitAddress must be a 0x-prefixed Sui address" },
        { status: 400 }
      );
    }
    const screen = await screenTransfer({
      senderAddr: user.sui_address,
      recipientAddr: exitAddress,
      senderName: user.business_name ?? user.name,
      recipientName: null,
    });
    if (!screen.allow) {
      console.warn(
        `[shield/relay] SCREENING_BLOCK user=${userId} exit=${exitAddress} cause=${screen.cause} reason=${screen.reason}`
      );
      return NextResponse.json(
        {
          error: "This withdrawal was blocked by a compliance screen.",
          code: "SCREENING_BLOCK",
          reason: screen.reason,
        },
        { status: 403 }
      );
    }
  }

  // ── THE security control — command allowlist ──────────────────────────────
  try {
    validateTransactCommands(txBytes);
  } catch (e) {
    if (e instanceof ShieldValidationError) {
      console.warn(`[shield/relay] REJECTED user=${userId}: ${e.message}`);
      return NextResponse.json(
        { error: "rejected by relayer command allowlist", code: "INVALID_PTB", reason: e.message },
        { status: 400 }
      );
    }
    throw e;
  }

  // ── Sponsor + execute via Onara ───────────────────────────────────────────
  // The relayer is the named `ExtData.relayer`, so it MUST be the tx `sender`
  // (the on-chain `ext_data::assert_relayer` checks `sender == relayer`). Onara
  // owns the gas. We rebuild the tx from the validated bytes, set sender, sign
  // with the relayer key, and hand the signed bytes to Onara.
  try {
    const relayer = shieldRelayerAddress()!;
    const signer = shieldRelayerKeypair();
    const onaraClient = onara();
    const client = sui();

    const { address: sponsor } = await onaraClient.status();

    const tx = Transaction.from(txBytes);
    tx.setSender(relayer);
    tx.setGasOwner(sponsor);

    const built = await tx.build({ client: client as never });
    const { signature } = await signer.signTransaction(built);

    const result = await onaraClient.sponsor({
      sender: relayer,
      txBytes: toBase64(built),
      txSignature: signature,
    });

    return NextResponse.json({ ok: true, result });
  } catch (err) {
    const msg = (err as Error).message ?? "relay failed";
    console.warn(`[shield/relay] user=${userId} failed: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
