/// On-chain claimable escrow for Talise cheques.
///
/// A Talise "cheque" is a link/code the sender shares out-of-band; whoever
/// presents it (and passes Talise's off-chain gates — captcha, VPN check,
/// country allowlist) can claim the funds. Those gates stay SERVER-SIDE: the
/// backend verifies the claimer, resolves their on-chain address, and only
/// then signs `claim` from the Onara worker key. On-chain this module is a
/// pure escrow with two terminal exits:
///   • worker-released `claim` → funds go to the verified recipient, or
///   • creator-initiated `reclaim` → funds return to the sender (void).
///
/// Modeled 1:1 on `talise::stream`'s role/cap pattern: a shared
/// `ChequeRegistry` holds the worker address list + a global kill switch;
/// each outstanding cheque is a shared `Cheque<T>` holding the funds as
/// `Balance<T>`. The `claimed` flag is the one-shot guard: `claim` asserts
/// `!claimed` then sets it, and `reclaim` asserts `!claimed`, so claim and
/// reclaim can never both succeed for the same cheque.
///
/// GENERIC over `T`: like `talise::stream` and `talise::send`, the coin type
/// is a phantom parameter; the funding PTB picks `T` (USDsui in production).
module talise::cheque;

use sui::{
    balance::{Self, Balance},
    clock::Clock,
    coin::{Self, Coin},
    event,
};

// ───────────────────────────────────────────────────────────────────
// Errors

const E_ZERO_AMOUNT: u64 = 300;
const E_BAD_EXPIRY: u64 = 301;
const E_NOT_WORKER: u64 = 302;
const E_REGISTRY_PAUSED: u64 = 303;
const E_ALREADY_CLAIMED: u64 = 304;
const E_EXPIRED: u64 = 305;
const E_NOT_CREATOR: u64 = 306;
const E_WORKER_ALREADY_ADDED: u64 = 307;
const E_WORKER_NOT_FOUND: u64 = 308;

// ───────────────────────────────────────────────────────────────────
// Objects

/// Singleton shared registry. Its OWN admin/worker set, deliberately NOT
/// reusing `stream`'s — a worker authorized to release streams is not
/// implicitly authorized to release cheques, and vice versa.
public struct ChequeRegistry has key {
    id: UID,
    admin: address,
    worker_addresses: vector<address>,
    paused: bool,
    cheques_total: u64,
}

/// AdminCap minted to the publisher at bootstrap (governance). Distinct
/// type from `stream::StreamAdminCap`.
public struct ChequeAdminCap has key, store { id: UID }

/// One shared object per outstanding cheque. Holds the funds as
/// `Balance<T>`. Terminal once `claimed` is true (paid to recipient) or
/// once `reclaim` has consumed the escrow (returned to creator).
public struct Cheque<phantom T> has key {
    id: UID,
    creator: address,
    escrow: Balance<T>,
    amount: u64,
    expiry_ms: u64,
    claimed: bool,
}

// ───────────────────────────────────────────────────────────────────
// Events

public struct ChequeCreated has copy, drop {
    cheque_id: ID,
    creator: address,
    amount: u64,
    expiry_ms: u64,
}

public struct ChequeClaimed has copy, drop {
    cheque_id: ID,
    recipient: address,
    amount: u64,
    ts_ms: u64,
}

public struct ChequeReclaimed has copy, drop {
    cheque_id: ID,
    creator: address,
    amount: u64,
}

public struct WorkerAdded has copy, drop { worker: address }
public struct WorkerRemoved has copy, drop { worker: address }

// ───────────────────────────────────────────────────────────────────
// Bootstrap

fun init(ctx: &mut TxContext) {
    let registry = ChequeRegistry {
        id: object::new(ctx),
        admin: ctx.sender(),
        worker_addresses: vector[],
        paused: false,
        cheques_total: 0,
    };
    transfer::share_object(registry);
    transfer::public_transfer(ChequeAdminCap { id: object::new(ctx) }, ctx.sender());
}

/// Admin: grant a worker address permission to call `claim`.
public fun add_worker(
    _cap: &ChequeAdminCap,
    registry: &mut ChequeRegistry,
    worker: address,
) {
    assert!(!registry.worker_addresses.contains(&worker), E_WORKER_ALREADY_ADDED);
    registry.worker_addresses.push_back(worker);
    event::emit(WorkerAdded { worker });
}

/// Admin: revoke a worker address (cut off a rotated/compromised key).
public fun remove_worker(
    _cap: &ChequeAdminCap,
    registry: &mut ChequeRegistry,
    worker: address,
) {
    let (found, idx) = registry.worker_addresses.index_of(&worker);
    assert!(found, E_WORKER_NOT_FOUND);
    registry.worker_addresses.remove(idx);
    event::emit(WorkerRemoved { worker });
}

/// Admin: global kill switch (halts ALL worker claims).
public fun set_paused(_cap: &ChequeAdminCap, registry: &mut ChequeRegistry, paused: bool) {
    registry.paused = paused;
}

// ───────────────────────────────────────────────────────────────────
// Funding (creator-signed, once)

/// Called inside the creator's ONE signed funding PTB. The PTB upstream
/// produces `Balance<T>` and hands it here. Shares a `Cheque<T>` and emits
/// ChequeCreated. `expiry_ms` is a wall-clock (Clock) timestamp after which
/// a worker can no longer `claim` — past that, only the creator's `reclaim`
/// can move the funds.
public fun create<T>(
    registry: &mut ChequeRegistry,
    funds: Balance<T>,
    expiry_ms: u64,
    clock: &Clock,
    ctx: &mut TxContext,
): ID {
    let amount = balance::value(&funds);
    assert!(amount > 0, E_ZERO_AMOUNT);
    // Expiry must be in the future relative to creation, otherwise the
    // cheque is born already-unclaimable.
    assert!(expiry_ms > clock.timestamp_ms(), E_BAD_EXPIRY);

    let cheque = Cheque<T> {
        id: object::new(ctx),
        creator: ctx.sender(),
        escrow: funds,
        amount,
        expiry_ms,
        claimed: false,
    };
    let cid = object::id(&cheque);
    registry.cheques_total = registry.cheques_total + 1;
    event::emit(ChequeCreated {
        cheque_id: cid,
        creator: ctx.sender(),
        amount,
        expiry_ms,
    });
    transfer::share_object(cheque);
    cid
}

// ───────────────────────────────────────────────────────────────────
// Claim (worker-signed)

/// Worker-signed. The backend calls this AFTER its off-chain gates pass;
/// `recipient` is the verified claimer's resolved on-chain address. Gates:
/// (a) registry not paused, (b) sender is a registered worker, (c) not
/// already claimed, (d) not past expiry. Sets `claimed = true` BEFORE moving
/// funds and transfers the WHOLE escrow as `Coin<T>` to `recipient`. The
/// one-shot `claimed` flag makes a double-fired worker call abort
/// (E_ALREADY_CLAIMED), so a cheque can never pay twice.
public fun claim<T>(
    registry: &mut ChequeRegistry,
    cheque: &mut Cheque<T>,
    recipient: address,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(!registry.paused, E_REGISTRY_PAUSED);
    assert!(registry.worker_addresses.contains(&ctx.sender()), E_NOT_WORKER);
    assert!(!cheque.claimed, E_ALREADY_CLAIMED);
    assert!(clock.timestamp_ms() < cheque.expiry_ms, E_EXPIRED);

    cheque.claimed = true;
    let out = balance::withdraw_all(&mut cheque.escrow);
    let amount = balance::value(&out);
    let coin_out = coin::from_balance(out, ctx);
    transfer::public_transfer(coin_out, recipient);

    event::emit(ChequeClaimed {
        cheque_id: object::id(cheque),
        recipient,
        amount,
        ts_ms: clock.timestamp_ms(),
    });
}

// ───────────────────────────────────────────────────────────────────
// Reclaim (creator-signed)

/// Creator-only void. The creator can pull the funds back any time the
/// cheque is still unclaimed — no expiry wait — e.g. the recipient never
/// claims, or the creator cancels. Asserts `!claimed`, so once a worker has
/// claimed, reclaim is impossible (and vice versa): the two exits are
/// mutually exclusive. Returns `Coin<T>` so the funding PTB's reverse can
/// route it wherever the creator wants.
public fun reclaim<T>(cheque: &mut Cheque<T>, _clock: &Clock, ctx: &mut TxContext): Coin<T> {
    assert!(ctx.sender() == cheque.creator, E_NOT_CREATOR);
    assert!(!cheque.claimed, E_ALREADY_CLAIMED);

    // Mark claimed so the cheque is terminal: prevents any second reclaim
    // and keeps the claim/reclaim exits mutually exclusive.
    cheque.claimed = true;
    let out = balance::withdraw_all(&mut cheque.escrow);
    let amount = balance::value(&out);

    event::emit(ChequeReclaimed {
        cheque_id: object::id(cheque),
        creator: cheque.creator,
        amount,
    });
    coin::from_balance(out, ctx)
}

// ───────────────────────────────────────────────────────────────────
// Read-only views

public fun is_claimed<T>(cheque: &Cheque<T>): bool { cheque.claimed }
public fun amount<T>(cheque: &Cheque<T>): u64 { cheque.amount }
public fun creator<T>(cheque: &Cheque<T>): address { cheque.creator }
public fun expiry_ms<T>(cheque: &Cheque<T>): u64 { cheque.expiry_ms }
public fun escrow_value<T>(cheque: &Cheque<T>): u64 { balance::value(&cheque.escrow) }
public fun registry_paused(registry: &ChequeRegistry): bool { registry.paused }
public fun is_worker(registry: &ChequeRegistry, addr: address): bool {
    registry.worker_addresses.contains(&addr)
}

// ───────────────────────────────────────────────────────────────────
// Test-only

#[test_only]
public fun test_init(ctx: &mut TxContext) { init(ctx) }
