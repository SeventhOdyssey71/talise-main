import { NextResponse } from "next/server";
import { readEntryIdFromRequest } from "@/lib/mobile-sessions";
import { requireAppAttestStructural } from "@/lib/app-attest";
import { rateLimitAsync } from "@/lib/rate-limit";
import { userById, db } from "@/lib/db";
import { checkSendAllowed, recordSend } from "@/lib/send-limits";
import { resolveRecipient } from "@/lib/suins";
import { screenTransfer } from "@/lib/screening";
import { Transaction } from "@mysten/sui/transactions";
import { toBase64 } from "@mysten/sui/utils";
import { sui } from "@/lib/sui";
import { USDSUI_TYPE } from "@/lib/usdsui";
import { getCurrentEpoch, getChainIdentifier } from "@/lib/sui-epoch";
import {
  ensureStreamsSchema,
  streamEscrowEnabled,
  streamEscrowAddress,
} from "@/lib/streams";

export const runtime = "nodejs";

/**
 * POST /api/streams/create-prepare
 *
 * Build the sender's ONE funding transaction that moves the FULL stream
 * amount out of their accumulator into the Talise-controlled ESCROW address.
 * Mirrors /api/send/sponsor-prepare's gasless branch (plain USDsui
 * `0x2::balance::send_funds` to the escrow), so funding is gasless when the
 * sender's USDsui lives in their accumulator.
 *
 * Body: `{ to, totalUsd, durationMs, intervalMs }` (or `{ numTranches }`).
 *
 * Steps (design §4.1): auth + App-Attest + rate-limit → resolve recipient →
 * validate schedule (1¢/tranche floor, ceilings) → screenTransfer (fail-
 * closed) → checkSendAllowed on the FULL amount → build funding PTB to the
 * escrow address → return `{ bytes, streamPlan, escrowAddress }`.
 *
 * The DB row is NOT inserted here — it's inserted by /api/streams/record once
 * the funding tx confirms (the funding digest only exists post-execute).
 */

const MIN_GASLESS_MICROS = 10_000n; // 0.01 USDsui (validator gasless minimum)
const MAX_TRANCHES = 100_000;
const MAX_DURATION_MS = 365 * 24 * 60 * 60 * 1000; // 365 days
const MAX_ACTIVE_STREAMS_PER_USER = 20;

export async function POST(req: Request) {
  const userId = await readEntryIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  // App Attest on mobile money routes (structural gate).
  const attest = requireAppAttestStructural(req);
  if (attest) return attest;

  const rl = await rateLimitAsync({
    key: `streams-create:user:${userId}`,
    limit: 10,
    windowSec: 3600,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec ?? 3600) } }
    );
  }

  if (!streamEscrowEnabled()) {
    // Degrade cleanly when the escrow keypair isn't configured.
    return NextResponse.json(
      {
        error:
          "Streaming payments aren't available right now. Please try again later.",
        code: "STREAM_ESCROW_DISABLED",
      },
      { status: 503 }
    );
  }

  const user = await userById(userId);
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  let body: {
    to?: string;
    totalUsd?: number | string;
    durationMs?: number | string;
    intervalMs?: number | string;
    numTranches?: number | string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const toInput = (body.to ?? "").trim();
  if (!toInput) {
    return NextResponse.json({ error: "recipient required" }, { status: 400 });
  }

  const totalUsd = Number(body.totalUsd);
  if (!Number.isFinite(totalUsd) || totalUsd <= 0) {
    return NextResponse.json(
      { error: "totalUsd must be a positive number" },
      { status: 400 }
    );
  }

  // Schedule: derive numTranches from duration/interval, or take it directly.
  const intervalMs = Number(body.intervalMs);
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    return NextResponse.json(
      { error: "intervalMs must be a positive number" },
      { status: 400 }
    );
  }
  let numTranches: number;
  if (body.numTranches != null) {
    numTranches = Math.floor(Number(body.numTranches));
  } else {
    const durationMs = Number(body.durationMs);
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      return NextResponse.json(
        { error: "durationMs (or numTranches) must be a positive number" },
        { status: 400 }
      );
    }
    if (durationMs > MAX_DURATION_MS) {
      return NextResponse.json(
        { error: "durationMs exceeds the 365-day maximum" },
        { status: 400 }
      );
    }
    numTranches = Math.ceil(durationMs / intervalMs);
  }
  if (!Number.isInteger(numTranches) || numTranches <= 0) {
    return NextResponse.json(
      { error: "schedule resolves to zero tranches" },
      { status: 400 }
    );
  }
  if (numTranches > MAX_TRANCHES) {
    return NextResponse.json(
      { error: `numTranches exceeds the ${MAX_TRANCHES} maximum` },
      { status: 400 }
    );
  }

  // µUSDsui math (6dp). Tranche = floor(total / N); the FINAL tranche pays the
  // remainder so sum(tranches) == total exactly (no rounding drift).
  const totalMicros = BigInt(Math.round(totalUsd * 1e6));
  if (totalMicros < MIN_GASLESS_MICROS) {
    return NextResponse.json(
      {
        error:
          "Stream total is below the 0.01 USDsui minimum. Increase the amount.",
        code: "BELOW_GASLESS_MINIMUM",
      },
      { status: 400 }
    );
  }
  const trancheMicros = totalMicros / BigInt(numTranches);
  if (trancheMicros < MIN_GASLESS_MICROS) {
    return NextResponse.json(
      {
        error:
          "Each tranche must be at least 0.01 USDsui. Lower the frequency or raise the total.",
        code: "TRANCHE_BELOW_MINIMUM",
        minMicros: MIN_GASLESS_MICROS.toString(),
      },
      { status: 400 }
    );
  }

  // ── Resolve recipient — must be a REAL Talise/SuiNS recipient (§6 gating).
  let resolved;
  try {
    resolved = await resolveRecipient(toInput);
  } catch (err) {
    console.warn(
      `[streams/create-prepare] resolve failed q=${toInput.slice(0, 32)}: ${(err as Error).message}`
    );
    return NextResponse.json({ error: "recipient lookup failed" }, { status: 502 });
  }
  if (!resolved) {
    return NextResponse.json(
      { error: "recipient not found", code: "RECIPIENT_UNRESOLVED" },
      { status: 404 }
    );
  }
  const recipientAddress = resolved.address.toLowerCase();
  if (recipientAddress === user.sui_address.toLowerCase()) {
    return NextResponse.json(
      { error: "you can't stream to your own wallet" },
      { status: 400 }
    );
  }

  // Cap concurrent active streams per user (bounds scheduler fan-out, §6).
  await ensureStreamsSchema();
  try {
    const r = await db().execute({
      sql: `SELECT COUNT(*) AS n FROM streams WHERE sender_user_id = ? AND state IN ('active','paused')`,
      args: [userId],
    });
    const active = Number((r.rows[0] as { n?: number } | undefined)?.n ?? 0);
    if (active >= MAX_ACTIVE_STREAMS_PER_USER) {
      return NextResponse.json(
        {
          error: `You already have ${active} active streams (max ${MAX_ACTIVE_STREAMS_PER_USER}). Cancel one to start another.`,
          code: "TOO_MANY_ACTIVE_STREAMS",
        },
        { status: 403 }
      );
    }
  } catch {
    /* fail open on the count read — never block a legitimate create */
  }

  // ── Compliance screening — HARD STOP, fail-closed on a sanctions name hit.
  const screen = await screenTransfer({
    senderAddr: user.sui_address,
    recipientAddr: recipientAddress,
    senderName: user.business_name ?? user.name,
    recipientName: null,
  });
  if (!screen.allow) {
    console.warn(
      `[streams/create-prepare] SCREENING_BLOCK user=${userId} to=${recipientAddress} cause=${screen.cause}`
    );
    return NextResponse.json(
      {
        error: "This stream was blocked by a compliance screen.",
        code: "SCREENING_BLOCK",
        reason: screen.reason,
      },
      { status: 403 }
    );
  }

  // ── Hard transaction-limit gate — the WHOLE stream amount counts NOW
  // (funds leave at funding time), so a stream can't dodge tier caps by
  // drip-sending. Fail-open by contract.
  const decision = await checkSendAllowed(userId, totalUsd);
  if (!decision.allowed) {
    return NextResponse.json(
      {
        error: `This stream would exceed your ${decision.window} limit of $${decision.limit.toLocaleString()}. You've sent $${decision.used.toLocaleString()} in this window.`,
        code: "LIMIT_EXCEEDED",
        window: decision.window,
        limit: decision.limit,
        used: decision.used,
      },
      { status: 403 }
    );
  }

  // ── Build the funding PTB: gasless USDsui send of the FULL amount from the
  // sender's accumulator → the escrow address. Same shape as the gasless
  // branch of /api/send/sponsor-prepare.
  const escrowAddress = streamEscrowAddress();
  try {
    const client = sui();
    const tx = new Transaction();
    tx.setSender(user.sui_address);
    tx.moveCall({
      target: "0x2::balance::send_funds",
      typeArguments: [USDSUI_TYPE],
      arguments: [
        tx.balance({ type: USDSUI_TYPE, balance: totalMicros }),
        tx.pure.address(escrowAddress),
      ],
    });
    tx.setGasPrice(0n);
    tx.setGasBudget(0n);

    const [chainId, currentEpoch] = await Promise.all([
      getChainIdentifier(),
      getCurrentEpoch(),
    ]);
    const epochBig = BigInt(currentEpoch);
    tx.setExpiration({
      ValidDuring: {
        minEpoch: String(epochBig),
        maxEpoch: String(epochBig + 1n),
        minTimestamp: null,
        maxTimestamp: null,
        chain: chainId,
        nonce: (Math.random() * 4294967296) >>> 0,
      },
    });
    tx.setGasPayment([]);

    const bytes = await tx.build({ client: client as never });

    // Explicit simulate to preserve prepare-time categorization (underfunded
    // accumulator, dust rule) — never hand iOS bytes the validator rejects.
    const sim = (await client.simulateTransaction({
      transaction: bytes,
      include: { effects: true },
    } as never)) as {
      $kind?: string;
      FailedTransaction?: {
        effects?: {
          status?: { error?: { description?: string; message?: string } } | string;
        };
      };
    };
    if (sim.$kind !== "Transaction") {
      const status = sim?.FailedTransaction?.effects?.status;
      const reason =
        (typeof status === "object" && status?.error
          ? status.error.description ?? status.error.message
          : undefined) ??
        (typeof status === "string" ? status : JSON.stringify(status ?? sim.$kind));
      throw new Error(`stream funding simulate rejected: ${reason}`);
    }

    const startMs = Date.now();

    // Reserve the FULL amount against the rolling limit window (best-effort).
    void recordSend({ userId, amountUsd: totalUsd, asset: "USDsui", digest: null });

    return NextResponse.json({
      bytes: toBase64(bytes),
      mode: "gasless",
      escrowAddress,
      recipient: { address: recipientAddress, displayName: resolved.displayName },
      plan: {
        totalUsd,
        totalMicros: totalMicros.toString(),
        trancheMicros: trancheMicros.toString(),
        trancheUsd: Number(trancheMicros) / 1e6,
        numTranches,
        intervalMs,
        startMs,
      },
    });
  } catch (err) {
    const msg = (err as Error).message ?? "build failed";
    console.warn(`[streams/create-prepare] user=${userId} failed: ${msg}`);
    if (/insufficient|withdraw reservation|accumulator|InsufficientGas/i.test(msg)) {
      return NextResponse.json(
        {
          error:
            "Your USDsui isn't in your Address Balance accumulator yet — funding a stream requires accumulator funds. Top up via Deposit and try again.",
          detail: msg,
          code: "ACCUMULATOR_UNDERFUNDED",
        },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "Couldn't prepare the stream funding. Please try again.", detail: msg },
      { status: 500 }
    );
  }
}
