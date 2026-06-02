/// Streaming USDsui payments — on-chain escrow + worker-signed release.
///
/// FUTURE-HARDENED PATH. This module is the documented on-chain mechanism
/// from docs/features/streaming-payments.md §3. It is NOT yet published to
/// mainnet, and the shipped Talise backend does NOT depend on it: the live
/// feature runs the "escrow address + backend scheduler" variant (option (c)
/// made runnable today — a Talise-controlled escrow keypair holds funds and a
/// Vercel cron signs each escrow→recipient transfer). When this module is
/// published, set `STREAM_PACKAGE_ID` in the web env and the backend's
/// `streamPackageId()` seam lights up the on-chain path; until then nothing
/// references it.
///
/// Modeled 1:1 on the audited `talise::vault` + `talise::auto_swap` role/cap
/// pattern: a shared `StreamRegistry` holds the worker address list; each
/// active stream is a short-lived shared `Stream` object holding the
/// undistributed funds as `Balance<USDSUI>`; the Onara worker (an Ed25519 key
/// that never expires) signs `release` per tranche, gated on-chain by the
/// `tranches_done` cursor + a `Clock` due-time check so a double-fire can
/// never double-pay. The sender signs exactly once (funding) and keeps
/// pause/resume/cancel.
module talise::stream;

use sui::balance::{Self, Balance};
use sui::clock::Clock;
use sui::coin::{Self, Coin};
use sui::event;

/// The USDsui coin type. Published value lives in the usdsui package; the
/// backend hardcodes the same type string in web/lib/usdsui.ts.
use usdsui::usdsui::USDSUI;

// ───────────────────────────────────────────────────────────────────
// Errors

const E_ZERO_AMOUNT: u64 = 200;
const E_BAD_SCHEDULE: u64 = 201;
const E_NOT_WORKER: u64 = 202;
const E_REGISTRY_PAUSED: u64 = 203;
const E_PAUSED: u64 = 204;
const E_CANCELLED: u64 = 205;
const E_STREAM_COMPLETE: u64 = 206;
const E_TRANCHE_NOT_DUE: u64 = 207;
const E_NOT_SENDER: u64 = 208;

// ───────────────────────────────────────────────────────────────────
// Objects

/// Singleton shared registry. Mirrors auto_swap's role model. Created once
/// at bootstrap; `worker_addresses` holds the Onara worker key(s).
public struct StreamRegistry has key {
    id: UID,
    admin: address,
    worker_addresses: vector<address>,
    paused: bool,
    streams_total: u64,
}

/// AdminCap minted to the publisher at bootstrap (governance).
public struct StreamAdminCap has key, store { id: UID }

/// One shared object per active stream. Holds undistributed funds as a
/// `Balance<USDSUI>` so the worker-signed release PTB can split it.
public struct Stream has key {
    id: UID,
    sender: address,
    recipient: address,
    escrow: Balance<USDSUI>,
    total_amount: u64,
    released_amount: u64,
    tranche_amount: u64,
    num_tranches: u64,
    tranches_done: u64,
    start_ms: u64,
    interval_ms: u64,
    paused: bool,
    cancelled: bool,
}

// ───────────────────────────────────────────────────────────────────
// Events

public struct StreamCreated has copy, drop {
    stream_id: ID,
    sender: address,
    recipient: address,
    total: u64,
    tranche_amount: u64,
    num_tranches: u64,
    start_ms: u64,
    interval_ms: u64,
}

public struct TranchePaid has copy, drop {
    stream_id: ID,
    recipient: address,
    amount: u64,
    tranche_index: u64,
    ts_ms: u64,
}

public struct StreamCancelled has copy, drop {
    stream_id: ID,
    refunded: u64,
    released: u64,
}

public struct StreamPaused has copy, drop { stream_id: ID }
public struct StreamResumed has copy, drop { stream_id: ID }

// ───────────────────────────────────────────────────────────────────
// Bootstrap

fun init(ctx: &mut TxContext) {
    let registry = StreamRegistry {
        id: object::new(ctx),
        admin: ctx.sender(),
        worker_addresses: vector::empty<address>(),
        paused: false,
        streams_total: 0,
    };
    transfer::share_object(registry);
    transfer::public_transfer(StreamAdminCap { id: object::new(ctx) }, ctx.sender());
}

/// Admin: grant a worker address permission to call `release`.
public fun add_worker(
    _cap: &StreamAdminCap,
    registry: &mut StreamRegistry,
    worker: address,
) {
    if (!vector::contains(&registry.worker_addresses, &worker)) {
        vector::push_back(&mut registry.worker_addresses, worker);
    };
}

/// Admin: global kill switch (halts ALL releases).
public fun set_paused(_cap: &StreamAdminCap, registry: &mut StreamRegistry, paused: bool) {
    registry.paused = paused;
}

// ───────────────────────────────────────────────────────────────────
// Funding (sender-signed, once)

/// Called inside the sender's ONE zkLogin-signed funding PTB. The PTB
/// upstream withdraws `Balance<USDSUI>` from the sender's accumulator and
/// hands it here. Creates the shared Stream object and emits StreamCreated.
public fun create(
    registry: &mut StreamRegistry,
    funds: Balance<USDSUI>,
    recipient: address,
    tranche_amount: u64,
    num_tranches: u64,
    start_ms: u64,
    interval_ms: u64,
    _clock: &Clock,
    ctx: &mut TxContext,
): ID {
    let total = balance::value(&funds);
    assert!(total > 0, E_ZERO_AMOUNT);
    assert!(num_tranches > 0, E_BAD_SCHEDULE);
    assert!(tranche_amount > 0, E_BAD_SCHEDULE);
    assert!(interval_ms > 0, E_BAD_SCHEDULE);
    // tranche_amount * (num_tranches - 1) must be <= total; the final tranche
    // is the remainder so $X/N rounding can never over- or under-release.
    assert!(tranche_amount * (num_tranches - 1) <= total, E_BAD_SCHEDULE);

    let stream = Stream {
        id: object::new(ctx),
        sender: ctx.sender(),
        recipient,
        escrow: funds,
        total_amount: total,
        released_amount: 0,
        tranche_amount,
        num_tranches,
        tranches_done: 0,
        start_ms,
        interval_ms,
        paused: false,
        cancelled: false,
    };
    let sid = object::id(&stream);
    registry.streams_total = registry.streams_total + 1;
    event::emit(StreamCreated {
        stream_id: sid,
        sender: ctx.sender(),
        recipient,
        total,
        tranche_amount,
        num_tranches,
        start_ms,
        interval_ms,
    });
    transfer::share_object(stream);
    sid
}

// ───────────────────────────────────────────────────────────────────
// Release (worker-signed, per tranche)

/// Worker-signed. Releases ONE tranche if (a) the clock has passed the due
/// time for the next tranche, (b) the stream isn't paused/cancelled, (c) the
/// registry isn't paused, (d) sender is a registered worker. The on-chain
/// `tranches_done` cursor + clock gate make this idempotent and replay-safe:
/// calling release twice in the same interval reverts (E_TRANCHE_NOT_DUE), so
/// a double-fired cron can NEVER double-pay.
public fun release(
    registry: &mut StreamRegistry,
    stream: &mut Stream,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(!registry.paused, E_REGISTRY_PAUSED);
    assert!(vector::contains(&registry.worker_addresses, &ctx.sender()), E_NOT_WORKER);
    assert!(!stream.cancelled, E_CANCELLED);
    assert!(!stream.paused, E_PAUSED);
    assert!(stream.tranches_done < stream.num_tranches, E_STREAM_COMPLETE);

    let due_at = stream.start_ms + stream.tranches_done * stream.interval_ms;
    assert!(clock.timestamp_ms() >= due_at, E_TRANCHE_NOT_DUE);

    // Last tranche pays the remainder so total released == total_amount.
    let is_last = stream.tranches_done + 1 == stream.num_tranches;
    let amount = if (is_last) { balance::value(&stream.escrow) } else { stream.tranche_amount };

    let out = balance::split(&mut stream.escrow, amount);
    stream.released_amount = stream.released_amount + amount;
    stream.tranches_done = stream.tranches_done + 1;

    let coin_out = coin::from_balance(out, ctx);
    transfer::public_transfer(coin_out, stream.recipient);

    event::emit(TranchePaid {
        stream_id: object::id(stream),
        recipient: stream.recipient,
        amount,
        tranche_index: stream.tranches_done,
        ts_ms: clock.timestamp_ms(),
    });
}

/// Permissionless safety valve: anyone (in practice the recipient) can
/// force-release every tranche currently DUE if the scheduler is down. Same
/// gates as release(), and the only destination is `stream.recipient`
/// (hardwired at create), so there's no extraction surface.
public fun claim_accrued(stream: &mut Stream, clock: &Clock, ctx: &mut TxContext) {
    assert!(!stream.cancelled, E_CANCELLED);
    assert!(!stream.paused, E_PAUSED);
    while (stream.tranches_done < stream.num_tranches) {
        let due_at = stream.start_ms + stream.tranches_done * stream.interval_ms;
        if (clock.timestamp_ms() < due_at) break;
        let is_last = stream.tranches_done + 1 == stream.num_tranches;
        let amount = if (is_last) { balance::value(&stream.escrow) } else { stream.tranche_amount };
        let out = balance::split(&mut stream.escrow, amount);
        stream.released_amount = stream.released_amount + amount;
        stream.tranches_done = stream.tranches_done + 1;
        let coin_out = coin::from_balance(out, ctx);
        transfer::public_transfer(coin_out, stream.recipient);
        event::emit(TranchePaid {
            stream_id: object::id(stream),
            recipient: stream.recipient,
            amount,
            tranche_index: stream.tranches_done,
            ts_ms: clock.timestamp_ms(),
        });
    };
}

// ───────────────────────────────────────────────────────────────────
// Sender controls (sender-signed)

public fun pause(stream: &mut Stream, ctx: &TxContext) {
    assert!(ctx.sender() == stream.sender, E_NOT_SENDER);
    stream.paused = true;
    event::emit(StreamPaused { stream_id: object::id(stream) });
}

public fun resume(stream: &mut Stream, ctx: &TxContext) {
    assert!(ctx.sender() == stream.sender, E_NOT_SENDER);
    stream.paused = false;
    event::emit(StreamResumed { stream_id: object::id(stream) });
}

/// Cancel + withdraw the undistributed remainder back to the sender.
/// Terminal. Already-released tranches stay with the recipient.
public fun cancel_and_withdraw(stream: &mut Stream, ctx: &mut TxContext): Coin<USDSUI> {
    assert!(ctx.sender() == stream.sender, E_NOT_SENDER);
    stream.cancelled = true;
    let remaining = balance::withdraw_all(&mut stream.escrow);
    event::emit(StreamCancelled {
        stream_id: object::id(stream),
        refunded: balance::value(&remaining),
        released: stream.released_amount,
    });
    coin::from_balance(remaining, ctx)
}

// ───────────────────────────────────────────────────────────────────
// Read-only views

public fun tranches_done(stream: &Stream): u64 { stream.tranches_done }
public fun released_amount(stream: &Stream): u64 { stream.released_amount }
public fun recipient(stream: &Stream): address { stream.recipient }
public fun is_cancelled(stream: &Stream): bool { stream.cancelled }
public fun is_paused(stream: &Stream): bool { stream.paused }
