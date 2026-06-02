/// Tests for the claimable-escrow cheque module.
///
/// Coverage:
///   • happy path: create → worker claim pays the verified recipient
///   • access control: non-worker claim aborts E_NOT_WORKER
///   • registry kill switch: paused registry blocks claim (E_REGISTRY_PAUSED)
///   • expiry gate: claim at/after expiry aborts E_EXPIRED
///   • double-claim prevention: second claim aborts E_ALREADY_CLAIMED
///   • reclaim: creator voids an unclaimed cheque and gets funds back
///   • mutual exclusion: reclaim-after-claim aborts E_ALREADY_CLAIMED, and
///     claim-after-reclaim aborts E_ALREADY_CLAIMED
///   • non-creator reclaim aborts E_NOT_CREATOR
///   • create input validation (zero funds, past expiry)
///   • worker add/remove
///
/// Dummy coin type `T = SUI` via `coin::mint_for_testing` → `into_balance`.
#[test_only]
module talise::cheque_tests;

use sui::{balance, clock, coin, sui::SUI, test_scenario as ts};
use talise::cheque::{Self, ChequeRegistry, ChequeAdminCap, Cheque};

const PUBLISHER: address = @0xA;
const CREATOR: address = @0xB;
const CLAIMER: address = @0xC;
const WORKER: address = @0xD;
const RANDO: address = @0xE;

const AMOUNT: u64 = 5_000_000;
const EXPIRY: u64 = 100_000;

// ───────────────────────────────────────────────────────────────────
// Helpers

fun setup_registry(scenario: &mut ts::Scenario) {
    ts::next_tx(scenario, PUBLISHER);
    cheque::test_init(ts::ctx(scenario));
}

fun grant_worker(scenario: &mut ts::Scenario) {
    ts::next_tx(scenario, PUBLISHER);
    let cap = ts::take_from_sender<ChequeAdminCap>(scenario);
    let mut reg = ts::take_shared<ChequeRegistry>(scenario);
    cheque::add_worker(&cap, &mut reg, WORKER);
    ts::return_shared(reg);
    ts::return_to_sender(scenario, cap);
}

/// CREATOR funds a cheque of `AMOUNT`, expiry `EXPIRY`, clock at ms=0.
fun fund_cheque(scenario: &mut ts::Scenario): ID {
    ts::next_tx(scenario, CREATOR);
    let mut reg = ts::take_shared<ChequeRegistry>(scenario);
    let c = clock::create_for_testing(ts::ctx(scenario)); // ms = 0
    let funds = coin::into_balance(coin::mint_for_testing<SUI>(AMOUNT, ts::ctx(scenario)));
    let cid = cheque::create<SUI>(&mut reg, funds, EXPIRY, &c, ts::ctx(scenario));
    clock::destroy_for_testing(c);
    ts::return_shared(reg);
    cid
}

// ───────────────────────────────────────────────────────────────────
// Happy path

#[test]
fun create_then_claim_pays_recipient() {
    let mut scenario = ts::begin(PUBLISHER);
    setup_registry(&mut scenario);
    grant_worker(&mut scenario);
    let cid = fund_cheque(&mut scenario);

    ts::next_tx(&mut scenario, WORKER);
    {
        let mut reg = ts::take_shared<ChequeRegistry>(&scenario);
        let mut ch = ts::take_shared_by_id<Cheque<SUI>>(&scenario, cid);
        let mut c = clock::create_for_testing(ts::ctx(&mut scenario));
        clock::set_for_testing(&mut c, EXPIRY - 1); // before expiry
        cheque::claim<SUI>(&mut reg, &mut ch, CLAIMER, &c, ts::ctx(&mut scenario));
        assert!(cheque::is_claimed(&ch));
        assert!(cheque::escrow_value(&ch) == 0);
        clock::destroy_for_testing(c);
        ts::return_shared(ch);
        ts::return_shared(reg);
    };

    // CLAIMER holds the funds; nobody else does.
    ts::next_tx(&mut scenario, CLAIMER);
    {
        let got = ts::take_from_sender<coin::Coin<SUI>>(&scenario);
        assert!(coin::value(&got) == AMOUNT);
        coin::burn_for_testing(got);
    };
    ts::next_tx(&mut scenario, CREATOR);
    assert!(!ts::has_most_recent_for_sender<coin::Coin<SUI>>(&scenario));

    ts::end(scenario);
}

// ───────────────────────────────────────────────────────────────────
// Access control

#[test, expected_failure(abort_code = cheque::E_NOT_WORKER)]
fun non_worker_claim_aborts() {
    let mut scenario = ts::begin(PUBLISHER);
    setup_registry(&mut scenario);
    grant_worker(&mut scenario);
    let cid = fund_cheque(&mut scenario);

    // RANDO is not a worker.
    ts::next_tx(&mut scenario, RANDO);
    let mut reg = ts::take_shared<ChequeRegistry>(&scenario);
    let mut ch = ts::take_shared_by_id<Cheque<SUI>>(&scenario, cid);
    let mut c = clock::create_for_testing(ts::ctx(&mut scenario));
    clock::set_for_testing(&mut c, EXPIRY - 1);
    cheque::claim<SUI>(&mut reg, &mut ch, RANDO, &c, ts::ctx(&mut scenario));
    clock::destroy_for_testing(c);
    ts::return_shared(ch);
    ts::return_shared(reg);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = cheque::E_REGISTRY_PAUSED)]
fun paused_registry_blocks_claim() {
    let mut scenario = ts::begin(PUBLISHER);
    setup_registry(&mut scenario);
    grant_worker(&mut scenario);
    let cid = fund_cheque(&mut scenario);

    ts::next_tx(&mut scenario, PUBLISHER);
    {
        let cap = ts::take_from_sender<ChequeAdminCap>(&scenario);
        let mut reg = ts::take_shared<ChequeRegistry>(&scenario);
        cheque::set_paused(&cap, &mut reg, true);
        ts::return_shared(reg);
        ts::return_to_sender(&scenario, cap);
    };

    ts::next_tx(&mut scenario, WORKER);
    let mut reg = ts::take_shared<ChequeRegistry>(&scenario);
    let mut ch = ts::take_shared_by_id<Cheque<SUI>>(&scenario, cid);
    let mut c = clock::create_for_testing(ts::ctx(&mut scenario));
    clock::set_for_testing(&mut c, EXPIRY - 1);
    cheque::claim<SUI>(&mut reg, &mut ch, CLAIMER, &c, ts::ctx(&mut scenario));
    clock::destroy_for_testing(c);
    ts::return_shared(ch);
    ts::return_shared(reg);
    ts::end(scenario);
}

// ───────────────────────────────────────────────────────────────────
// Expiry gate

#[test, expected_failure(abort_code = cheque::E_EXPIRED)]
fun claim_at_expiry_aborts() {
    let mut scenario = ts::begin(PUBLISHER);
    setup_registry(&mut scenario);
    grant_worker(&mut scenario);
    let cid = fund_cheque(&mut scenario);

    ts::next_tx(&mut scenario, WORKER);
    let mut reg = ts::take_shared<ChequeRegistry>(&scenario);
    let mut ch = ts::take_shared_by_id<Cheque<SUI>>(&scenario, cid);
    let mut c = clock::create_for_testing(ts::ctx(&mut scenario));
    clock::set_for_testing(&mut c, EXPIRY); // exactly at expiry → not < expiry
    cheque::claim<SUI>(&mut reg, &mut ch, CLAIMER, &c, ts::ctx(&mut scenario));
    clock::destroy_for_testing(c);
    ts::return_shared(ch);
    ts::return_shared(reg);
    ts::end(scenario);
}

// ───────────────────────────────────────────────────────────────────
// Double-claim prevention

#[test, expected_failure(abort_code = cheque::E_ALREADY_CLAIMED)]
fun double_claim_aborts() {
    let mut scenario = ts::begin(PUBLISHER);
    setup_registry(&mut scenario);
    grant_worker(&mut scenario);
    let cid = fund_cheque(&mut scenario);

    ts::next_tx(&mut scenario, WORKER);
    let mut reg = ts::take_shared<ChequeRegistry>(&scenario);
    let mut ch = ts::take_shared_by_id<Cheque<SUI>>(&scenario, cid);
    let mut c = clock::create_for_testing(ts::ctx(&mut scenario));
    clock::set_for_testing(&mut c, EXPIRY - 1);
    cheque::claim<SUI>(&mut reg, &mut ch, CLAIMER, &c, ts::ctx(&mut scenario));
    // Double-fired worker call → abort.
    cheque::claim<SUI>(&mut reg, &mut ch, CLAIMER, &c, ts::ctx(&mut scenario));
    clock::destroy_for_testing(c);
    ts::return_shared(ch);
    ts::return_shared(reg);
    ts::end(scenario);
}

// ───────────────────────────────────────────────────────────────────
// Reclaim (creator void) + mutual exclusion

#[test]
fun creator_reclaims_unclaimed_cheque() {
    let mut scenario = ts::begin(PUBLISHER);
    setup_registry(&mut scenario);
    grant_worker(&mut scenario);
    let cid = fund_cheque(&mut scenario);

    ts::next_tx(&mut scenario, CREATOR);
    {
        let mut ch = ts::take_shared_by_id<Cheque<SUI>>(&scenario, cid);
        let c = clock::create_for_testing(ts::ctx(&mut scenario));
        let back = cheque::reclaim<SUI>(&mut ch, &c, ts::ctx(&mut scenario));
        assert!(coin::value(&back) == AMOUNT);
        assert!(cheque::is_claimed(&ch)); // terminal
        coin::burn_for_testing(back);
        clock::destroy_for_testing(c);
        ts::return_shared(ch);
    };
    ts::end(scenario);
}

#[test, expected_failure(abort_code = cheque::E_NOT_CREATOR)]
fun non_creator_reclaim_aborts() {
    let mut scenario = ts::begin(PUBLISHER);
    setup_registry(&mut scenario);
    grant_worker(&mut scenario);
    let cid = fund_cheque(&mut scenario);

    ts::next_tx(&mut scenario, RANDO);
    let mut ch = ts::take_shared_by_id<Cheque<SUI>>(&scenario, cid);
    let c = clock::create_for_testing(ts::ctx(&mut scenario));
    let stolen = cheque::reclaim<SUI>(&mut ch, &c, ts::ctx(&mut scenario));
    coin::burn_for_testing(stolen);
    clock::destroy_for_testing(c);
    ts::return_shared(ch);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = cheque::E_ALREADY_CLAIMED)]
fun reclaim_after_claim_aborts() {
    let mut scenario = ts::begin(PUBLISHER);
    setup_registry(&mut scenario);
    grant_worker(&mut scenario);
    let cid = fund_cheque(&mut scenario);

    // Worker claims first.
    ts::next_tx(&mut scenario, WORKER);
    {
        let mut reg = ts::take_shared<ChequeRegistry>(&scenario);
        let mut ch = ts::take_shared_by_id<Cheque<SUI>>(&scenario, cid);
        let mut c = clock::create_for_testing(ts::ctx(&mut scenario));
        clock::set_for_testing(&mut c, EXPIRY - 1);
        cheque::claim<SUI>(&mut reg, &mut ch, CLAIMER, &c, ts::ctx(&mut scenario));
        clock::destroy_for_testing(c);
        ts::return_shared(ch);
        ts::return_shared(reg);
    };

    // Creator's reclaim must now abort — funds already went to CLAIMER.
    ts::next_tx(&mut scenario, CREATOR);
    let mut ch = ts::take_shared_by_id<Cheque<SUI>>(&scenario, cid);
    let c = clock::create_for_testing(ts::ctx(&mut scenario));
    let dbl = cheque::reclaim<SUI>(&mut ch, &c, ts::ctx(&mut scenario));
    coin::burn_for_testing(dbl);
    clock::destroy_for_testing(c);
    ts::return_shared(ch);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = cheque::E_ALREADY_CLAIMED)]
fun claim_after_reclaim_aborts() {
    let mut scenario = ts::begin(PUBLISHER);
    setup_registry(&mut scenario);
    grant_worker(&mut scenario);
    let cid = fund_cheque(&mut scenario);

    // Creator voids it first.
    ts::next_tx(&mut scenario, CREATOR);
    {
        let mut ch = ts::take_shared_by_id<Cheque<SUI>>(&scenario, cid);
        let c = clock::create_for_testing(ts::ctx(&mut scenario));
        let back = cheque::reclaim<SUI>(&mut ch, &c, ts::ctx(&mut scenario));
        coin::burn_for_testing(back);
        clock::destroy_for_testing(c);
        ts::return_shared(ch);
    };

    // Worker claim must now abort — cheque is terminal.
    ts::next_tx(&mut scenario, WORKER);
    let mut reg = ts::take_shared<ChequeRegistry>(&scenario);
    let mut ch = ts::take_shared_by_id<Cheque<SUI>>(&scenario, cid);
    let mut c = clock::create_for_testing(ts::ctx(&mut scenario));
    clock::set_for_testing(&mut c, EXPIRY - 1);
    cheque::claim<SUI>(&mut reg, &mut ch, CLAIMER, &c, ts::ctx(&mut scenario));
    clock::destroy_for_testing(c);
    ts::return_shared(ch);
    ts::return_shared(reg);
    ts::end(scenario);
}

// ───────────────────────────────────────────────────────────────────
// create input validation

#[test, expected_failure(abort_code = cheque::E_ZERO_AMOUNT)]
fun create_rejects_zero_funds() {
    let mut scenario = ts::begin(PUBLISHER);
    setup_registry(&mut scenario);

    ts::next_tx(&mut scenario, CREATOR);
    let mut reg = ts::take_shared<ChequeRegistry>(&scenario);
    let c = clock::create_for_testing(ts::ctx(&mut scenario));
    let funds = balance::zero<SUI>();
    let _cid = cheque::create<SUI>(&mut reg, funds, EXPIRY, &c, ts::ctx(&mut scenario));
    clock::destroy_for_testing(c);
    ts::return_shared(reg);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = cheque::E_BAD_EXPIRY)]
fun create_rejects_past_expiry() {
    let mut scenario = ts::begin(PUBLISHER);
    setup_registry(&mut scenario);

    ts::next_tx(&mut scenario, CREATOR);
    let mut reg = ts::take_shared<ChequeRegistry>(&scenario);
    let mut c = clock::create_for_testing(ts::ctx(&mut scenario));
    clock::set_for_testing(&mut c, 50_000);
    let funds = coin::into_balance(coin::mint_for_testing<SUI>(AMOUNT, ts::ctx(&mut scenario)));
    // expiry 40_000 < now 50_000 → abort.
    let _cid = cheque::create<SUI>(&mut reg, funds, 40_000, &c, ts::ctx(&mut scenario));
    clock::destroy_for_testing(c);
    ts::return_shared(reg);
    ts::end(scenario);
}

// ───────────────────────────────────────────────────────────────────
// Worker management

#[test]
fun remove_worker_revokes_claim_ability() {
    let mut scenario = ts::begin(PUBLISHER);
    setup_registry(&mut scenario);
    grant_worker(&mut scenario);

    ts::next_tx(&mut scenario, PUBLISHER);
    let cap = ts::take_from_sender<ChequeAdminCap>(&scenario);
    let mut reg = ts::take_shared<ChequeRegistry>(&scenario);
    assert!(cheque::is_worker(&reg, WORKER));
    cheque::remove_worker(&cap, &mut reg, WORKER);
    assert!(!cheque::is_worker(&reg, WORKER));
    ts::return_shared(reg);
    ts::return_to_sender(&scenario, cap);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = cheque::E_WORKER_ALREADY_ADDED)]
fun add_worker_twice_aborts() {
    let mut scenario = ts::begin(PUBLISHER);
    setup_registry(&mut scenario);

    ts::next_tx(&mut scenario, PUBLISHER);
    let cap = ts::take_from_sender<ChequeAdminCap>(&scenario);
    let mut reg = ts::take_shared<ChequeRegistry>(&scenario);
    cheque::add_worker(&cap, &mut reg, WORKER);
    cheque::add_worker(&cap, &mut reg, WORKER);
    ts::return_shared(reg);
    ts::return_to_sender(&scenario, cap);
    ts::end(scenario);
}
