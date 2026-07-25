import { NextResponse } from "next/server";
import { denyUnlessAppApproved } from "@/lib/app-access";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { rateLimitAsync } from "@/lib/rate-limit";
import { userById } from "@/lib/db";
import { Transaction, TransactionDataBuilder } from "@mysten/sui/transactions";
import { toBase64 } from "@mysten/sui/utils";
import { sui, network } from "@/lib/sui";
import { onara } from "@/lib/onara";
import { memoTtl } from "@/lib/perf-cache";
import { appendNaviSupply, SAVE_TREASURY_FEE_BPS } from "@/lib/navi-supply";
import { appendPaymentKitReceipt } from "@/lib/intents/wrap-payment-kit";
import {
  LOG,
  claimSendDigest,
  markPrepared,
  markSaveFailed,
} from "@/lib/rewards/roundup-save";

export const runtime = "nodejs";

/**
 * POST /api/send/roundup/prepare
 *
 * The Spend + Save leg, as its OWN sponsored transaction.
 *
 * Body: `{ token, sendDigest }`. Returns sponsor-ready TransactionData
 * bytes the client signs with the same in-session ephemeral zkLogin key
 * it just used for the send, then forwards to `/api/zk/sponsor-execute`
 * with `meta.roundupSaveToken` so settlement can find this row.
 *
 * ── Why a separate transaction ───────────────────────────────────────
 *
 * The round-up used to be appended to the send's PTB. That combined
 * shared-object transaction blew the sponsor window (2026-06-22: "send+save
 * timed out ... a STANDALONE NAVI supply sponsors cleanly"), so the leg was
 * pulled out and then nothing ever fired it. This route is that missing
 * transaction: `appendNaviSupply` + the Payment Kit receipt, sponsored by
 * Onara, exactly the shape `/api/earn/supply/prepare` uses for the Invest
 * screen, which is the path known to sponsor cleanly.
 *
 * ── What the client cannot do here ───────────────────────────────────
 *
 *   • It cannot state an amount. The amount was computed by
 *     `/api/send/sponsor-prepare` from the send it actually made and
 *     stored on the `roundup_saves` row under `token`.
 *   • It cannot save twice for one send. Binding the send digest to the
 *     row goes through a UNIQUE index; a second attempt is refused.
 *   • It cannot make the tally move by calling this at all. Nothing is
 *     credited here. Only a digest read back off chain credits anything
 *     (lib/rewards/roundup-save.ts).
 */

/** Same generous fixed budget the other sponsored rails use. */
const SPONSOR_GAS_BUDGET_MIST = 60_000_000n;
const DIGEST_RE = /^[1-9A-HJ-NP-Za-km-z]{40,60}$/;

export async function POST(req: Request) {
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
  const [denied, rl, user] = await Promise.all([
    denyUnlessAppApproved(userId),
    // One save per send, and sends are capped at 30/hr on both rails, so
    // 60/hr here is headroom for retries without being a free PTB-building
    // faucet.
    rateLimitAsync({ key: `roundup-prepare:user:${userId}`, limit: 60, windowSec: 3600 }),
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

  let body: { token?: string; sendDigest?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const token = (body.token ?? "").trim();
  const sendDigest = (body.sendDigest ?? "").trim();
  if (!token) {
    return NextResponse.json({ error: "missing token" }, { status: 400 });
  }
  if (!DIGEST_RE.test(sendDigest)) {
    return NextResponse.json(
      { error: "sendDigest must be a Sui transaction digest" },
      { status: 400 }
    );
  }

  // Bind this round-up to the send it belongs to. The UNIQUE
  // (user_id, send_digest) index is the one-save-per-send guarantee.
  const claim = await claimSendDigest({ userId, token, sendDigest });
  if (!claim.ok) {
    const status = claim.reason === "send-already-saved" ? 409 : 404;
    console.warn(
      `${LOG} prepare refused user=${userId} send=${sendDigest} reason=${claim.reason}`
    );
    return NextResponse.json(
      {
        error:
          claim.reason === "send-already-saved"
            ? "This send has already been rounded up."
            : "No round-up is pending for this send.",
        code: claim.reason,
      },
      { status }
    );
  }
  const row = claim.row;

  try {
    const t0 = Date.now();
    const client = sui();
    const net = network();
    const onaraClient = onara();

    // Sponsor address + gas price in parallel with the PTB build, same
    // memo windows as the send path.
    const sponsorPromise = memoTtl(
      `onara:status:${onaraUrl}`,
      60_000,
      () => onaraClient.status()
    );
    const gasPricePromise = memoTtl(`sui:gas-price:${net}`, 1_500, async () => {
      const r = await client.getReferenceGasPrice();
      return r.referenceGasPrice;
    });

    const tx = new Transaction();
    tx.setSender(user.sui_address);

    // The real money movement: 1% to the save treasury, the remainder
    // supplied to NAVI for the user's own account. Identical call to the
    // one the Invest screen makes.
    await appendNaviSupply(tx, user.sui_address, row.amountUsd, {
      treasuryFeeBps: SAVE_TREASURY_FEE_BPS,
    });

    // On-chain receipt so the activity feed + any third-party indexer can
    // recover "this was a save into NAVI" authoritatively instead of
    // sniffing MoveCall packages.
    const { nonce } = appendPaymentKitReceipt(tx, {
      kind: "invest",
      sender: user.sui_address,
      refs: { venue: "navi" },
    });
    const tBuilt = Date.now();

    const [{ address: sponsor }, gasPrice] = await Promise.all([
      sponsorPromise,
      gasPricePromise,
    ]);
    tx.setGasOwner(sponsor);
    tx.setGasPrice(BigInt(gasPrice));
    tx.setGasBudget(SPONSOR_GAS_BUDGET_MIST);

    const bytes = await tx.build({ client: client as never });

    // A Sui digest is a hash of these exact TransactionData bytes, so we
    // know it before anyone signs. Recording it now is what lets
    // settlement refuse any other digest, and what lets the cron drain
    // find this save on chain even if the client never comes back.
    const saveDigest = TransactionDataBuilder.getDigestFromBytes(bytes);
    await markPrepared({ id: row.id, saveDigest });

    console.log(
      `${LOG} prepared user=${userId} row=${row.id} send=${sendDigest} ` +
        `save=${saveDigest} gross=${row.amountUsd} net=${row.netUsd} ` +
        `ptb=${tBuilt - t0}ms total=${Date.now() - t0}ms`
    );

    return NextResponse.json({
      bytes: toBase64(bytes),
      token: row.token,
      /** Gross round-up leaving the wallet. */
      amountUsd: row.amountUsd,
      /** What reaches NAVI (gross minus the 1% save fee). */
      netUsd: row.netUsd,
      feeBps: SAVE_TREASURY_FEE_BPS,
      saveDigest,
      receiptNonce: nonce,
      venue: "navi",
    });
  } catch (err) {
    // Honest failure. The commonest real cause is the send having taken
    // the balance the round-up needed; the user must see that, and the
    // tally must not move.
    const msg = (err as Error).message ?? "build failed";
    const insufficient = /insufficient|not enough|no coins|balance/i.test(msg);
    await markSaveFailed(
      row.id,
      insufficient ? `insufficient balance: ${msg}` : `build failed: ${msg}`
    ).catch(() => {});
    console.error(
      `${LOG} PREPARE_FAILED user=${userId} row=${row.id} send=${sendDigest} amount=${row.amountUsd}: ${msg}`
    );
    return NextResponse.json(
      {
        error: insufficient
          ? "Not enough USDsui left to round up this send. Your savings total is unchanged."
          : "Couldn't set up the round-up save. Your savings total is unchanged.",
        code: insufficient ? "ROUNDUP_INSUFFICIENT_BALANCE" : "ROUNDUP_BUILD_FAILED",
        detail: msg,
      },
      { status: insufficient ? 400 : 500 }
    );
  }
}
