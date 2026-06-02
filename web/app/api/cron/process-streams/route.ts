import { NextResponse } from "next/server";
import {
  dueStreams,
  leaseStream,
  clearStreamLease,
  recordTranche,
  bumpAttemptOrStall,
  releaseTranche,
  releaseTrancheOnChain,
  streamTranchesDoneOnChain,
  isOnchainStreamId,
  streamEscrowEnabled,
  type StreamRow,
  type ReleaseResult,
} from "@/lib/streams";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/process-streams — THE STREAM SCHEDULER.
 *
 * Vercel cron (every minute; see web/vercel.json). For each active stream
 * whose next tranche is due, release ONE tranche:
 *
 *   • ON-CHAIN stream (id is a real Stream<USDSUI> object id, 0x…): release
 *     by signing a worker `stream::release<USDSUI>` Move call with the worker
 *     keypair (web/lib/streams.ts:releaseTrancheOnChain). The DB cache is
 *     reconciled against the on-chain `tranches_done` cursor before AND after
 *     the release — the contract is the source of truth.
 *   • ESCROW stream (id is `str_…`): release by signing an escrow→recipient
 *     gasless USDsui transfer with the server escrow keypair
 *     (web/lib/streams.ts:releaseTranche).
 *
 * Hardening / idempotency (design §4.5) — three layers:
 *   1. Bearer CRON_SECRET gate (this is a money-moving loop; a random GET
 *      must not trigger it). Vercel sets `Authorization: Bearer ${CRON_SECRET}`
 *      when the env is configured. 401 otherwise.
 *   2. Per-stream DB lease (leaseStream): two overlapping cron invocations
 *      can't both grab the same stream.
 *   3. Unique stream_tranches(stream_id, tranche_index) index, ON CONFLICT
 *      DO NOTHING (recordTranche): a retried success-write is a no-op, and a
 *      double-fire can't double-count the ledger.
 *
 * One tranche per stream per tick (keeps each tx tiny + the loop fast); a
 * backlog after an outage drains over subsequent ticks. The next_tranche_at
 * cursor advances on the ORIGINAL schedule so we never release ahead of time.
 *
 * Transient failures bump attempt_count; after K fails the stream is marked
 * `stalled` (surfaces a permanently-broken stream instead of silent looping).
 *
 * Degrades cleanly: if STREAM_ESCROW_SK is unset, the route no-ops (200 with
 * disabled:true) — no releases, no error.
 */

const BATCH_LIMIT = 25; // streams considered per tick
const MAX_ATTEMPTS = 6; // transient-failure bound before 'stalled'

export async function GET(req: Request) {
  // ── Bearer CRON_SECRET gate ───────────────────────────────────────────
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  if (!streamEscrowEnabled()) {
    // No escrow keypair — feature off. No-op cleanly.
    return NextResponse.json({ ok: true, disabled: true, processed: 0 });
  }

  const runId = `run_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
  const now = Date.now();

  let due: StreamRow[];
  try {
    due = await dueStreams(now, BATCH_LIMIT);
  } catch (err) {
    console.error(`[cron/process-streams] dueStreams failed: ${(err as Error).message}`);
    return NextResponse.json({ error: "scheduler read failed" }, { status: 500 });
  }

  let released = 0;
  let stalled = 0;
  let skipped = 0;
  const errors: Array<{ id: string; error: string }> = [];

  for (const stream of due) {
    // a. Claim the lease. 0 rows → another run has it; skip.
    let won = false;
    try {
      won = await leaseStream(stream.id, runId, now);
    } catch {
      won = false;
    }
    if (!won) {
      skipped++;
      continue;
    }

    const onchain = isOnchainStreamId(stream.id);
    const numTranches = Number(stream.num_tranches);

    // For an on-chain stream the CONTRACT's tranches_done cursor is the source
    // of truth (release() advances it atomically + the Clock gate prevents
    // early/double release). Reconcile the DB cache against chain BEFORE
    // deciding the next index, so a tranche another instance/safety-valve
    // already released isn't re-attempted.
    let tranchesDone = Number(stream.tranches_done);
    if (onchain) {
      const chainDone = await streamTranchesDoneOnChain(stream.id);
      if (chainDone != null && chainDone > tranchesDone) {
        // Chain is ahead of the DB cache — record the missing tranche(s) so the
        // cursor + ledger catch up. recordTranche is ON CONFLICT-safe.
        try {
          const trancheMicros = BigInt(stream.tranche_micros);
          const totalMicros = BigInt(stream.total_micros);
          for (let i = tranchesDone + 1; i <= chainDone && i <= numTranches; i++) {
            const isLastReconcile = i === numTranches;
            const reconciledReleased = isLastReconcile
              ? totalMicros
              : trancheMicros * BigInt(i);
            const amt = isLastReconcile
              ? totalMicros - trancheMicros * BigInt(i - 1)
              : trancheMicros;
            await recordTranche({
              streamId: stream.id,
              trancheIndex: i,
              amountMicros: amt,
              txDigest: null,
              numTranches,
              releasedMicros: reconciledReleased,
              startMs: Number(stream.start_ms),
              intervalMs: Number(stream.interval_ms),
            });
          }
          tranchesDone = Math.min(chainDone, numTranches);
        } catch (err) {
          // Reconcile is best-effort; the release path below still uses the
          // chain-truth cursor so we never double-release.
          console.warn(
            `[cron/process-streams] reconcile failed stream=${stream.id}: ${(err as Error).message}`
          );
          tranchesDone = Math.min(chainDone, numTranches);
        }
      }
    }

    // The next tranche is 0-indexed = tranches_done; 1-based index = +1.
    const trancheIndex = tranchesDone + 1;
    if (trancheIndex > numTranches) {
      // Already complete — reconcile and release the lease.
      await clearStreamLease(stream.id);
      skipped++;
      continue;
    }

    // Last tranche pays the remainder so sum == total exactly (no drift).
    // `releasedMicros` follows the (possibly reconciled) cursor rather than the
    // stale DB column: tranches_done * tranche_micros for fixed tranches. This
    // keeps the post-release recordTranche bookkeeping consistent even when an
    // on-chain reconcile advanced `tranchesDone` above the cached value.
    const totalMicros = BigInt(stream.total_micros);
    const trancheMicros = BigInt(stream.tranche_micros);
    const releasedMicros =
      tranchesDone === Number(stream.tranches_done)
        ? BigInt(stream.released_micros)
        : trancheMicros * BigInt(tranchesDone);
    const isLast = trancheIndex === numTranches;
    const amountMicros = isLast ? totalMicros - releasedMicros : trancheMicros;

    if (amountMicros <= 0n) {
      await clearStreamLease(stream.id);
      skipped++;
      continue;
    }

    // b. Sign + execute the release. On-chain: worker-signed stream::release
    // (the contract splits the tranche from the Stream escrow + transfers to
    // the recipient, advancing tranches_done atomically). Escrow: escrow→
    // recipient gasless USDsui transfer.
    const res: ReleaseResult = onchain
      ? await releaseTrancheOnChain(stream.id)
      : await releaseTranche({
          recipientAddress: stream.recipient_address,
          amountMicros,
        });

    if (res.ok) {
      // c. Advance cursor + append idempotent ledger row.
      try {
        await recordTranche({
          streamId: stream.id,
          trancheIndex,
          amountMicros,
          txDigest: res.digest ?? null,
          numTranches,
          releasedMicros: releasedMicros + amountMicros,
          startMs: Number(stream.start_ms),
          intervalMs: Number(stream.interval_ms),
        });
        released++;
      } catch (err) {
        // The funds DID move; a failed bookkeeping write only desyncs the
        // cache. Clear the lease so the next tick reconciles (the on-chain
        // transfer already happened; recordTranche is ON CONFLICT-safe).
        await clearStreamLease(stream.id);
        errors.push({ id: stream.id, error: `record failed: ${(err as Error).message}` });
      }
    } else {
      // e. Transient failure — bump attempt_count; stall after K fails.
      const { stalled: didStall } = await bumpAttemptOrStall(stream.id, MAX_ATTEMPTS);
      if (didStall) stalled++;
      errors.push({ id: stream.id, error: res.error ?? "release failed" });
      console.warn(
        `[cron/process-streams] release failed stream=${stream.id} tranche=${trancheIndex}: ${res.error}`
      );
    }
  }

  return NextResponse.json({
    ok: true,
    runId,
    considered: due.length,
    released,
    stalled,
    skipped,
    errors: errors.length ? errors : undefined,
  });
}
