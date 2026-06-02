import "server-only";

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import { toBase64 } from "@mysten/sui/utils";
import { db, ensureSchema } from "@/lib/db";
import { sui } from "@/lib/sui";
import { USDSUI_TYPE } from "@/lib/usdsui";
import { onara } from "@/lib/onara";
import { getCurrentEpoch, getChainIdentifier } from "@/lib/sui-epoch";
import { getNormalizedTransaction } from "@/lib/sui-shapes";

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

/**
 * The shared `StreamRegistry` object id, when configured. Required (alongside
 * the package id) to build any on-chain stream PTB.
 */
export function streamRegistryId(): string | null {
  return process.env.STREAM_REGISTRY_ID ?? null;
}

/**
 * True when the on-chain `talise::stream` path is fully configured (package +
 * registry ids set AND the worker key is loadable). When this is false the
 * backend falls back to the live escrow + scheduler variant. This is the ONE
 * gate every on-chain branch checks: a half-configured env (package id but no
 * registry, or no worker key) degrades to the escrow path instead of erroring.
 */
export function streamOnchainEnabled(): boolean {
  return (
    !!process.env.STREAM_PACKAGE_ID &&
    !!process.env.STREAM_REGISTRY_ID &&
    !!process.env.STREAM_ESCROW_SK
  );
}

/** Fully-qualified on-chain Stream object type prefix: `${PKG}::stream::Stream<`. */
function streamObjectTypePrefix(pkg: string): string {
  return `${pkg}::stream::Stream<`;
}

/** The shared Sui Clock object id (immutable, network-wide). */
const SUI_CLOCK_ID = "0x6";

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

/**
 * True when a stream id is a real on-chain `Stream<T>` object id (`0x…`) vs a
 * synthetic escrow id (`str_…`). The cron uses this to pick the on-chain
 * release path vs the escrow→recipient transfer path. On-chain object ids are
 * 0x-prefixed 64-hex; escrow ids are `str_<hex>`.
 */
export function isOnchainStreamId(id: string): boolean {
  return /^0x[a-f0-9]{1,64}$/i.test(id);
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

// ════════════════════════════════════════════════════════════════════════
// ON-CHAIN `talise::stream` PATH (gated behind STREAM_PACKAGE_ID).
//
// When the package + registry ids + worker key are all set
// (streamOnchainEnabled()), Talise creates a REAL shared `Stream<USDSUI>`
// object instead of routing funds through the server escrow address. The
// builders below mirror the contract ABI:
//
//   create<T>(registry, funds: Balance<T>, recipient, tranche_amount,
//             num_tranches, start_ms, interval_ms, clock, ctx): ID
//   release<T>(registry, stream, clock, ctx)                 // worker-signed
//   cancel_and_withdraw<T>(stream, ctx): Coin<T>             // sender-signed
//
// FUNDING PATTERN (the crux):
//   • create is a SPONSORED tx — a custom Move call is NOT gasless-eligible
//     (only 0x2::balance::send_funds is). So Onara sponsors gas, the user
//     signs. Mirrors the SPONSORED branch of /api/send/sponsor-prepare:
//     onara().status() for the sponsor address + reference gas price,
//     setSender(user), setGasOwner(sponsor), setGasPrice, build → sponsor-
//     ready bytes the iOS client signs and POSTs to /api/zk/sponsor-execute.
//   • The Balance<USDSUI> `funds` argument comes from the user's Address
//     Balance accumulator via tx.balance({ type, balance }) — the SAME
//     accumulator-withdrawal primitive the gasless branch passes to
//     0x2::balance::send_funds — handed straight as the create() arg.
//   • release is a WORKER-signed Move call that pays its OWN SUI gas (the
//     worker = the STREAM_ESCROW_SK key, funded for gas). Build → worker
//     signTransaction → executeTransaction, mirroring suins-operator.ts.
//   • cancel_and_withdraw is SPONSORED (sender-signed), same shape as create.
// ════════════════════════════════════════════════════════════════════════

/**
 * Build the Onara-SPONSORED `talise::stream::create<USDSUI>` PTB. The user
 * signs; Onara sponsors gas. The `funds` argument is pulled from the user's
 * Address Balance accumulator via `tx.balance(...)` (the same primitive the
 * gasless send rail uses), so no Coin<USDSUI> object is required.
 *
 * Returns sponsor-ready base64 bytes that iOS signs and POSTs to
 * /api/zk/sponsor-execute. Throws on build failure (the caller categorizes).
 *
 * Requires streamOnchainEnabled() upstream (caller gates).
 */
export async function buildStreamCreateSponsored(input: {
  senderAddress: string;
  recipientAddress: string;
  totalMicros: bigint;
  trancheMicros: bigint;
  numTranches: number;
  startMs: number;
  intervalMs: number;
}): Promise<{ bytes: string; sponsor: string }> {
  const pkg = streamPackageId();
  const registry = streamRegistryId();
  if (!pkg || !registry) {
    throw new Error(
      "STREAM_PACKAGE_ID / STREAM_REGISTRY_ID unset — on-chain stream create disabled"
    );
  }

  const onaraClient = onara();
  const client = sui();

  // Sponsor address + reference gas price in parallel (same as sponsor-prepare).
  const [{ address: sponsor }, gasPrice] = await Promise.all([
    onaraClient.status(),
    client.getReferenceGasPrice().then((r) => r.referenceGasPrice),
  ]);

  const tx = new Transaction();
  tx.setSender(input.senderAddress);

  // The Balance<USDSUI> argument — withdrawn from the user's accumulator.
  // This is the SAME accumulator-withdrawal primitive the gasless branch of
  // /api/send/sponsor-prepare passes to 0x2::balance::send_funds; here we pass
  // it straight as the `funds` arg of the create moveCall.
  const funds = tx.balance({ type: USDSUI_TYPE, balance: input.totalMicros });

  tx.moveCall({
    target: `${pkg}::stream::create`,
    typeArguments: [USDSUI_TYPE],
    arguments: [
      tx.object(registry),
      funds,
      tx.pure.address(input.recipientAddress),
      tx.pure.u64(input.trancheMicros),
      tx.pure.u64(BigInt(input.numTranches)),
      tx.pure.u64(BigInt(input.startMs)),
      tx.pure.u64(BigInt(input.intervalMs)),
      tx.object(SUI_CLOCK_ID),
    ],
  });

  // SPONSORED: Onara owns the gas. The user signs the sender slot.
  tx.setGasOwner(sponsor);
  tx.setGasPrice(BigInt(gasPrice));

  const bytes = await tx.build({ client: client as never });
  return { bytes: toBase64(bytes), sponsor };
}

/**
 * Parse the CREATED `Stream<...>` object id out of a confirmed funding tx.
 * The create PTB shares exactly one `${PKG}::stream::Stream<USDSUI>` object;
 * its objectId IS the on-chain stream id we persist as `streams.id`.
 *
 * Reads via `getNormalizedTransaction(digest)` (gRPC, with objectTypes) so we
 * don't depend on the sponsor-execute response carrying objectChanges (it
 * doesn't on the gRPC build). Returns null if no Stream object is found (the
 * caller surfaces a clean error instead of persisting a synthetic id).
 */
export async function parseCreatedStreamObjectId(
  digest: string
): Promise<string | null> {
  const pkg = streamPackageId();
  if (!pkg) return null;
  const prefix = streamObjectTypePrefix(pkg).toLowerCase();

  let tx;
  try {
    tx = await getNormalizedTransaction(digest);
  } catch (err) {
    console.warn(
      `[streams] parseCreatedStreamObjectId getTransaction failed digest=${digest}: ${(err as Error).message}`
    );
    return null;
  }
  if (tx.status !== "success") return null;

  for (const oc of tx.objectChanges) {
    if (oc.kind !== "created") continue;
    const ty = (oc.objectType ?? "").toLowerCase();
    if (ty.startsWith(prefix)) {
      return oc.objectId;
    }
  }
  return null;
}

/**
 * WORKER-signed on-chain tranche release. Builds the
 * `talise::stream::release<USDSUI>(registry, stream, clock, ctx)` PTB, signs
 * it with the worker keypair (the STREAM_ESCROW_SK key — registered on-chain
 * as a stream worker, funded for its OWN SUI gas), and executes it directly.
 *
 * The on-chain `tranches_done` cursor + Clock due-time gate make this
 * idempotent + replay-safe at the contract level: a double-fired release in
 * the same interval aborts (E_TRANCHE_NOT_DUE), so funds can never double-pay
 * even if the DB lease + unique-index guards both fail.
 *
 * Returns `{ ok:false }` (never throws) so the scheduler can reconcile/retry.
 * Mirrors the build → kp.signTransaction → executeTransaction pattern in
 * web/lib/suins-operator.ts:mintSubname and the existing escrow releaseTranche.
 */
export async function releaseTrancheOnChain(
  streamObjectId: string
): Promise<ReleaseResult> {
  const pkg = streamPackageId();
  const registry = streamRegistryId();
  if (!pkg || !registry) {
    return { ok: false, error: "STREAM_PACKAGE_ID / STREAM_REGISTRY_ID unset" };
  }
  if (!streamEscrowEnabled()) {
    return { ok: false, error: "STREAM_ESCROW_SK unset — worker key unavailable" };
  }
  try {
    const kp = escrowKeypair(); // the registered stream worker key
    const worker = kp.getPublicKey().toSuiAddress();
    const client = sui();

    const tx = new Transaction();
    tx.setSender(worker);
    tx.moveCall({
      target: `${pkg}::stream::release`,
      typeArguments: [USDSUI_TYPE],
      arguments: [
        tx.object(registry),
        tx.object(streamObjectId),
        tx.object(SUI_CLOCK_ID),
      ],
    });
    // Worker pays its own SUI gas: let the builder pick the gas coin + budget
    // (no setGasPrice/setGasPayment — this is a normal, gas-paying tx).

    const bytes = await tx.build({ client: client as never });
    const { signature } = await kp.signTransaction(bytes);

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
      | { digest?: string; effects?: { status?: { success?: boolean; error?: unknown } } }
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
 * Read the on-chain `tranches_done` cursor for a `Stream<USDSUI>` object so the
 * scheduler can reconcile the DB cache against chain truth (the contract is the
 * source of truth for how many tranches have actually been released).
 *
 * Returns null on any read failure (the caller falls back to DB state). Pulls
 * the parsed Move struct fields via gRPC `getObject`.
 */
export async function streamTranchesDoneOnChain(
  streamObjectId: string
): Promise<number | null> {
  try {
    const res = (await sui().getObject({
      objectId: streamObjectId,
    } as never)) as unknown as Record<string, unknown>;
    // gRPC getObject returns the parsed object; walk known shapes for the
    // Move struct fields (the SDK surfaces them under contents/json/fields).
    const obj =
      (res.object as Record<string, unknown> | undefined) ?? res;
    const contents =
      (obj.contents as Record<string, unknown> | undefined) ??
      (obj.content as Record<string, unknown> | undefined);
    const fields =
      ((contents?.json ?? contents?.fields) as Record<string, unknown> | undefined) ??
      (obj.json as Record<string, unknown> | undefined);
    const raw = fields?.tranches_done;
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch (err) {
    console.warn(
      `[streams] streamTranchesDoneOnChain failed stream=${streamObjectId}: ${(err as Error).message}`
    );
    return null;
  }
}

/**
 * Build the Onara-SPONSORED `talise::stream::cancel_and_withdraw<USDSUI>` PTB.
 * Sender-signed (the contract asserts ctx.sender() == stream.sender), Onara-
 * sponsored for gas (a custom Move call is not gasless-eligible). The returned
 * `Coin<USDSUI>` remainder is transferred back to the sender in the same PTB.
 *
 * Returns sponsor-ready base64 bytes that iOS signs and POSTs to
 * /api/zk/sponsor-execute. Throws on build failure (the caller categorizes).
 */
export async function buildStreamCancelSponsored(input: {
  senderAddress: string;
  streamObjectId: string;
}): Promise<{ bytes: string; sponsor: string }> {
  const pkg = streamPackageId();
  if (!pkg) {
    throw new Error("STREAM_PACKAGE_ID unset — on-chain stream cancel disabled");
  }

  const onaraClient = onara();
  const client = sui();

  const [{ address: sponsor }, gasPrice] = await Promise.all([
    onaraClient.status(),
    client.getReferenceGasPrice().then((r) => r.referenceGasPrice),
  ]);

  const tx = new Transaction();
  tx.setSender(input.senderAddress);

  // cancel_and_withdraw returns the undistributed remainder as Coin<USDSUI>;
  // route it back to the sender in the same PTB.
  const refund = tx.moveCall({
    target: `${pkg}::stream::cancel_and_withdraw`,
    typeArguments: [USDSUI_TYPE],
    arguments: [tx.object(input.streamObjectId)],
  });
  tx.transferObjects([refund], input.senderAddress);

  tx.setGasOwner(sponsor);
  tx.setGasPrice(BigInt(gasPrice));

  const bytes = await tx.build({ client: client as never });
  return { bytes: toBase64(bytes), sponsor };
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
