# 05. Move testing

The Talise package ships 66 Move tests, all passing under
`sui move test`. Tests live in `move/talise/tests/` and cover both the
v1 surface and the v7 hardening surface.

## File layout

| File | Tests | Covers |
|---|---|---|
| `move/talise/tests/auto_swap_tests.move` | 18 | v1 cap lifecycle (enable / disable / pause / resume / update_bounds), `validate_for_swap` aborts (wrong admin, expired, paused, over-cap), owner-only mutation guards, basic deposit/withdraw round-trips. |
| `move/talise/tests/vault_tests.move` | 22 | Full vault coverage: deposit, withdraw, withdraw_and_send, hot-potato extract/deposit round-trip, `auto_swap_deposit_to_owner` (v4: routes output to owner, flushes stale bag balance, `E_WRONG_VAULT` rejection), all error branches (`E_TYPE_NOT_HELD`, `E_INSUFFICIENT_BALANCE`, `E_ZERO_AMOUNT`, `E_WRONG_VAULT`), read accessors, `type_string`. |
| `move/talise/tests/v7_tests.move` | 21 | v7 surface: bootstrap, role grant/revoke, admin rotation 2-step + 48h delay + cancel + wrong-acceptor + before-delay aborts, pause/unpause (admin path, oncall path, treasury cannot pause), dest-type allowlist add/remove and assertion, `validate_for_swap_v2` happy path + all abort cases (registry paused, non-worker, over-per-swap, daily budget exceeded, day-rollover resets `used_today`), `upgrade_cap_to_v2` happy path + non-owner abort. |
| `move/talise/tests/receipt_tests.move` | 2 | Receipt mint + Display init. |
| `move/talise/tests/send_tests.move` | 3 | `send<T>` atomic transfer + receipt mint, memo length check, zero-amount abort. |

Total `#[test]` and `#[test, expected_failure(...)]` annotations: 66.

## Running tests

From `move/talise/`:

```bash
sui move test
```

With coverage:

```bash
sui move test --coverage
sui move coverage summary
```

Coverage was 100% at v2. The v7 additions added 21 tests; the v6
accumulator-to-owner path is exercised on testnet rather than in unit
tests because it requires the framework accumulator subsystem.

## Key test patterns

### `test_scenario` for multi-tx flows

All tests use `sui::test_scenario` to simulate sequential transactions
under different senders:

```move
let mut scenario = ts::begin(PUBLISHER);
setup_v7(&mut scenario);       // PUBLISHER signs bootstrap_v7
setup_user_vault(&mut scenario); // USER signs vault::create

ts::next_tx(&mut scenario, USER);
let v = ts::take_shared<TaliseVault>(&scenario);
vault::enable_auto_swap_v2<SUI>(&v, max_per_swap, max_per_day, 0, &c, ts::ctx(&mut scenario));
ts::return_shared(v);

ts::next_tx(&mut scenario, PUBLISHER);  // PUBLISHER is also the initial Worker
let mut r = ts::take_shared<AutoSwapRegistryV2>(&scenario);
// ...
ts::end(scenario);
```

Tests address constants follow a convention:

```move
const PUBLISHER: address = @0xA;
const USER: address     = @0xB;
const RANDO: address    = @0xC;  // always-unauthorized actor
const TREASURY: address = @0xD;
const ONCALL: address   = @0xE;
const WORKER2: address  = @0xF;
```

### `take_shared` for shared objects

Vaults, registries, and v3+ caps are all shared. Tests take them via
`ts::take_shared<T>(&scenario)` and return via `ts::return_shared(obj)`.
After a `disable` that destroys a shared cap, tests assert
`!ts::has_most_recent_shared<AutoSwapCap<T>>()` to confirm deletion.

### Clock fixtures

Tests construct a Clock per scenario tick and destroy it before
returning shared state:

```move
fun new_clock_at(scenario: &mut ts::Scenario, ts_ms: u64): Clock {
    let mut c = clock::create_for_testing(ts::ctx(scenario));
    clock::set_for_testing(&mut c, ts_ms);
    c
}

// usage
let c = new_clock_at(&mut scenario, DAY_MS + 3_600_000);
auto_swap::test_validate_for_swap_v2<SUI>(&mut r, &mut cap, 500, &c, ts::ctx(&mut scenario));
clock::destroy_for_testing(c);
```

### `expected_failure` for negative cases

```move
#[test, expected_failure(abort_code = auto_swap::E_DAILY_BUDGET_EXCEEDED)]
fun validate_v2_aborts_when_daily_budget_exceeded() { /* ... */ }
```

Every error constant in `auto_swap.move` and `vault.move` has at least
one `expected_failure` test exercising it.

### `test_only` shims for `public(package)`

`validate_for_swap`, `validate_for_swap_v2`, and `assert_dest_allowed`
are `public(package)` and thus not callable directly from the test
module. `auto_swap.move:325-1043` defines thin test-only wrappers
(`test_init`, `test_bootstrap_v7`, `test_validate_for_swap`,
`test_validate_for_swap_v2`, `test_assert_dest_allowed`) gated by
`#[test_only]`.

## See also

- `01-move-overview.md` for module layout
- `04-move-upgrade-history.md` for the test count progression across
  versions
