import "server-only";

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import { toBase64 } from "@mysten/sui/utils";
import { db, ensureSchema } from "@/lib/db";
import { sui } from "@/lib/sui";
import { USDSUI_TYPE } from "@/lib/usdsui";
import { onara } from "@/lib/onara";
import { getCurrentEpoch, getChainIdentifier } from "@/lib/sui-epoch";

/**
 * Streaming USDsui payments — backend data layer + escrow release engine.
 *
 * This is the ESCROW + SCHEDULER variant of the design
 * (docs/features/streaming-payments.md §2 option (c), made runnable today
 * WITHOUT a published `talise::stream` Move module):
 *
 *   • The sender funds the FULL stream amount ONCE into a Talise-controlled
 *     ESCROW address via the existing transfer pipeline (a plain USDsui
 *     `0x2::balance::send_funds` send — the same builder /api/send/
 *     sponsor-prepare uses). That escrow address is derived from the server
 *     ESCROW keypair (`STREAM_ESCROW_SK`), mirroring the operator-keypair
 *     pattern in web/lib/suins-operator.ts.
 *   • A Vercel cron (`/api/cron/process-streams`) releases each due tranche
 *     by having THIS backend sign an escrow→recipient USDsui transfer with
 *     the server ESCROW keypair. The release is a gasless
 *     `0x2::balance::send_funds<USDSUI>` from the escrow's Address Balance
 *     accumulator when the accumulator is funded (it is, because the sender
 *     just funded it via the same accumulator rail).
 *
 * Degrade-clean: if `STREAM_ESCROW_SK` is unset, `streamEscrowEnabled()` is
 * false, escrow funding is rejected at create time, and the cron no-ops.
 *
 * Future-hardened path: a published `talise::stream` Move module (gated
 * behind `STREAM_PACKAGE_ID`). `streamPackageId()` returns it when set;
 * nothing here depends on it being set, so an unset id never breaks
 * build/runtime. See `move/talise/sources/stream.move` for the source.
 *
 * µUSDsui = BIGINT, 6 decimals.
 */

// ── Escrow keypair (mirror web/lib/suins-operator.ts operator()) ────────
let _escrow: Ed25519Keypair | null = null;

/** True when the server holds an escrow keypair and the feature can run. */
export function streamEscrowEnabled(): boolean {
  return !!process.env.STREAM_ESCROW_SK;
}

/**
 * The published `talise::stream` package id, when configured. The escrow +
 * scheduler variant does NOT need it — it is the seam for the future
 * on-chain `Stream` object path. Returns null (feature gated off) when unset
 * so an absent id never breaks anything.
 */
export function streamPackageId(): string | null {
  return process.env.STREAM_PACKAGE_ID ?? null;
}

/** Load the server escrow Ed25519 keypair. Throws when `STREAM_ESCROW_SK` unset. */
function escrowKeypair(): Ed25519Keypair {
  if (_escrow) return _escrow;
  const k = process.env.STREAM_ESCROW_SK;
  if (!k) {
    throw new Error(
      "STREAM_ESCROW_SK missing — the Talise-controlled escrow keypair that holds streamed funds"
    );
  }
  _escrow = Ed25519Keypair.fromSecretKey(k);
  return _escrow;
}

/** The escrow's Sui address — the funding destination for every stream. */
export function streamEscrowAddress(): string {
  return escrowKeypair().getPublicKey().toSuiAddress();
}

// ── Schema (self-bootstrapping, memoized once-per-process) ──────────────
// Mirrors web/lib/send-limits.ts ensureLedgerSchema discipline: a
// once-per-process promise that resets on failure so a transient error
// retries. Postgres DDL (SERIAL / BIGINT / TEXT / partial + unique index /
// ON CONFLICT). Schema per the design (§5).
let _schemaReadyP: Promise<void> | null = null;

export function ensureStreamsSchema(): Promise<void> {
  if (_schemaReadyP) return _schemaReadyP;
  _schemaReadyP = (async () => {
    await ensureSchema();
    const c = db();
    // One row per stream. The escrow holds the undistributed funds; this
    // row is the scheduler index + UI cache. `id` is the stream id — the
    // on-chain Stream object id when STREAM_PACKAGE_ID is live, otherwise a
    // server-generated "str_<hex>" id for the escrow variant.
    await c.execute(
      `CREATE TABLE IF NOT EXISTS streams (
        id                  TEXT PRIMARY KEY,
        sender_user_id      INTEGER NOT NULL,
        sender_address      TEXT NOT NULL,
        recipient_address   TEXT NOT NULL,
        recipient_handle    TEXT,
        total_micros        BIGINT NOT NULL,
        tranche_micros      BIGINT NOT NULL,
        num_tranches        BIGINT NOT NULL,
        tranches_done       BIGINT NOT NULL DEFAULT 0,
        released_micros     BIGINT NOT NULL DEFAULT 0,
        start_ms            BIGINT NOT NULL,
        interval_ms         BIGINT NOT NULL,
        next_tranche_at     BIGINT NOT NULL,
        state               TEXT NOT NULL DEFAULT 'active',
        funding_digest      TEXT NOT NULL,
        last_tranche_digest TEXT,
        last_tranche_at     BIGINT,
        attempt_count       INTEGER NOT NULL DEFAULT 0,
        lease_until         BIGINT,
        lease_owner         TEXT,
        created_at          BIGINT NOT NULL,
        updated_at          BIGINT NOT NULL
      )`
    );
    // Hot scheduler read: active streams with a tranche due now.
    await c.execute(
      `CREATE INDEX IF NOT EXISTS idx_streams_due
         ON streams (next_tranche_at)
         WHERE state = 'active'`
    );
    await c.execute(
      `CREATE INDEX IF NOT EXISTS idx_streams_sender
         ON streams (sender_user_id, created_at DESC)`
    );
    await c.execute(
      `CREATE INDEX IF NOT EXISTS idx_streams_recipient
         ON streams (recipient_address, created_at DESC)`
    );
    // Append-only per-tranche ledger. The unique index is the DB-side
    // idempotency guard (a retried success-write is a no-op via ON CONFLICT).
    await c.execute(
      `CREATE TABLE IF NOT EXISTS stream_tranches (
        id            SERIAL PRIMARY KEY,
        stream_id     TEXT NOT NULL,
        tranche_index BIGINT NOT NULL,
        amount_micros BIGINT NOT NULL,
        tx_digest     TEXT,
        paid_at       BIGINT NOT NULL
      )`
    );
    await c.execute(
      `CREATE UNIQUE INDEX IF NOT EXISTS uniq_stream_tranche
         ON stream_tranches (stream_id, tranche_index)`
    );
  })().catch((err) => {
    _schemaReadyP = null;
    throw err;
  });
  return _schemaReadyP;
}

// ── Types ───────────────────────────────────────────────────────────────
export type StreamState =
  | "active"
  | "paused"
  | "completed"
  | "cancelled"
  | "stalled";

export interface StreamRow {
  id: string;
  sender_user_id: number;
  sender_address: string;
  recipient_address: string;
  recipient_handle: string | null;
  total_micros: number;
  tranche_micros: number;
  num_tranches: number;
  tranches_done: number;
  released_micros: number;
  start_ms: number;
  interval_ms: number;
  next_tranche_at: number;
  state: StreamState;
  funding_digest: string;
  last_tranche_digest: string | null;
  last_tranche_at: number | null;
  attempt_count: number;
  lease_until: number | null;
  lease_owner: string | null;
  created_at: number;
  updated_at: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** Generate a server-side stream id for the escrow variant (no on-chain object). */
export function newStreamId(): string {
  return `str_${randomHex(24)}`;
}

function randomHex(bytes: number): string {
  // crypto.randomBytes via Web Crypto (available on the Node/Vercel runtime).
  const arr = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Insert a new stream row. State starts `active`; the FIRST tranche fires at
 * `start_ms` so `next_tranche_at = start_ms` (tranches_done = 0).
 */
export async function createStreamRecord(input: {
  id: string;
  senderUserId: number;
  senderAddress: string;
  recipientAddress: string;
  recipientHandle: string | null;
  totalMicros: bigint;
  trancheMicros: bigint;
  numTranches: number;
  startMs: number;
  intervalMs: number;
  fundingDigest: string;
}): Promise<void> {
  await ensureStreamsSchema();
  const now = Date.now();
  await db().execute({
    sql: `INSERT INTO streams
            (id, sender_user_id, sender_address, recipient_address,
             recipient_handle, total_micros, tranche_micros, num_tranches,
             tranches_done, released_micros, start_ms, interval_ms,
             next_tranche_at, state, funding_digest, attempt_count,
             created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, 'active', ?, 0, ?, ?)
          ON CONFLICT (id) DO NOTHING`,
    args: [
      input.id,
      input.senderUserId,
      input.senderAddress,
      input.recipientAddress,
      input.recipientHandle,
      input.totalMicros.toString(),
      input.trancheMicros.toString(),
      input.numTranches,
      input.startMs,
      input.intervalMs,
      input.startMs,
      input.fundingDigest,
      now,
      now,
    ],
  });
}

/** A single stream by id (any state). */
export async function streamById(id: string): Promise<StreamRow | null> {
  await ensureStreamsSchema();
  const r = await db().execute({
    sql: "SELECT * FROM streams WHERE id = ? LIMIT 1",
    args: [id],
  });
  return (r.rows[0] as unknown as StreamRow) ?? null;
}

/** All streams where the user is the SENDER, or the recipient matches their address. */
export async function streamsForUser(
  userId: number,
  recipientAddress: string
): Promise<StreamRow[]> {
  await ensureStreamsSchema();
  const r = await db().execute({
    sql: `SELECT * FROM streams
           WHERE sender_user_id = ? OR LOWER(recipient_address) = LOWER(?)
           ORDER BY created_at DESC
           LIMIT 200`,
    args: [userId, recipientAddress],
  });
  return r.rows as unknown as StreamRow[];
}

/**
 * Active streams whose next tranche is due at/before `now` and which are not
 * currently lease-locked. Hot scheduler read (idx_streams_due).
 */
export async function dueStreams(now: number, limit: number): Promise<StreamRow[]> {
  await ensureStreamsSchema();
  const r = await db().execute({
    sql: `SELECT * FROM streams
           WHERE state = 'active'
             AND next_tranche_at <= ?
             AND (lease_until IS NULL OR lease_until < ?)
           ORDER BY next_tranche_at ASC
           LIMIT ?`,
    args: [now, now, limit],
  });
  return r.rows as unknown as StreamRow[];
}

/**
 * Claim a short DB lease on a stream so two overlapping cron invocations
 * can't both release the same tranche. Returns true iff THIS run won the row.
 * Atomic guard predicate (no separate read), mirroring app-attest's
 * consumeAttestChallenge.
 */
export async function leaseStream(
  id: string,
  runId: string,
  now: number,
  ttlMs = 30_000
): Promise<boolean> {
  await ensureStreamsSchema();
  const r = await db().execute({
    sql: `UPDATE streams
             SET lease_until = ?, lease_owner = ?, updated_at = ?
           WHERE id = ?
             AND state = 'active'
             AND (lease_until IS NULL OR lease_until < ?)
           RETURNING id`,
    args: [now + ttlMs, runId, now, id, now],
  });
  return r.rows.length > 0;
}

/** Release a stream's lease (no-op if not held). */
export async function clearStreamLease(id: string): Promise<void> {
  await db().execute({
    sql: `UPDATE streams SET lease_until = NULL, lease_owner = NULL, updated_at = ? WHERE id = ?`,
    args: [Date.now(), id],
  });
}

/**
 * Record a paid tranche: append the (idempotent) ledger row AND advance the
 * stream cursor. The unique index on (stream_id, tranche_index) makes the
 * ledger insert a no-op on a retried success-write.
 *
 * `trancheIndex` is 1-based (== tranches_done after this pay).
 */
export async function recordTranche(input: {
  streamId: string;
  trancheIndex: number;
  amountMicros: bigint;
  txDigest: string | null;
  numTranches: number;
  releasedMicros: bigint;
  startMs: number;
  intervalMs: number;
}): Promise<void> {
  await ensureStreamsSchema();
  const now = Date.now();
  // Idempotent ledger row.
  await db().execute({
    sql: `INSERT INTO stream_tranches
            (stream_id, tranche_index, amount_micros, tx_digest, paid_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (stream_id, tranche_index) DO NOTHING`,
    args: [
      input.streamId,
      input.trancheIndex,
      input.amountMicros.toString(),
      input.txDigest,
      now,
    ],
  });
  const done = input.trancheIndex >= input.numTranches;
  // The on-chain/escrow cursor advances exactly one tranche. next_tranche_at
  // follows the ORIGINAL schedule: start_ms + tranches_done*interval_ms.
  const nextAt = input.startMs + input.trancheIndex * input.intervalMs;
  await db().execute({
    sql: `UPDATE streams
             SET tranches_done = ?,
                 released_micros = ?,
                 next_tranche_at = ?,
                 last_tranche_digest = ?,
                 last_tranche_at = ?,
                 state = ?,
                 attempt_count = 0,
                 lease_until = NULL,
                 lease_owner = NULL,
                 updated_at = ?
           WHERE id = ?`,
    args: [
      input.trancheIndex,
      input.releasedMicros.toString(),
      nextAt,
      input.txDigest,
      now,
      done ? "completed" : "active",
      now,
      input.streamId,
    ],
  });
}

/** Flip a stream's state (pause/resume/cancel/stalled). */
export async function setStreamState(id: string, state: StreamState): Promise<void> {
  await ensureStreamsSchema();
  await db().execute({
    sql: `UPDATE streams SET state = ?, lease_until = NULL, lease_owner = NULL, updated_at = ? WHERE id = ?`,
    args: [state, Date.now(), id],
  });
}

/**
 * Bump a stream's attempt_count after a transient failure. When it crosses
 * `maxAttempts`, mark the stream `stalled` (so a permanently-broken stream
 * surfaces instead of silently looping) and return true.
 */
export async function bumpAttemptOrStall(
  id: string,
  maxAttempts = 6
): Promise<{ stalled: boolean }> {
  await ensureStreamsSchema();
  const now = Date.now();
  const r = await db().execute({
    sql: `UPDATE streams
             SET attempt_count = attempt_count + 1,
                 lease_until = NULL,
                 lease_owner = NULL,
                 updated_at = ?
           WHERE id = ?
           RETURNING attempt_count`,
    args: [now, id],
  });
  const attempts = Number((r.rows[0] as { attempt_count?: number } | undefined)?.attempt_count ?? 0);
  if (attempts >= maxAttempts) {
    await setStreamState(id, "stalled");
    return { stalled: true };
  }
  return { stalled: false };
}

// ── Gasless escrow→recipient release builder + executor ─────────────────

export interface ReleaseResult {
  ok: boolean;
  digest?: string;
  error?: string;
}

/**
 * Build + sign + execute ONE escrow→recipient USDsui tranche release.
 *
 * Gasless `0x2::balance::send_funds<USDSUI>` from the escrow's Address
 * Balance accumulator — the SAME shape the gasless branch of
 * /api/send/sponsor-prepare uses (gasPrice=0, gasBudget=0, setGasPayment([]),
 * a ValidDuring expiration for the current+next epoch). The escrow keypair
 * signs the tx (it is the `sender`), so no zkLogin/epoch problem: the escrow
 * key is an Ed25519 key that never expires.
 *
 * Returns `{ ok:false }` (never throws) so the scheduler can reconcile/retry.
 */
export async function releaseTranche(input: {
  recipientAddress: string;
  amountMicros: bigint;
}): Promise<ReleaseResult> {
  if (!streamEscrowEnabled()) {
    return { ok: false, error: "STREAM_ESCROW_SK unset — escrow disabled" };
  }
  if (input.amountMicros <= 0n) {
    return { ok: false, error: "non-positive tranche amount" };
  }
  try {
    const kp = escrowKeypair();
    const from = kp.getPublicKey().toSuiAddress();
    const client = sui();

    const tx = new Transaction();
    tx.setSender(from);
    tx.moveCall({
      target: "0x2::balance::send_funds",
      typeArguments: [USDSUI_TYPE],
      arguments: [
        tx.balance({ type: USDSUI_TYPE, balance: input.amountMicros }),
        tx.pure.address(input.recipientAddress),
      ],
    });
    // Gasless gate: both price and budget must be explicitly 0.
    tx.setGasPrice(0n);
    tx.setGasBudget(0n);

    // ValidDuring escape hatch — an accumulator-only PTB has no address-owned
    // input, so this is mandatory (same as sponsor-prepare's gasless branch).
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
    // Load-bearing: empty gas payment makes tx.build() serialize the PTB
    // offline (skips the resolve-time simulate that rejects ValidDuring).
    tx.setGasPayment([]);

    const bytes = await tx.build({ client: client as never });
    const { signature } = await kp.signTransaction(bytes);

    // gRPC executeTransaction returns a discriminated union; request effects
    // to check status (mirror web/lib/suins-operator.ts:mintSubname).
    const result = (await client.executeTransaction({
      transaction: bytes,
      signatures: [signature],
      include: { effects: true },
    } as never)) as Record<string, unknown>;

    if ((result.$kind as string | undefined) === "FailedTransaction") {
      const failed = result.FailedTransaction as
        | { digest?: string; effects?: { status?: { error?: unknown } } }
        | undefined;
      return { ok: false, error: extractStatusError(failed?.effects?.status) };
    }

    const txInner = result.Transaction as
      | {
          digest?: string;
          effects?: { status?: { success?: boolean; error?: unknown } };
        }
      | undefined;
    if (txInner?.effects?.status && txInner.effects.status.success === false) {
      return { ok: false, error: extractStatusError(txInner.effects.status) };
    }
    return { ok: true, digest: txInner?.digest ?? "" };
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? String(err) };
  }
}

/**
 * Refund the undistributed remainder of a stream from the escrow back to the
 * sender (cancel path). The remainder = total - released; an escrow→sender
 * gasless USDsui transfer, same builder as releaseTranche. Returns
 * `{ ok:false }` (never throws) when there's nothing to refund or the
 * transfer fails — the cancel still proceeds (the row is marked cancelled).
 */
export async function refundRemainder(input: {
  senderAddress: string;
  remainderMicros: bigint;
}): Promise<ReleaseResult> {
  if (input.remainderMicros <= 0n) {
    // Nothing left to refund (e.g. a fully-released stream) — treat as ok.
    return { ok: true };
  }
  return releaseTranche({
    recipientAddress: input.senderAddress,
    amountMicros: input.remainderMicros,
  });
}

function extractStatusError(status: unknown): string {
  if (typeof status === "string") return status;
  if (status && typeof status === "object" && "error" in status) {
    const err = (status as { error?: unknown }).error;
    if (typeof err === "string") return err;
    if (err && typeof err === "object") {
      const e = err as { description?: string; message?: string };
      return e.description ?? e.message ?? "unknown failure";
    }
  }
  return "unknown failure";
}

// ── Sponsored stream-funding builder (Onara fallback) ───────────────────

/**
 * Build the Onara-SPONSORED funding PTB that moves the FULL stream amount
 * (`totalMicros` µUSDsui) from the SENDER into the escrow address. This is the
 * FALLBACK to the gasless `0x2::balance::send_funds` builder in
 * /api/streams/create-prepare — used when the sender's USDsui lives in
 * `Coin<USDSUI>` objects (not their accumulator), so the gasless rail can't
 * source it.
 *
 * Mirrors the sponsored branch of /api/send/sponsor-prepare EXACTLY:
 *   • resolve the Onara sponsor address + reference gas price in parallel,
 *   • source the funds via `coinWithBalance({ type: USDSUI_TYPE, useGasCoin:false })`
 *     (this is what CAN pull from Coin<USDSUI> objects),
 *   • `transferObjects([coin], escrowAddress)`,
 *   • `setGasOwner(sponsor)` + `setGasPrice(gasPrice)`,
 *   • `tx.build({ client })` → sponsor-ready bytes the sender signs.
 *
 * Returns the base64 sponsor-ready bytes. Throws on build failure (the caller
 * surfaces the categorized error). Requires `ONARA_URL`/escrow to be set;
 * the caller gates `streamEscrowEnabled()` upstream.
 */
export async function buildSponsoredStreamFunding(input: {
  senderAddress: string;
  totalMicros: bigint;
}): Promise<{ bytes: string; escrowAddress: string; sponsor: string }> {
  const escrowAddress = streamEscrowAddress();
  const onaraClient = onara();
  const client = sui();

  // Sponsor address + reference gas price in parallel (same as sponsor-prepare).
  const [{ address: sponsor }, gasPrice] = await Promise.all([
    onaraClient.status(),
    client.getReferenceGasPrice().then((r) => r.referenceGasPrice),
  ]);

  const tx = new Transaction();
  tx.setSender(input.senderAddress);

  // Payment Kit isn't wired into the stream funding flow; a plain
  // coinWithBalance → transferObjects to the escrow is the sponsored
  // equivalent of the SUI branch of sponsor-prepare. `useGasCoin:false`
  // keeps the sponsor's gas coin out of the funds-sourcing.
  const out = tx.add(
    coinWithBalance({
      type: USDSUI_TYPE,
      balance: input.totalMicros,
      useGasCoin: false,
    })
  );
  tx.transferObjects([out], escrowAddress);

  tx.setGasOwner(sponsor);
  tx.setGasPrice(BigInt(gasPrice));

  const bytes = await tx.build({ client: client as never });
  return { bytes: toBase64(bytes), escrowAddress, sponsor };
}

// ── Read-side projection helpers (for the list / status routes) ─────────

const MICROS = 1_000_000;

/** Project a stored row into the UI-facing status shape with USD figures. */
export function projectStream(row: StreamRow) {
  const total = Number(row.total_micros) / MICROS;
  const released = Number(row.released_micros) / MICROS;
  return {
    id: row.id,
    senderAddress: row.sender_address,
    recipientAddress: row.recipient_address,
    recipientHandle: row.recipient_handle,
    totalUsd: total,
    releasedUsd: released,
    remainingUsd: Math.max(0, total - released),
    trancheUsd: Number(row.tranche_micros) / MICROS,
    numTranches: Number(row.num_tranches),
    tranchesDone: Number(row.tranches_done),
    startMs: Number(row.start_ms),
    intervalMs: Number(row.interval_ms),
    nextTrancheAt: Number(row.next_tranche_at),
    state: row.state,
    fundingDigest: row.funding_digest,
    lastTrancheDigest: row.last_tranche_digest,
    lastTrancheAt: row.last_tranche_at,
    createdAt: row.created_at,
  };
}

/** Base64 of unsigned PTB bytes (for create-prepare to return to iOS). */
export function bytesToB64(bytes: Uint8Array): string {
  return toBase64(bytes);
}
