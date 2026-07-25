/// Talise team payroll streams — an on-chain, NON-CUSTODIAL payroll stream.
///
/// "Pay these 5 people an equal share every week for 12 weeks" is a
/// `TeamStream<T>`: a shared object that custodies the WHOLE pot as a
/// `Balance<T>` plus a schedule fixed at funding time (roster, per-member share,
/// interval, tranche count). `release_due_tranche` is PERMISSIONLESS — ANYONE may
/// call it once an interval comes due (the creator's own app, a member, a public
/// keeper). It pays exactly `per_member` to each of the **hardwired** members and
/// advances the cursor by one interval. The caller can NEVER change the roster,
/// never pay more than the schedule allows, never fire before `next_due_ms`, and
/// never release more tranches than were funded — the contract itself is the
/// guarantee, so no privileged scheduler key and no cron exist.
///
/// Idempotent BY CONSTRUCTION: releasing tranche N advances both `tranches_done`
/// and `next_due_ms`, so a second call for the same tranche aborts (`ENotDue`,
/// or `EExhausted` past the last one). That replaces the server-side atomic DB
/// claim the escrow model needed.
///
/// SPLIT + DUST. At funding: `tranche = funded / num_tranches`, then
/// `per_member = tranche / member_count`, and each release moves exactly
/// `tranche_total = per_member * member_count` out of the pot. Both divisions
/// truncate, so `dust = funded - tranche_total * num_tranches` (0 .. a few
/// micro-units) is never promised to anyone: it simply stays in the pot and the
/// creator reclaims it with `cancel` (which doubles as the post-completion sweep).
/// A member is never paid a rounded-up share, and the pot can never be over-drawn.
///
/// The roster is resolved + compliance-screened by Talise's server prepare BEFORE
/// the creator signs `create`; from then on the addresses are immutable, which is
/// precisely why the release can safely be permissionless. Deliberately dependency
/// free (no cross-package screening at release time — a later-denylisted member
/// must not be able to brick a funded payroll; the creator can always cancel).
///
/// GENERIC over `T` (USDsui in production) — the coin type is a phantom param, so
/// this package carries no dependency on the coin's defining package.
module talise_payroll_streams::team_stream;

use sui::{
    balance::{Self, Balance},
    clock::Clock,
    coin::{Self, Coin},
    event,
};

// ───────────────────────────────────────────────────────────────────
// Errors (870-block: talise::batch_pay owns 760, talise_payroll 800,
// talise_automations 400)

const ERegistryPaused: u64 = 870;
const ENotCreator: u64 = 871;
const ECancelled: u64 = 872;
const EBadSchedule: u64 = 873;
const ENotDue: u64 = 874;
const EExhausted: u64 = 875;
const EInsufficientPot: u64 = 876;
const ENoMembers: u64 = 877;
const ETooManyMembers: u64 = 878;
const EShareTooSmall: u64 = 879;
const EDuplicateMember: u64 = 880;
const ESelfMember: u64 = 881;

/// One release pays every member in a single transaction, so the roster is
/// bounded by the per-tx object limit. 50 matches the server-side cap.
const MAX_MEMBERS: u64 = 50;
/// A year of daily payouts. Bounds the schedule so `tranche` can't be dust.
const MAX_TRANCHES: u64 = 365;

// ───────────────────────────────────────────────────────────────────
// Objects

/// Singleton shared registry — a global pause (circuit-breaker) plus a counter.
/// It holds NO worker allowlist: `release_due_tranche` needs none, because the
/// caller has zero discretion over destination or amount.
public struct TeamStreamRegistry has key {
    id: UID,
    admin: address,
    paused: bool,
    streams_total: u64,
}

/// AdminCap minted to the publisher at bootstrap (governance).
public struct TeamStreamAdminCap has key, store { id: UID }

/// One shared object per payroll stream. Holds the entire undistributed pot as a
/// `Balance<T>`; `next_due_ms` is the cursor the permissionless release checks
/// against the Clock. `key` only (no `store`): a stream can't be wrapped away.
public struct TeamStream<phantom T> has key {
    id: UID,
    creator: address,
    /// Immutable roster, fixed at funding. Deduped, never the creator.
    members: vector<address>,
    pot: Balance<T>,
    /// Exactly what each member receives per tranche.
    per_member: u64,
    /// Exactly what leaves the pot per tranche (`per_member * |members|`).
    tranche_total: u64,
    num_tranches: u64,
    tranches_done: u64,
    interval_ms: u64,
    next_due_ms: u64,
    released_total: u64,
    cancelled: bool,
}

// ───────────────────────────────────────────────────────────────────
// Events

public struct StreamCreated has copy, drop {
    stream_id: ID,
    creator: address,
    members: vector<address>,
    per_member: u64,
    tranche_total: u64,
    num_tranches: u64,
    interval_ms: u64,
    first_due_ms: u64,
    funded: u64,
    /// `funded - tranche_total * num_tranches` — the creator's reclaimable rounding
    /// remainder. Never payable to a member.
    dust: u64,
}

public struct TrancheReleased has copy, drop {
    stream_id: ID,
    /// 0-based; the Nth release can only ever happen once.
    tranche_index: u64,
    per_member: u64,
    total: u64,
    member_count: u64,
    /// Whoever fired it — the release is permissionless, this is for indexing only.
    caller: address,
    next_due_ms: u64,
    ts_ms: u64,
}

public struct StreamCancelled has copy, drop {
    stream_id: ID,
    refunded: u64,
    released_total: u64,
    tranches_done: u64,
}

// ───────────────────────────────────────────────────────────────────
// Bootstrap

fun init(ctx: &mut TxContext) {
    transfer::share_object(TeamStreamRegistry {
        id: object::new(ctx),
        admin: ctx.sender(),
        paused: false,
        streams_total: 0,
    });
    transfer::public_transfer(TeamStreamAdminCap { id: object::new(ctx) }, ctx.sender());
}

// ───────────────────────────────────────────────────────────────────
// Admin (cap-gated)

/// Global circuit-breaker. Blocks new streams AND new releases; it can never
/// touch a funded pot, and `cancel` stays open so a creator's refund is never
/// held hostage by a paused registry.
public fun set_paused(registry: &mut TeamStreamRegistry, _cap: &TeamStreamAdminCap, paused: bool) {
    registry.paused = paused;
}

// ───────────────────────────────────────────────────────────────────
// Create (creator-signed, Onara-sponsored)

/// Create + fund a team stream and share it. `funds` is the WHOLE pot: every
/// tranche the schedule promises is fully funded up front, so a release can only
/// ever fail on the Clock, never on solvency.
///
/// Asserts the roster is non-empty, within `MAX_MEMBERS`, deduped, and excludes
/// the creator; the schedule is within bounds; and each member's share is at
/// least one micro-unit. Returns the new stream id (the server parses it from the
/// transaction's object changes).
public fun create<T>(
    registry: &mut TeamStreamRegistry,
    funds: Balance<T>,
    members: vector<address>,
    num_tranches: u64,
    interval_ms: u64,
    first_due_ms: u64,
    ctx: &mut TxContext,
): ID {
    assert!(!registry.paused, ERegistryPaused);
    let n = members.length();
    assert!(n > 0, ENoMembers);
    assert!(n <= MAX_MEMBERS, ETooManyMembers);
    assert!(num_tranches > 0, EBadSchedule);
    assert!(num_tranches <= MAX_TRANCHES, EBadSchedule);
    assert!(interval_ms > 0, EBadSchedule);

    // Roster hygiene: paying the same address twice would silently double their
    // share, and a creator paying themselves is a no-op round trip.
    let creator = ctx.sender();
    let mut i = 0;
    while (i < n) {
        let a = members[i];
        assert!(a != creator, ESelfMember);
        let mut j = i + 1;
        while (j < n) {
            assert!(members[j] != a, EDuplicateMember);
            j = j + 1;
        };
        i = i + 1;
    };

    // Split arithmetic, both divisions truncating. `dust` is what neither the
    // schedule nor any member can claim; it stays in the pot for the creator.
    let funded = funds.value();
    let per_member = (funded / num_tranches) / n;
    assert!(per_member > 0, EShareTooSmall);
    let tranche_total = per_member * n;
    let obligation = tranche_total * num_tranches;
    // Holds by construction (floor(floor(F/k)/n)*n*k <= F); asserted anyway, so a
    // future edit to this arithmetic can never ship an under-funded stream.
    assert!(funded >= obligation, EInsufficientPot);

    let stream = TeamStream<T> {
        id: object::new(ctx),
        creator,
        members,
        pot: funds,
        per_member,
        tranche_total,
        num_tranches,
        tranches_done: 0,
        interval_ms,
        next_due_ms: first_due_ms,
        released_total: 0,
        cancelled: false,
    };
    let sid = object::id(&stream);
    registry.streams_total = registry.streams_total + 1;
    event::emit(StreamCreated {
        stream_id: sid,
        creator,
        members: stream.members,
        per_member,
        tranche_total,
        num_tranches,
        interval_ms,
        first_due_ms,
        funded,
        dust: funded - obligation,
    });
    transfer::share_object(stream);
    sid
}

// ───────────────────────────────────────────────────────────────────
// Release (PERMISSIONLESS, Clock-gated)

/// Release ONE due tranche: pays exactly `per_member` to every member, atomically.
/// Callable by ANYONE — gated only on: registry not paused, stream live, tranches
/// remaining, `now >= next_due_ms`, and a pot that covers the tranche. Advances
/// the cursor by exactly one interval so cadence never drifts.
///
/// Double-release is impossible: after this returns, tranche `index` is behind
/// both the counter and the Clock cursor, so calling again at the same timestamp
/// aborts `ENotDue` (and `EExhausted` once the last tranche is out). A backlog is
/// caught up by calling this repeatedly — each call releases exactly one tranche,
/// in order, never more than one interval's worth per call.
public fun release_due_tranche<T>(
    registry: &TeamStreamRegistry,
    stream: &mut TeamStream<T>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(!registry.paused, ERegistryPaused);
    assert!(!stream.cancelled, ECancelled);
    assert!(stream.tranches_done < stream.num_tranches, EExhausted);
    let now = clock.timestamp_ms();
    assert!(now >= stream.next_due_ms, ENotDue);
    assert!(stream.pot.value() >= stream.tranche_total, EInsufficientPot);

    // Advance the cursor BEFORE paying: any later abort rolls the whole
    // transaction back, and no path below can leave the cursor unadvanced.
    let index = stream.tranches_done;
    stream.tranches_done = index + 1;
    stream.next_due_ms = stream.next_due_ms + stream.interval_ms;
    stream.released_total = stream.released_total + stream.tranche_total;

    let per_member = stream.per_member;
    let n = stream.members.length();
    n.do!(|i| {
        let member = stream.members[i];
        let part = stream.pot.split(per_member);
        transfer::public_transfer(coin::from_balance(part, ctx), member);
    });

    event::emit(TrancheReleased {
        stream_id: object::id(stream),
        tranche_index: index,
        per_member,
        total: stream.tranche_total,
        member_count: n,
        caller: ctx.sender(),
        next_due_ms: stream.next_due_ms,
        ts_ms: now,
    });
}

// ───────────────────────────────────────────────────────────────────
// Creator controls (creator-signed)

/// Stop the stream and reclaim the ENTIRE remaining pot (unreleased tranches +
/// the rounding dust). Returns the refund coin, which the caller routes back to
/// the creator in the same PTB. Creator-only and once-only; after the final
/// tranche this is also the dust sweep, so nothing is ever stranded on chain.
public fun cancel<T>(stream: &mut TeamStream<T>, ctx: &mut TxContext): Coin<T> {
    assert!(ctx.sender() == stream.creator, ENotCreator);
    assert!(!stream.cancelled, ECancelled);
    stream.cancelled = true;
    let refunded = stream.pot.value();
    let out = stream.pot.withdraw_all();
    event::emit(StreamCancelled {
        stream_id: object::id(stream),
        refunded,
        released_total: stream.released_total,
        tranches_done: stream.tranches_done,
    });
    coin::from_balance(out, ctx)
}

// ───────────────────────────────────────────────────────────────────
// Read accessors

public fun creator<T>(s: &TeamStream<T>): address { s.creator }
public fun member_count<T>(s: &TeamStream<T>): u64 { s.members.length() }
public fun member_at<T>(s: &TeamStream<T>, i: u64): address { s.members[i] }
public fun per_member<T>(s: &TeamStream<T>): u64 { s.per_member }
public fun tranche_total<T>(s: &TeamStream<T>): u64 { s.tranche_total }
public fun num_tranches<T>(s: &TeamStream<T>): u64 { s.num_tranches }
public fun tranches_done<T>(s: &TeamStream<T>): u64 { s.tranches_done }
public fun interval_ms<T>(s: &TeamStream<T>): u64 { s.interval_ms }
public fun next_due_ms<T>(s: &TeamStream<T>): u64 { s.next_due_ms }
public fun pot_value<T>(s: &TeamStream<T>): u64 { s.pot.value() }
public fun released_total<T>(s: &TeamStream<T>): u64 { s.released_total }
public fun is_cancelled<T>(s: &TeamStream<T>): bool { s.cancelled }
public fun is_paused(registry: &TeamStreamRegistry): bool { registry.paused }
public fun streams_total(registry: &TeamStreamRegistry): u64 { registry.streams_total }

/// What the remaining schedule still owes the roster.
public fun remaining_obligation<T>(s: &TeamStream<T>): u64 {
    s.tranche_total * (s.num_tranches - s.tranches_done)
}

/// The creator's reclaimable remainder — pot minus what the schedule still owes.
/// Constant across releases (each release moves exactly `tranche_total`).
public fun reclaimable_dust<T>(s: &TeamStream<T>): u64 {
    let pot = s.pot.value();
    let owed = s.remaining_obligation();
    if (pot > owed) pot - owed else 0
}

/// True when a permissionless release would be accepted right now.
public fun is_due<T>(s: &TeamStream<T>, clock: &Clock): bool {
    !s.cancelled
        && s.tranches_done < s.num_tranches
        && clock.timestamp_ms() >= s.next_due_ms
        && s.pot.value() >= s.tranche_total
}

// ───────────────────────────────────────────────────────────────────
#[test_only]
use sui::{test_scenario as ts, sui::SUI, clock};

#[test_only]
const CREATOR: address = @0x0; // ts default sender for the funding tx
#[test_only]
const ALICE: address = @0xA11CE;
#[test_only]
const BOB: address = @0xB0B;
#[test_only]
const CAROL: address = @0xCE01;
#[test_only]
const STRANGER: address = @0xBAD;

#[test_only]
fun mint<T>(amount: u64): Balance<T> { balance::create_for_testing<T>(amount) }

#[test_only]
/// Bootstrap + fund a stream in one helper. Returns nothing; the shared objects
/// are taken back out of the scenario by each test.
fun setup(sc: &mut ts::Scenario, funded: u64, num_tranches: u64, interval_ms: u64, first_due_ms: u64) {
    { init(sc.ctx()); };
    sc.next_tx(CREATOR);
    {
        let mut reg = sc.take_shared<TeamStreamRegistry>();
        create<SUI>(
            &mut reg,
            mint<SUI>(funded),
            vector[ALICE, BOB, CAROL],
            num_tranches,
            interval_ms,
            first_due_ms,
            sc.ctx(),
        );
        ts::return_shared(reg);
    };
}

#[test_only]
/// Assert `who` was paid exactly `amount` by the last release, and burn the coin.
fun assert_paid(sc: &ts::Scenario, who: address, amount: u64) {
    let c = ts::take_from_address<Coin<SUI>>(sc, who);
    assert!(c.value() == amount, 99);
    coin::burn_for_testing(c);
}

#[test]
/// Happy path with an EVEN split: 300 over 3 tranches to 3 members
/// → tranche 100, per member 33 (100/3), tranche_total 99, dust 300-297 = 3.
/// Proves: each member is paid the exact truncated share, the pot drops by
/// exactly `tranche_total`, and the cursor advances one interval.
fun release_pays_equal_shares() {
    let mut sc = ts::begin(ALICE);
    setup(&mut sc, 300, 3, 1_000, 1_000);

    sc.next_tx(CREATOR);
    {
        let reg = sc.take_shared<TeamStreamRegistry>();
        let mut s = sc.take_shared<TeamStream<SUI>>();
        let mut clk = clock::create_for_testing(sc.ctx());
        clock::set_for_testing(&mut clk, 1_000);

        assert!(per_member(&s) == 33, 0);
        assert!(tranche_total(&s) == 99, 1);
        assert!(reclaimable_dust(&s) == 3, 2);
        assert!(is_due(&s, &clk), 3);

        release_due_tranche<SUI>(&reg, &mut s, &clk, sc.ctx());

        assert!(tranches_done(&s) == 1, 4);
        assert!(pot_value(&s) == 201, 5);          // 300 - 99
        assert!(released_total(&s) == 99, 6);
        assert!(next_due_ms(&s) == 2_000, 7);
        assert!(remaining_obligation(&s) == 198, 8);
        assert!(reclaimable_dust(&s) == 3, 9);     // dust is invariant across releases
        assert!(!is_due(&s, &clk), 10);            // not due again at the same instant

        ts::return_shared(reg);
        ts::return_shared(s);
        clock::destroy_for_testing(clk);
    };
    // Each member holds exactly one 33-unit coin.
    sc.next_tx(CREATOR);
    {
        assert_paid(&sc, ALICE, 33);
        assert_paid(&sc, BOB, 33);
        assert_paid(&sc, CAROL, 33);
    };
    sc.end();
}

#[test]
/// UNEVEN split + where the dust goes. 100 over 1 tranche to 3 members
/// → per member 33, tranche_total 99, dust 1. After the only tranche the pot
/// still holds exactly that 1 unit, and `cancel` returns it to the CREATOR.
/// The dust is never paid to a member and is never stranded on chain.
fun uneven_split_dust_goes_back_to_creator() {
    let mut sc = ts::begin(ALICE);
    setup(&mut sc, 100, 1, 1_000, 1_000);

    sc.next_tx(STRANGER); // permissionless: a stranger fires the payroll
    {
        let reg = sc.take_shared<TeamStreamRegistry>();
        let mut s = sc.take_shared<TeamStream<SUI>>();
        let mut clk = clock::create_for_testing(sc.ctx());
        clock::set_for_testing(&mut clk, 1_000);
        assert!(per_member(&s) == 33, 0);
        assert!(tranche_total(&s) == 99, 1);
        assert!(reclaimable_dust(&s) == 1, 2);
        release_due_tranche<SUI>(&reg, &mut s, &clk, sc.ctx());
        assert!(pot_value(&s) == 1, 3);            // exactly the dust
        assert!(remaining_obligation(&s) == 0, 4);
        ts::return_shared(reg);
        ts::return_shared(s);
        clock::destroy_for_testing(clk);
    };
    sc.next_tx(CREATOR);
    {
        assert_paid(&sc, ALICE, 33);
        assert_paid(&sc, BOB, 33);
        assert_paid(&sc, CAROL, 33);
        // The creator sweeps the 1-unit remainder — cancel doubles as the
        // post-completion dust sweep.
        let mut s = sc.take_shared<TeamStream<SUI>>();
        let refund = cancel<SUI>(&mut s, sc.ctx());
        assert!(refund.value() == 1, 5);
        assert!(is_cancelled(&s), 6);
        assert!(pot_value(&s) == 0, 7);
        coin::burn_for_testing(refund);
        ts::return_shared(s);
    };
    sc.end();
}

#[test, expected_failure(abort_code = ENotDue)]
/// Releasing the SAME tranche twice aborts — the contract-level replacement for
/// the old server-side atomic DB claim. Both calls sit in one transaction at one
/// timestamp; the second sees the advanced cursor and aborts.
fun double_release_of_same_tranche_aborts() {
    let mut sc = ts::begin(ALICE);
    setup(&mut sc, 300, 3, 1_000, 1_000);
    sc.next_tx(STRANGER);
    {
        let reg = sc.take_shared<TeamStreamRegistry>();
        let mut s = sc.take_shared<TeamStream<SUI>>();
        let mut clk = clock::create_for_testing(sc.ctx());
        clock::set_for_testing(&mut clk, 1_000);
        release_due_tranche<SUI>(&reg, &mut s, &clk, sc.ctx()); // tranche 0
        release_due_tranche<SUI>(&reg, &mut s, &clk, sc.ctx()); // ← aborts ENotDue
        ts::return_shared(reg);
        ts::return_shared(s);
        clock::destroy_for_testing(clk);
    };
    abort
}

#[test, expected_failure(abort_code = EExhausted)]
/// The tranche COUNT is a hard cap: once every funded tranche is out, no amount
/// of waiting lets another release through (the pot's dust can never be paid out).
fun release_past_last_tranche_aborts() {
    let mut sc = ts::begin(ALICE);
    setup(&mut sc, 100, 1, 1_000, 1_000);
    sc.next_tx(STRANGER);
    {
        let reg = sc.take_shared<TeamStreamRegistry>();
        let mut s = sc.take_shared<TeamStream<SUI>>();
        let mut clk = clock::create_for_testing(sc.ctx());
        clock::set_for_testing(&mut clk, 1_000);
        release_due_tranche<SUI>(&reg, &mut s, &clk, sc.ctx());
        clock::set_for_testing(&mut clk, 99_000); // long past the next interval
        release_due_tranche<SUI>(&reg, &mut s, &clk, sc.ctx()); // ← EExhausted
        ts::return_shared(reg);
        ts::return_shared(s);
        clock::destroy_for_testing(clk);
    };
    abort
}

#[test, expected_failure(abort_code = ENotDue)]
/// The Clock gate holds even though the release is permissionless.
fun cannot_release_before_due() {
    let mut sc = ts::begin(ALICE);
    setup(&mut sc, 300, 3, 1_000, 5_000);
    sc.next_tx(STRANGER);
    {
        let reg = sc.take_shared<TeamStreamRegistry>();
        let mut s = sc.take_shared<TeamStream<SUI>>();
        let mut clk = clock::create_for_testing(sc.ctx());
        clock::set_for_testing(&mut clk, 4_999);
        release_due_tranche<SUI>(&reg, &mut s, &clk, sc.ctx());
        ts::return_shared(reg);
        ts::return_shared(s);
        clock::destroy_for_testing(clk);
    };
    abort
}

#[test]
/// A backlog is caught up one tranche per call, in order, never more than the
/// schedule: two calls after two intervals release tranches 0 and 1, and a third
/// call at the same instant aborts (asserted via `is_due`).
fun backlog_catches_up_one_tranche_per_call() {
    let mut sc = ts::begin(ALICE);
    setup(&mut sc, 300, 3, 1_000, 1_000);
    sc.next_tx(STRANGER);
    {
        let reg = sc.take_shared<TeamStreamRegistry>();
        let mut s = sc.take_shared<TeamStream<SUI>>();
        let mut clk = clock::create_for_testing(sc.ctx());
        clock::set_for_testing(&mut clk, 2_500); // tranches due at 1_000 and 2_000
        release_due_tranche<SUI>(&reg, &mut s, &clk, sc.ctx());
        assert!(is_due(&s, &clk), 0);
        release_due_tranche<SUI>(&reg, &mut s, &clk, sc.ctx());
        assert!(tranches_done(&s) == 2, 1);
        assert!(released_total(&s) == 198, 2);
        assert!(next_due_ms(&s) == 3_000, 3);
        assert!(!is_due(&s, &clk), 4); // the third tranche is still in the future
        ts::return_shared(reg);
        ts::return_shared(s);
        clock::destroy_for_testing(clk);
    };
    sc.end();
}

#[test]
/// Cancel mid-schedule refunds the ENTIRE remainder (unreleased tranches + dust)
/// and stops the stream dead — a later release attempt would abort ECancelled.
fun creator_cancels_and_reclaims_remainder() {
    let mut sc = ts::begin(ALICE);
    setup(&mut sc, 300, 3, 1_000, 1_000);
    sc.next_tx(STRANGER);
    {
        let reg = sc.take_shared<TeamStreamRegistry>();
        let mut s = sc.take_shared<TeamStream<SUI>>();
        let mut clk = clock::create_for_testing(sc.ctx());
        clock::set_for_testing(&mut clk, 1_000);
        release_due_tranche<SUI>(&reg, &mut s, &clk, sc.ctx());
        ts::return_shared(reg);
        ts::return_shared(s);
        clock::destroy_for_testing(clk);
    };
    sc.next_tx(CREATOR);
    {
        let mut s = sc.take_shared<TeamStream<SUI>>();
        let refund = cancel<SUI>(&mut s, sc.ctx());
        assert!(refund.value() == 201, 0); // 2 unreleased tranches (198) + dust (3)
        assert!(is_cancelled(&s), 1);
        coin::burn_for_testing(refund);
        ts::return_shared(s);
    };
    sc.end();
}

#[test, expected_failure(abort_code = ECancelled)]
fun cancelled_stream_cannot_release() {
    let mut sc = ts::begin(ALICE);
    setup(&mut sc, 300, 3, 1_000, 1_000);
    sc.next_tx(CREATOR);
    {
        let mut s = sc.take_shared<TeamStream<SUI>>();
        let refund = cancel<SUI>(&mut s, sc.ctx());
        coin::burn_for_testing(refund);
        ts::return_shared(s);
    };
    sc.next_tx(STRANGER);
    {
        let reg = sc.take_shared<TeamStreamRegistry>();
        let mut s = sc.take_shared<TeamStream<SUI>>();
        let mut clk = clock::create_for_testing(sc.ctx());
        clock::set_for_testing(&mut clk, 9_000);
        release_due_tranche<SUI>(&reg, &mut s, &clk, sc.ctx());
        ts::return_shared(reg);
        ts::return_shared(s);
        clock::destroy_for_testing(clk);
    };
    abort
}

#[test, expected_failure(abort_code = ENotCreator)]
/// Only the creator can stop a stream and take the money back. A member or a
/// keeper can fire releases but can never touch the pot.
fun stranger_cannot_cancel() {
    let mut sc = ts::begin(ALICE);
    setup(&mut sc, 300, 3, 1_000, 1_000);
    sc.next_tx(STRANGER);
    {
        let mut s = sc.take_shared<TeamStream<SUI>>();
        let refund = cancel<SUI>(&mut s, sc.ctx());
        coin::burn_for_testing(refund);
        ts::return_shared(s);
    };
    abort
}

#[test, expected_failure(abort_code = ECancelled)]
fun cannot_cancel_twice() {
    let mut sc = ts::begin(ALICE);
    setup(&mut sc, 300, 3, 1_000, 1_000);
    sc.next_tx(CREATOR);
    {
        let mut s = sc.take_shared<TeamStream<SUI>>();
        let a = cancel<SUI>(&mut s, sc.ctx());
        let b = cancel<SUI>(&mut s, sc.ctx());
        coin::burn_for_testing(a);
        coin::burn_for_testing(b);
        ts::return_shared(s);
    };
    abort
}

#[test, expected_failure(abort_code = EShareTooSmall)]
/// A schedule whose per-member share truncates to zero is rejected at funding
/// rather than creating a stream that pays nothing forever.
fun share_that_rounds_to_zero_is_rejected() {
    let mut sc = ts::begin(ALICE);
    setup(&mut sc, 2, 1, 1_000, 1_000); // 2 / 1 / 3 members → 0 each
    abort
}

#[test, expected_failure(abort_code = EDuplicateMember)]
fun duplicate_member_is_rejected() {
    let mut sc = ts::begin(ALICE);
    { init(sc.ctx()); };
    sc.next_tx(CREATOR);
    {
        let mut reg = sc.take_shared<TeamStreamRegistry>();
        create<SUI>(&mut reg, mint<SUI>(300), vector[ALICE, BOB, ALICE], 3, 1_000, 1_000, sc.ctx());
        ts::return_shared(reg);
    };
    abort
}

#[test, expected_failure(abort_code = ESelfMember)]
fun creator_cannot_be_a_member() {
    let mut sc = ts::begin(ALICE);
    { init(sc.ctx()); };
    sc.next_tx(CREATOR);
    {
        let mut reg = sc.take_shared<TeamStreamRegistry>();
        create<SUI>(&mut reg, mint<SUI>(300), vector[ALICE, CREATOR], 3, 1_000, 1_000, sc.ctx());
        ts::return_shared(reg);
    };
    abort
}

#[test, expected_failure(abort_code = ENoMembers)]
fun empty_roster_is_rejected() {
    let mut sc = ts::begin(ALICE);
    { init(sc.ctx()); };
    sc.next_tx(CREATOR);
    {
        let mut reg = sc.take_shared<TeamStreamRegistry>();
        create<SUI>(&mut reg, mint<SUI>(300), vector[], 3, 1_000, 1_000, sc.ctx());
        ts::return_shared(reg);
    };
    abort
}

#[test, expected_failure(abort_code = EBadSchedule)]
fun zero_tranches_is_rejected() {
    let mut sc = ts::begin(ALICE);
    setup(&mut sc, 300, 0, 1_000, 1_000);
    abort
}

#[test, expected_failure(abort_code = ERegistryPaused)]
/// The admin circuit-breaker stops releases (it can never move a pot, and the
/// creator's `cancel` refund stays available while paused).
fun admin_pause_blocks_release() {
    let mut sc = ts::begin(ALICE);
    setup(&mut sc, 300, 3, 1_000, 1_000);
    sc.next_tx(ALICE); // ALICE published, so ALICE holds the AdminCap
    {
        let mut reg = sc.take_shared<TeamStreamRegistry>();
        let cap = sc.take_from_sender<TeamStreamAdminCap>();
        set_paused(&mut reg, &cap, true);
        sc.return_to_sender(cap);
        ts::return_shared(reg);
    };
    sc.next_tx(STRANGER);
    {
        let reg = sc.take_shared<TeamStreamRegistry>();
        let mut s = sc.take_shared<TeamStream<SUI>>();
        let mut clk = clock::create_for_testing(sc.ctx());
        clock::set_for_testing(&mut clk, 1_000);
        release_due_tranche<SUI>(&reg, &mut s, &clk, sc.ctx());
        ts::return_shared(reg);
        ts::return_shared(s);
        clock::destroy_for_testing(clk);
    };
    abort
}

#[test]
/// A funded stream can always pay every tranche it promised: release all three
/// and the pot is left holding exactly the dust.
fun full_schedule_is_always_solvent() {
    let mut sc = ts::begin(ALICE);
    setup(&mut sc, 300, 3, 1_000, 1_000);
    sc.next_tx(STRANGER);
    {
        let reg = sc.take_shared<TeamStreamRegistry>();
        let mut s = sc.take_shared<TeamStream<SUI>>();
        let mut clk = clock::create_for_testing(sc.ctx());
        clock::set_for_testing(&mut clk, 1_000);
        release_due_tranche<SUI>(&reg, &mut s, &clk, sc.ctx());
        clock::set_for_testing(&mut clk, 2_000);
        release_due_tranche<SUI>(&reg, &mut s, &clk, sc.ctx());
        clock::set_for_testing(&mut clk, 3_000);
        release_due_tranche<SUI>(&reg, &mut s, &clk, sc.ctx());
        assert!(tranches_done(&s) == 3, 0);
        assert!(released_total(&s) == 297, 1);
        assert!(pot_value(&s) == 3, 2);
        assert!(reclaimable_dust(&s) == 3, 3);
        assert!(!is_due(&s, &clk), 4);
        ts::return_shared(reg);
        ts::return_shared(s);
        clock::destroy_for_testing(clk);
    };
    sc.end();
}
