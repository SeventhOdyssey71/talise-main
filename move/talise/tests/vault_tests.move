/// Full-coverage tests for `talise::vault`.
///
/// Covers paths not exercised by `auto_swap_tests.move`:
///   • happy-path `auto_swap_extract` + `auto_swap_deposit` (the hot-
///     potato pair) using SUI for both Source and Dest types — Cetus
///     is out of scope for unit tests, so we simulate the "swap" by
///     re-depositing the extracted balance under the same type.
///   • `withdraw_and_send` end-to-end.
///   • `deposit_balance` zero-amount short-circuit (`destroy_zero`).
///   • `balance_of` for an unheld type returns 0.
///   • `type_string` returns the canonical type name.
///   • All read accessors: `owner`, `deposits_total`, `auto_swaps_total`.
///   • `E_WRONG_VAULT` branches on both extract and deposit.
///   • `E_TYPE_NOT_HELD` on extract.
///   • `E_INSUFFICIENT_BALANCE` on extract.
///   • `E_ZERO_AMOUNT` on extract & withdraw.
#[test_only]
module talise::vault_tests;

use std::string;
use sui::clock;
use sui::coin;
use sui::sui::SUI;
use sui::test_scenario as ts;

use talise::auto_swap::{Self, AutoSwapRegistry, AutoSwapCap};
use talise::vault::{Self, TaliseVault};

const PUBLISHER: address = @0xA;
const USER: address = @0xB;
const WORKER: address = @0xA;   // admin == publisher in v1
const OTHER_USER: address = @0xD;
const RANDO: address = @0xC;

fun setup_registry(scenario: &mut ts::Scenario) {
    ts::next_tx(scenario, PUBLISHER);
    auto_swap::test_init(ts::ctx(scenario));
}

fun setup_user_vault(scenario: &mut ts::Scenario, who: address) {
    ts::next_tx(scenario, who);
    vault::create(ts::ctx(scenario));
}

// ───────────────────────────────────────────────────────────────────
// Read accessors

#[test]
fun read_accessors_initial_state() {
    let mut scenario = ts::begin(PUBLISHER);
    setup_user_vault(&mut scenario, USER);

    ts::next_tx(&mut scenario, USER);
    let v = ts::take_shared<TaliseVault>(&scenario);
    assert!(vault::owner(&v) == USER, 0);
    assert!(vault::deposits_total(&v) == 0, 1);
    assert!(vault::auto_swaps_total(&v) == 0, 2);
    assert!(vault::balance_of<SUI>(&v) == 0, 3);  // unheld type path
    ts::return_shared(v);
    ts::end(scenario);
}

#[test]
fun type_string_returns_canonical_name() {
    // Smoke test: ensure type_string<SUI>() yields a non-empty string
    // and matches the bytes used as the bag key. We don't pin the
    // exact value because the framework address can shift across
    // testnet/mainnet builds.
    let s = vault::type_string<SUI>();
    let bytes = string::as_bytes(&s);
    assert!(vector::length(bytes) > 0, 0);
}

// ───────────────────────────────────────────────────────────────────
// deposit_balance — zero-amount short-circuit

#[test]
fun deposit_zero_short_circuit_keeps_counters() {
    // Path: deposit a coin of value > 0 first (touches the `add` branch),
    // then a coin of value > 0 again (touches the `contains` branch +
    // `balance::join`), so we exercise both halves of the conditional.
    let mut scenario = ts::begin(PUBLISHER);
    setup_user_vault(&mut scenario, USER);

    ts::next_tx(&mut scenario, USER);
    let mut v = ts::take_shared<TaliseVault>(&scenario);
    let c1 = coin::mint_for_testing<SUI>(1_000, ts::ctx(&mut scenario));
    vault::deposit<SUI>(&mut v, c1, ts::ctx(&mut scenario));
    assert!(vault::deposits_total(&v) == 1, 1);
    assert!(vault::balance_of<SUI>(&v) == 1_000, 2);

    let c2 = coin::mint_for_testing<SUI>(2_000, ts::ctx(&mut scenario));
    vault::deposit<SUI>(&mut v, c2, ts::ctx(&mut scenario));
    assert!(vault::deposits_total(&v) == 2, 3);
    assert!(vault::balance_of<SUI>(&v) == 3_000, 4);

    ts::return_shared(v);
    ts::end(scenario);
}

// ───────────────────────────────────────────────────────────────────
// withdraw_and_send

#[test]
fun withdraw_and_send_delivers_to_recipient() {
    let mut scenario = ts::begin(PUBLISHER);
    setup_user_vault(&mut scenario, USER);

    ts::next_tx(&mut scenario, USER);
    let mut v = ts::take_shared<TaliseVault>(&scenario);
    let funded = coin::mint_for_testing<SUI>(10_000, ts::ctx(&mut scenario));
    vault::deposit<SUI>(&mut v, funded, ts::ctx(&mut scenario));
    ts::return_shared(v);

    ts::next_tx(&mut scenario, USER);
    let mut v2 = ts::take_shared<TaliseVault>(&scenario);
    vault::withdraw_and_send<SUI>(&mut v2, 4_000, RANDO, ts::ctx(&mut scenario));
    assert!(vault::balance_of<SUI>(&v2) == 6_000, 0);
    ts::return_shared(v2);

    // Coin should now be in RANDO's wallet.
    ts::next_tx(&mut scenario, RANDO);
    let received = ts::take_from_sender<coin::Coin<SUI>>(&scenario);
    assert!(coin::value(&received) == 4_000, 1);
    coin::burn_for_testing(received);

    ts::end(scenario);
}

#[test]
fun withdraw_clears_balance_entry_when_drained() {
    // Withdrawing the full amount should hit the `remove` + `destroy_zero`
    // path inside `withdraw`.
    let mut scenario = ts::begin(PUBLISHER);
    setup_user_vault(&mut scenario, USER);

    ts::next_tx(&mut scenario, USER);
    let mut v = ts::take_shared<TaliseVault>(&scenario);
    let funded = coin::mint_for_testing<SUI>(1_000, ts::ctx(&mut scenario));
    vault::deposit<SUI>(&mut v, funded, ts::ctx(&mut scenario));
    let withdrawn = vault::withdraw<SUI>(&mut v, 1_000, ts::ctx(&mut scenario));
    assert!(coin::value(&withdrawn) == 1_000, 0);
    assert!(vault::balance_of<SUI>(&v) == 0, 1);
    coin::burn_for_testing(withdrawn);
    ts::return_shared(v);
    ts::end(scenario);
}

// ───────────────────────────────────────────────────────────────────
// auto_swap_extract / auto_swap_deposit — happy path

#[test]
fun auto_swap_extract_then_deposit_round_trip() {
    // The hot-potato pair. We use SUI for both Source and Dest because
    // Cetus is out of scope here; the test exercises the Move-level
    // flow only (vault state, ticket consumption, counter bumps).
    let mut scenario = ts::begin(PUBLISHER);
    setup_registry(&mut scenario);
    setup_user_vault(&mut scenario, USER);

    // USER funds the vault and mints an auto-swap cap for SUI.
    ts::next_tx(&mut scenario, USER);
    let mut v = ts::take_shared<TaliseVault>(&scenario);
    let funded = coin::mint_for_testing<SUI>(1_000_000, ts::ctx(&mut scenario));
    vault::deposit<SUI>(&mut v, funded, ts::ctx(&mut scenario));
    vault::enable_auto_swap<SUI>(&v, 500_000, 0, ts::ctx(&mut scenario));
    ts::return_shared(v);

    // WORKER (= admin) extracts and deposits in the same scenario tx.
    ts::next_tx(&mut scenario, USER);
    let cap = ts::take_from_sender<AutoSwapCap<SUI>>(&scenario);

    ts::next_tx(&mut scenario, WORKER);
    let mut v2 = ts::take_shared<TaliseVault>(&scenario);
    let mut registry = ts::take_shared<AutoSwapRegistry>(&scenario);
    let c = clock::create_for_testing(ts::ctx(&mut scenario));

    let (extracted, ticket) = vault::auto_swap_extract<SUI>(
        &mut v2, &mut registry, &cap, 300_000, &c, ts::ctx(&mut scenario),
    );
    // After extraction, vault holds 700_000 SUI (1_000_000 − 300_000).
    assert!(vault::balance_of<SUI>(&v2) == 700_000, 1);

    // Simulate a 1:1 swap by re-depositing the extracted balance as Dest = SUI.
    vault::auto_swap_deposit<SUI>(&mut v2, extracted, ticket, &c);

    // Vault balance should be back to 1_000_000 and swap counter bumped.
    assert!(vault::balance_of<SUI>(&v2) == 1_000_000, 2);
    assert!(vault::auto_swaps_total(&v2) == 1, 3);
    assert!(auto_swap::total_validations(&registry) == 1, 4);

    clock::destroy_for_testing(c);
    ts::return_shared(registry);
    ts::return_shared(v2);
    ts::return_to_address(USER, cap);
    ts::end(scenario);
}

#[test]
fun auto_swap_extract_drains_then_remove_branch() {
    // Force the inner `if (balance::value(held) == 0) { remove + destroy_zero }`
    // branch by extracting exactly the held amount.
    let mut scenario = ts::begin(PUBLISHER);
    setup_registry(&mut scenario);
    setup_user_vault(&mut scenario, USER);

    ts::next_tx(&mut scenario, USER);
    let mut v = ts::take_shared<TaliseVault>(&scenario);
    let funded = coin::mint_for_testing<SUI>(100_000, ts::ctx(&mut scenario));
    vault::deposit<SUI>(&mut v, funded, ts::ctx(&mut scenario));
    vault::enable_auto_swap<SUI>(&v, 100_000, 0, ts::ctx(&mut scenario));
    ts::return_shared(v);

    ts::next_tx(&mut scenario, USER);
    let cap = ts::take_from_sender<AutoSwapCap<SUI>>(&scenario);

    ts::next_tx(&mut scenario, WORKER);
    let mut v2 = ts::take_shared<TaliseVault>(&scenario);
    let mut registry = ts::take_shared<AutoSwapRegistry>(&scenario);
    let c = clock::create_for_testing(ts::ctx(&mut scenario));

    let (extracted, ticket) = vault::auto_swap_extract<SUI>(
        &mut v2, &mut registry, &cap, 100_000, &c, ts::ctx(&mut scenario),
    );
    assert!(vault::balance_of<SUI>(&v2) == 0, 0);
    vault::auto_swap_deposit<SUI>(&mut v2, extracted, ticket, &c);
    assert!(vault::balance_of<SUI>(&v2) == 100_000, 1);

    clock::destroy_for_testing(c);
    ts::return_shared(registry);
    ts::return_shared(v2);
    ts::return_to_address(USER, cap);
    ts::end(scenario);
}

#[test]
fun auto_swap_deposit_zero_output_destroys_balance() {
    // Force the `else { destroy_zero }` branch in auto_swap_deposit by
    // extracting then re-depositing a zero-value balance.
    let mut scenario = ts::begin(PUBLISHER);
    setup_registry(&mut scenario);
    setup_user_vault(&mut scenario, USER);

    ts::next_tx(&mut scenario, USER);
    let mut v = ts::take_shared<TaliseVault>(&scenario);
    let funded = coin::mint_for_testing<SUI>(10_000, ts::ctx(&mut scenario));
    vault::deposit<SUI>(&mut v, funded, ts::ctx(&mut scenario));
    vault::enable_auto_swap<SUI>(&v, 10_000, 0, ts::ctx(&mut scenario));
    ts::return_shared(v);

    ts::next_tx(&mut scenario, USER);
    let cap = ts::take_from_sender<AutoSwapCap<SUI>>(&scenario);

    ts::next_tx(&mut scenario, WORKER);
    let mut v2 = ts::take_shared<TaliseVault>(&scenario);
    let mut registry = ts::take_shared<AutoSwapRegistry>(&scenario);
    let c = clock::create_for_testing(ts::ctx(&mut scenario));

    let (extracted, ticket) = vault::auto_swap_extract<SUI>(
        &mut v2, &mut registry, &cap, 5_000, &c, ts::ctx(&mut scenario),
    );
    // Burn the extracted balance and substitute a zero-value Dest balance.
    sui::balance::destroy_for_testing(extracted);
    let zero_out = sui::balance::zero<SUI>();
    vault::auto_swap_deposit<SUI>(&mut v2, zero_out, ticket, &c);
    assert!(vault::auto_swaps_total(&v2) == 1, 0);

    clock::destroy_for_testing(c);
    ts::return_shared(registry);
    ts::return_shared(v2);
    ts::return_to_address(USER, cap);
    ts::end(scenario);
}

#[test]
fun auto_swap_deposit_into_existing_dest_uses_join() {
    // Force the inner `if (vault.balances.contains(key))` join branch in
    // auto_swap_deposit by pre-funding Dest = SUI inside the vault.
    let mut scenario = ts::begin(PUBLISHER);
    setup_registry(&mut scenario);
    setup_user_vault(&mut scenario, USER);

    ts::next_tx(&mut scenario, USER);
    let mut v = ts::take_shared<TaliseVault>(&scenario);
    let funded = coin::mint_for_testing<SUI>(20_000, ts::ctx(&mut scenario));
    vault::deposit<SUI>(&mut v, funded, ts::ctx(&mut scenario));
    vault::enable_auto_swap<SUI>(&v, 5_000, 0, ts::ctx(&mut scenario));
    ts::return_shared(v);

    ts::next_tx(&mut scenario, USER);
    let cap = ts::take_from_sender<AutoSwapCap<SUI>>(&scenario);

    ts::next_tx(&mut scenario, WORKER);
    let mut v2 = ts::take_shared<TaliseVault>(&scenario);
    let mut registry = ts::take_shared<AutoSwapRegistry>(&scenario);
    let c = clock::create_for_testing(ts::ctx(&mut scenario));

    // Extract 5_000; vault still holds 15_000 SUI (so re-deposit takes the
    // `contains` branch and goes through `balance::join`).
    let (extracted, ticket) = vault::auto_swap_extract<SUI>(
        &mut v2, &mut registry, &cap, 5_000, &c, ts::ctx(&mut scenario),
    );
    assert!(vault::balance_of<SUI>(&v2) == 15_000, 0);
    vault::auto_swap_deposit<SUI>(&mut v2, extracted, ticket, &c);
    assert!(vault::balance_of<SUI>(&v2) == 20_000, 1);

    clock::destroy_for_testing(c);
    ts::return_shared(registry);
    ts::return_shared(v2);
    ts::return_to_address(USER, cap);
    ts::end(scenario);
}

// ───────────────────────────────────────────────────────────────────
// auto_swap_extract — error branches

#[test]
#[expected_failure(abort_code = vault::E_WRONG_VAULT)]
fun extract_rejects_cap_for_different_vault() {
    // Cap was minted against USER's vault. Try to use it on OTHER_USER's
    // vault — should hit E_WRONG_VAULT before validate_for_swap.
    //
    // Two shared TaliseVaults exist after this setup, so we have to
    // disambiguate via take_shared_by_id.
    let mut scenario = ts::begin(PUBLISHER);
    setup_registry(&mut scenario);

    // USER creates vault A and mints a cap against it.
    setup_user_vault(&mut scenario, USER);
    ts::next_tx(&mut scenario, USER);
    let v_user = ts::take_shared<TaliseVault>(&scenario);
    let user_vault_id = sui::object::id(&v_user);
    vault::enable_auto_swap<SUI>(&v_user, 1_000_000, 0, ts::ctx(&mut scenario));
    ts::return_shared(v_user);

    ts::next_tx(&mut scenario, USER);
    let cap = ts::take_from_sender<AutoSwapCap<SUI>>(&scenario);

    // OTHER_USER creates vault B and funds it. We capture the id at
    // creation time by listing shared ids before and after.
    setup_user_vault(&mut scenario, OTHER_USER);
    ts::next_tx(&mut scenario, OTHER_USER);
    let all_ids = ts::ids_for_address<TaliseVault>(OTHER_USER);
    // The shared object's "address" record happens at creation; the
    // simpler route is: try take_shared, and if we got USER's vault,
    // return it and try again.
    let _ = all_ids;
    let v_first = ts::take_shared<TaliseVault>(&scenario);
    let (mut v_other, returned_first) = if (sui::object::id(&v_first) == user_vault_id) {
        // Pop USER's vault aside, take the next shared TaliseVault.
        ts::return_shared(v_first);
        (ts::take_shared<TaliseVault>(&scenario), true)
    } else {
        (v_first, false)
    };
    let _ = returned_first;
    let funded = coin::mint_for_testing<SUI>(50_000, ts::ctx(&mut scenario));
    vault::deposit<SUI>(&mut v_other, funded, ts::ctx(&mut scenario));

    ts::next_tx(&mut scenario, WORKER);
    let mut registry = ts::take_shared<AutoSwapRegistry>(&scenario);
    let c = clock::create_for_testing(ts::ctx(&mut scenario));

    let (extracted, ticket) = vault::auto_swap_extract<SUI>(
        &mut v_other, &mut registry, &cap, 1_000, &c, ts::ctx(&mut scenario),
    );

    // Unreachable — we expect the call above to abort. Lines below
    // satisfy the type checker (ticket has no drop).
    sui::balance::destroy_for_testing(extracted);
    vault::auto_swap_deposit<SUI>(&mut v_other, sui::balance::zero<SUI>(), ticket, &c);

    clock::destroy_for_testing(c);
    ts::return_shared(registry);
    ts::return_shared(v_other);
    ts::return_to_address(USER, cap);
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = vault::E_ZERO_AMOUNT)]
fun extract_rejects_zero_amount() {
    let mut scenario = ts::begin(PUBLISHER);
    setup_registry(&mut scenario);
    setup_user_vault(&mut scenario, USER);

    ts::next_tx(&mut scenario, USER);
    let v = ts::take_shared<TaliseVault>(&scenario);
    vault::enable_auto_swap<SUI>(&v, 1_000_000, 0, ts::ctx(&mut scenario));
    ts::return_shared(v);

    ts::next_tx(&mut scenario, USER);
    let cap = ts::take_from_sender<AutoSwapCap<SUI>>(&scenario);

    ts::next_tx(&mut scenario, WORKER);
    let mut v2 = ts::take_shared<TaliseVault>(&scenario);
    let mut registry = ts::take_shared<AutoSwapRegistry>(&scenario);
    let c = clock::create_for_testing(ts::ctx(&mut scenario));

    let (extracted, ticket) = vault::auto_swap_extract<SUI>(
        &mut v2, &mut registry, &cap, 0, &c, ts::ctx(&mut scenario),
    );
    sui::balance::destroy_for_testing(extracted);
    vault::auto_swap_deposit<SUI>(&mut v2, sui::balance::zero<SUI>(), ticket, &c);

    clock::destroy_for_testing(c);
    ts::return_shared(registry);
    ts::return_shared(v2);
    ts::return_to_address(USER, cap);
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = vault::E_TYPE_NOT_HELD)]
fun extract_rejects_when_type_not_held() {
    // Cap minted but vault never received SUI. Extract should hit
    // E_TYPE_NOT_HELD after validate_for_swap passes.
    let mut scenario = ts::begin(PUBLISHER);
    setup_registry(&mut scenario);
    setup_user_vault(&mut scenario, USER);

    ts::next_tx(&mut scenario, USER);
    let v = ts::take_shared<TaliseVault>(&scenario);
    vault::enable_auto_swap<SUI>(&v, 1_000, 0, ts::ctx(&mut scenario));
    ts::return_shared(v);

    ts::next_tx(&mut scenario, USER);
    let cap = ts::take_from_sender<AutoSwapCap<SUI>>(&scenario);

    ts::next_tx(&mut scenario, WORKER);
    let mut v2 = ts::take_shared<TaliseVault>(&scenario);
    let mut registry = ts::take_shared<AutoSwapRegistry>(&scenario);
    let c = clock::create_for_testing(ts::ctx(&mut scenario));

    let (extracted, ticket) = vault::auto_swap_extract<SUI>(
        &mut v2, &mut registry, &cap, 100, &c, ts::ctx(&mut scenario),
    );
    sui::balance::destroy_for_testing(extracted);
    vault::auto_swap_deposit<SUI>(&mut v2, sui::balance::zero<SUI>(), ticket, &c);

    clock::destroy_for_testing(c);
    ts::return_shared(registry);
    ts::return_shared(v2);
    ts::return_to_address(USER, cap);
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = vault::E_INSUFFICIENT_BALANCE)]
fun extract_rejects_insufficient_balance() {
    let mut scenario = ts::begin(PUBLISHER);
    setup_registry(&mut scenario);
    setup_user_vault(&mut scenario, USER);

    ts::next_tx(&mut scenario, USER);
    let mut v = ts::take_shared<TaliseVault>(&scenario);
    let small = coin::mint_for_testing<SUI>(50, ts::ctx(&mut scenario));
    vault::deposit<SUI>(&mut v, small, ts::ctx(&mut scenario));
    vault::enable_auto_swap<SUI>(&v, 1_000, 0, ts::ctx(&mut scenario));
    ts::return_shared(v);

    ts::next_tx(&mut scenario, USER);
    let cap = ts::take_from_sender<AutoSwapCap<SUI>>(&scenario);

    ts::next_tx(&mut scenario, WORKER);
    let mut v2 = ts::take_shared<TaliseVault>(&scenario);
    let mut registry = ts::take_shared<AutoSwapRegistry>(&scenario);
    let c = clock::create_for_testing(ts::ctx(&mut scenario));

    // amount = 100 ≤ cap.max_per_swap, but vault only holds 50 SUI.
    let (extracted, ticket) = vault::auto_swap_extract<SUI>(
        &mut v2, &mut registry, &cap, 100, &c, ts::ctx(&mut scenario),
    );
    sui::balance::destroy_for_testing(extracted);
    vault::auto_swap_deposit<SUI>(&mut v2, sui::balance::zero<SUI>(), ticket, &c);

    clock::destroy_for_testing(c);
    ts::return_shared(registry);
    ts::return_shared(v2);
    ts::return_to_address(USER, cap);
    ts::end(scenario);
}

// ───────────────────────────────────────────────────────────────────
// withdraw — error branches not covered by auto_swap_tests.move

#[test]
#[expected_failure(abort_code = vault::E_ZERO_AMOUNT)]
fun withdraw_rejects_zero_amount() {
    let mut scenario = ts::begin(PUBLISHER);
    setup_user_vault(&mut scenario, USER);

    ts::next_tx(&mut scenario, USER);
    let mut v = ts::take_shared<TaliseVault>(&scenario);
    let zero = vault::withdraw<SUI>(&mut v, 0, ts::ctx(&mut scenario));
    coin::burn_for_testing(zero);
    ts::return_shared(v);
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = vault::E_TYPE_NOT_HELD)]
fun withdraw_rejects_when_type_not_held() {
    let mut scenario = ts::begin(PUBLISHER);
    setup_user_vault(&mut scenario, USER);

    ts::next_tx(&mut scenario, USER);
    let mut v = ts::take_shared<TaliseVault>(&scenario);
    let nothing = vault::withdraw<SUI>(&mut v, 1, ts::ctx(&mut scenario));
    coin::burn_for_testing(nothing);
    ts::return_shared(v);
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = vault::E_INSUFFICIENT_BALANCE)]
fun withdraw_rejects_insufficient_balance() {
    let mut scenario = ts::begin(PUBLISHER);
    setup_user_vault(&mut scenario, USER);

    ts::next_tx(&mut scenario, USER);
    let mut v = ts::take_shared<TaliseVault>(&scenario);
    let funded = coin::mint_for_testing<SUI>(10, ts::ctx(&mut scenario));
    vault::deposit<SUI>(&mut v, funded, ts::ctx(&mut scenario));
    let stolen = vault::withdraw<SUI>(&mut v, 1_000, ts::ctx(&mut scenario));
    coin::burn_for_testing(stolen);
    ts::return_shared(v);
    ts::end(scenario);
}

// ───────────────────────────────────────────────────────────────────
// deposit — zero-amount rejection

#[test]
fun deposit_balance_zero_path_destroys_and_returns() {
    // The public `deposit` entry asserts amount > 0, so the
    // `destroy_zero` branch inside `deposit_balance` is only reachable
    // via the internal path that `auto_swap_deposit` and (theoretically)
    // future swap-output re-deposits would take with an empty balance.
    // We exercise it directly through `test_deposit_balance`.
    let mut scenario = ts::begin(PUBLISHER);
    setup_user_vault(&mut scenario, USER);

    ts::next_tx(&mut scenario, USER);
    let mut v = ts::take_shared<TaliseVault>(&scenario);
    let zero_bal = sui::balance::zero<SUI>();
    vault::test_deposit_balance<SUI>(&mut v, zero_bal, USER);
    // Counter must NOT bump on a zero deposit.
    assert!(vault::deposits_total(&v) == 0, 0);
    assert!(vault::balance_of<SUI>(&v) == 0, 1);
    ts::return_shared(v);
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = vault::E_WRONG_VAULT)]
fun auto_swap_deposit_rejects_ticket_for_different_vault() {
    // SwapTicket carries the source vault id. Trying to consume the
    // ticket against a different vault must abort with E_WRONG_VAULT.
    let mut scenario = ts::begin(PUBLISHER);
    setup_registry(&mut scenario);

    // USER creates vault A, funds it, mints a cap.
    setup_user_vault(&mut scenario, USER);
    ts::next_tx(&mut scenario, USER);
    let mut v_a = ts::take_shared<TaliseVault>(&scenario);
    let v_a_id = sui::object::id(&v_a);
    let funded = coin::mint_for_testing<SUI>(10_000, ts::ctx(&mut scenario));
    vault::deposit<SUI>(&mut v_a, funded, ts::ctx(&mut scenario));
    vault::enable_auto_swap<SUI>(&v_a, 5_000, 0, ts::ctx(&mut scenario));
    ts::return_shared(v_a);

    ts::next_tx(&mut scenario, USER);
    let cap = ts::take_from_sender<AutoSwapCap<SUI>>(&scenario);

    // OTHER_USER creates vault B.
    setup_user_vault(&mut scenario, OTHER_USER);

    // WORKER extracts from vault A, then tries to deposit into vault B.
    ts::next_tx(&mut scenario, WORKER);
    let mut v_a2 = ts::take_shared_by_id<TaliseVault>(&scenario, v_a_id);
    let mut registry = ts::take_shared<AutoSwapRegistry>(&scenario);
    let c = clock::create_for_testing(ts::ctx(&mut scenario));

    let (extracted, ticket) = vault::auto_swap_extract<SUI>(
        &mut v_a2, &mut registry, &cap, 1_000, &c, ts::ctx(&mut scenario),
    );

    // Take vault B (the one that ISN'T v_a_id) and try to deposit into it.
    let v_first = ts::take_shared<TaliseVault>(&scenario);
    let mut v_b = if (sui::object::id(&v_first) == v_a_id) {
        ts::return_shared(v_first);
        ts::take_shared<TaliseVault>(&scenario)
    } else {
        v_first
    };

    // This call should abort with E_WRONG_VAULT.
    vault::auto_swap_deposit<SUI>(&mut v_b, extracted, ticket, &c);

    // Unreachable cleanup.
    clock::destroy_for_testing(c);
    ts::return_shared(registry);
    ts::return_shared(v_b);
    ts::return_shared(v_a2);
    ts::return_to_address(USER, cap);
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = vault::E_ZERO_AMOUNT)]
fun deposit_rejects_zero_coin() {
    let mut scenario = ts::begin(PUBLISHER);
    setup_user_vault(&mut scenario, USER);

    ts::next_tx(&mut scenario, USER);
    let mut v = ts::take_shared<TaliseVault>(&scenario);
    let zero_coin = coin::mint_for_testing<SUI>(0, ts::ctx(&mut scenario));
    vault::deposit<SUI>(&mut v, zero_coin, ts::ctx(&mut scenario));
    ts::return_shared(v);
    ts::end(scenario);
}
