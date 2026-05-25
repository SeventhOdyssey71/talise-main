/// Sanity tests for the auto-swap consent + bounds surface. These
/// don't exercise Cetus or the actual swap math — that's E2E territory
/// — they just verify the on-chain rules: cap must match vault, must
/// not be paused, must not be expired, must be invoked by admin, and
/// amount must fit under the cap.
#[test_only]
module talise::auto_swap_tests;

use sui::test_scenario as ts;
use sui::clock;
use sui::coin;
use sui::sui::SUI;

use talise::auto_swap::{Self, AutoSwapRegistry};
use talise::vault::{Self, TaliseVault};

const PUBLISHER: address = @0xA;
const USER: address = @0xB;
const WORKER: address = @0xA;  // same as publisher in v1 — admin == publisher
const RANDO: address = @0xC;

/// Helper: run the auto_swap module init to create the shared Registry
/// + transfer AdminCap to PUBLISHER. test_scenario lets us run `init`
/// for the package under test.
fun setup_registry(scenario: &mut ts::Scenario) {
    ts::next_tx(scenario, PUBLISHER);
    auto_swap::test_init(ts::ctx(scenario));
}

#[test]
fun enable_then_disable_round_trip() {
    let mut scenario = ts::begin(PUBLISHER);
    setup_registry(&mut scenario);

    // User creates a vault.
    ts::next_tx(&mut scenario, USER);
    vault::create(ts::ctx(&mut scenario));

    // Pull the vault id back out so the cap can hardwire to it.
    ts::next_tx(&mut scenario, USER);
    let vault = ts::take_shared<TaliseVault>(&scenario);
    let vault_id = object::id(&vault);

    // Enable auto-swap for SUI with a 10 SUI per-swap cap, no expiry.
    auto_swap::enable<SUI>(
        vault_id,
        10_000_000_000, // 10 SUI in mist
        0,              // no expiry
        ts::ctx(&mut scenario),
    );
    ts::return_shared(vault);

    // The user should now own an AutoSwapCap<SUI>.
    ts::next_tx(&mut scenario, USER);
    let cap = ts::take_from_sender<auto_swap::AutoSwapCap<SUI>>(&scenario);
    assert!(auto_swap::cap_vault(&cap) == vault_id, 0);
    assert!(auto_swap::cap_owner(&cap) == USER, 1);
    assert!(auto_swap::cap_max(&cap) == 10_000_000_000, 2);
    assert!(!auto_swap::cap_paused(&cap), 3);

    // Burn it.
    auto_swap::disable<SUI>(cap, ts::ctx(&mut scenario));

    // After disable, the user should hold no AutoSwapCap<SUI>.
    ts::next_tx(&mut scenario, USER);
    assert!(!ts::has_most_recent_for_address<auto_swap::AutoSwapCap<SUI>>(USER), 4);

    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = auto_swap::E_AMOUNT_EXCEEDS_CAP)]
fun validate_rejects_amount_over_cap() {
    let mut scenario = ts::begin(PUBLISHER);
    setup_registry(&mut scenario);

    ts::next_tx(&mut scenario, USER);
    vault::create(ts::ctx(&mut scenario));
    ts::next_tx(&mut scenario, USER);
    let vault = ts::take_shared<TaliseVault>(&scenario);
    let vault_id = object::id(&vault);
    auto_swap::enable<SUI>(vault_id, 100, 0, ts::ctx(&mut scenario));
    ts::return_shared(vault);

    ts::next_tx(&mut scenario, USER);
    let cap = ts::take_from_sender<auto_swap::AutoSwapCap<SUI>>(&scenario);

    // Worker tries to swap 1000 against a cap of 100 → should abort.
    ts::next_tx(&mut scenario, WORKER);
    let mut registry = ts::take_shared<AutoSwapRegistry>(&scenario);
    auto_swap::validate_for_swap<SUI>(&mut registry, &cap, 1000, 0, WORKER);
    ts::return_shared(registry);

    ts::return_to_sender(&scenario, cap);
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = auto_swap::E_WRONG_ADMIN)]
fun validate_rejects_non_admin_sender() {
    let mut scenario = ts::begin(PUBLISHER);
    setup_registry(&mut scenario);

    ts::next_tx(&mut scenario, USER);
    vault::create(ts::ctx(&mut scenario));
    ts::next_tx(&mut scenario, USER);
    let vault = ts::take_shared<TaliseVault>(&scenario);
    let vault_id = object::id(&vault);
    auto_swap::enable<SUI>(vault_id, 10_000_000_000, 0, ts::ctx(&mut scenario));
    ts::return_shared(vault);

    ts::next_tx(&mut scenario, USER);
    let cap = ts::take_from_sender<auto_swap::AutoSwapCap<SUI>>(&scenario);

    // RANDO is not the admin → should abort.
    ts::next_tx(&mut scenario, RANDO);
    let mut registry = ts::take_shared<AutoSwapRegistry>(&scenario);
    auto_swap::validate_for_swap<SUI>(&mut registry, &cap, 100, 0, RANDO);
    ts::return_shared(registry);

    ts::return_to_sender(&scenario, cap);
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = auto_swap::E_CAP_PAUSED)]
fun validate_rejects_paused_cap() {
    let mut scenario = ts::begin(PUBLISHER);
    setup_registry(&mut scenario);

    ts::next_tx(&mut scenario, USER);
    vault::create(ts::ctx(&mut scenario));
    ts::next_tx(&mut scenario, USER);
    let vault = ts::take_shared<TaliseVault>(&scenario);
    let vault_id = object::id(&vault);
    auto_swap::enable<SUI>(vault_id, 10_000_000_000, 0, ts::ctx(&mut scenario));
    ts::return_shared(vault);

    ts::next_tx(&mut scenario, USER);
    let mut cap = ts::take_from_sender<auto_swap::AutoSwapCap<SUI>>(&scenario);
    auto_swap::pause<SUI>(&mut cap, ts::ctx(&mut scenario));

    ts::next_tx(&mut scenario, WORKER);
    let mut registry = ts::take_shared<AutoSwapRegistry>(&scenario);
    auto_swap::validate_for_swap<SUI>(&mut registry, &cap, 100, 0, WORKER);
    ts::return_shared(registry);

    ts::return_to_sender(&scenario, cap);
    ts::end(scenario);
}

#[test]
fun deposit_and_withdraw_round_trip() {
    let mut scenario = ts::begin(PUBLISHER);
    setup_registry(&mut scenario);

    // User creates vault.
    ts::next_tx(&mut scenario, USER);
    vault::create(ts::ctx(&mut scenario));

    // RANDO mints fake SUI and deposits it. Anyone can deposit.
    ts::next_tx(&mut scenario, RANDO);
    let mut v = ts::take_shared<TaliseVault>(&scenario);
    let c = coin::mint_for_testing<SUI>(5_000_000, ts::ctx(&mut scenario));
    vault::deposit<SUI>(&mut v, c, ts::ctx(&mut scenario));
    assert!(vault::balance_of<SUI>(&v) == 5_000_000, 0);
    ts::return_shared(v);

    // USER withdraws 2_000_000.
    ts::next_tx(&mut scenario, USER);
    let mut v2 = ts::take_shared<TaliseVault>(&scenario);
    let withdrawn = vault::withdraw<SUI>(&mut v2, 2_000_000, ts::ctx(&mut scenario));
    assert!(coin::value(&withdrawn) == 2_000_000, 1);
    assert!(vault::balance_of<SUI>(&v2) == 3_000_000, 2);
    coin::burn_for_testing(withdrawn);
    ts::return_shared(v2);

    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = vault::E_NOT_OWNER)]
fun rando_cannot_withdraw() {
    let mut scenario = ts::begin(PUBLISHER);
    setup_registry(&mut scenario);

    ts::next_tx(&mut scenario, USER);
    vault::create(ts::ctx(&mut scenario));

    ts::next_tx(&mut scenario, USER);
    let mut v = ts::take_shared<TaliseVault>(&scenario);
    let c = coin::mint_for_testing<SUI>(5_000_000, ts::ctx(&mut scenario));
    vault::deposit<SUI>(&mut v, c, ts::ctx(&mut scenario));
    ts::return_shared(v);

    // RANDO tries to withdraw — abort.
    ts::next_tx(&mut scenario, RANDO);
    let mut v2 = ts::take_shared<TaliseVault>(&scenario);
    let stolen = vault::withdraw<SUI>(&mut v2, 1, ts::ctx(&mut scenario));
    coin::burn_for_testing(stolen);
    ts::return_shared(v2);

    ts::end(scenario);
}
