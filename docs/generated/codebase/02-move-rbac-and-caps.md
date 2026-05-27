# 02. RBAC and capabilities

The v7 upgrade replaced the v1 single-admin model with a four-role split
inside `AutoSwapRegistryV2`. The roles, the 2-step admin transfer, the
kill switch, the per-cap throttle, and the allowlists are all
implemented in `move/talise/sources/auto_swap.move`.

This module also documents per-cap (user) controls, which sit OUTSIDE
the role hierarchy: the vault owner is the only party that can pause /
disable / migrate their own cap, regardless of role state.

## The four roles

```move
// move/talise/sources/auto_swap.move:368
public struct AutoSwapRegistryV2 has key {
    id: UID,
    admin: address,                              // Root / admin
    pending_admin_transfer: Option<PendingAdminTransfer>,
    admin_transfer_delay_ms: u64,
    pending_delay_change: Option<PendingDelayChange>,
    worker_addresses: vector<address>,           // Worker
    oncall_addresses: vector<address>,           // Oncall
    treasury_addresses: vector<address>,         // Treasury
    allowed_dest_types: vector<TypeName>,
    allowed_providers: vector<vector<u8>>,
    paused: bool,                                // Kill switch
    total_validations: u64,
}
```

Note: `admin` is a single `address`, not a vector. There is exactly one
Root. Other roles are address sets stored as `vector<address>` and
checked with `vector::contains`.

| Role | Field | Trust | Powers | Entry points |
|---|---|---|---|---|
| Root (admin) | `registry.admin` | Cold | Everything below + grant/revoke roles + rotate admin + change delay | `grant_*`, `revoke_*`, `begin_admin_transfer`, `accept_admin_transfer`, `cancel_admin_transfer`, `begin_delay_change`, `accept_delay_change`, `cancel_delay_change` |
| Treasury | `treasury_addresses` | Cold, multi-sig recommended | Mutate dest-type and provider allowlists | `add_allowed_dest<Dest>`, `remove_allowed_dest<Dest>`, `add_allowed_provider`, `remove_allowed_provider` (admin can also call these) |
| Oncall | `oncall_addresses` | Warm | Pause / unpause kill-switch | `pause_registry`, `unpause_registry` (admin can also call) |
| Worker | `worker_addresses` | Hot (Onara mnemonic) | Trigger swaps within cap bounds | `validate_for_swap_v2` (via `vault::auto_swap_extract_v2`) |

Role checks are three small private helpers (`auto_swap.move:961-977`):

```move
fun assert_admin(registry, ctx)            // sender == admin
fun assert_admin_or_oncall(registry, ctx)  // sender == admin || in oncalls
fun assert_admin_or_treasury(registry, ctx)// sender == admin || in treasuries
```

Worker membership is asserted inline inside `validate_for_swap_v2`
(`auto_swap.move:816`).

## 2-step admin transfer + 48h delay + cancel window

```move
// auto_swap.move:67-68
const DEFAULT_ADMIN_TRANSFER_DELAY_MS: u64 = 48 * 3600 * 1000;
const MAX_ADMIN_TRANSFER_DELAY_MS: u64    = 60 * 24 * 3600 * 1000; // 60 days
```

Rotation is a three-step on-chain dance:

1. **`begin_admin_transfer(new_admin, &clock)`** , current admin signs.
   Stores `PendingAdminTransfer { new_admin, scheduled_at_ms,
   delay_at_schedule_ms }`. Note `delay_at_schedule_ms` is a snapshot:
   shortening the delay later does NOT accelerate in-flight transfers
   (`auto_swap.move:399-406,654-655`).

2. **`cancel_admin_transfer()`** , current admin can abort at any time
   before acceptance.

3. **`accept_admin_transfer(&clock)`** , the new admin signs after
   `now >= scheduled_at_ms + delay_at_schedule_ms`. Aborts on
   `E_DELAY_NOT_ELAPSED` (207) or `E_WRONG_PENDING_ACCEPTOR` (206).

The delay itself can be re-tuned via the same pattern
(`begin/accept/cancel_delay_change`, `auto_swap.move:677-730`),
bounded above by `MAX_ADMIN_TRANSFER_DELAY_MS = 60 days`
(`E_DELAY_TOO_LARGE` = 208).

Every step emits an event: `AdminTransferBegun`,
`AdminTransferAccepted`, `AdminTransferCancelled`,
`DelayChangeBegun`, `DelayChangeAccepted`, `DelayChangeCancelled`.
Monitoring should alarm on any `*Begun` and only clear on the matching
`*Accepted` or `*Cancelled`.

## Kill-switch

Registry-wide pause sits on `registry.paused`. Either admin or any
Oncall can flip it:

```move
// auto_swap.move:735
public entry fun pause_registry(registry, ctx) {
    assert_admin_or_oncall(registry, ctx);
    registry.paused = true;
    event::emit(RegistryPaused { by: ctx.sender() });
}
```

`validate_for_swap_v2` aborts on `E_REGISTRY_PAUSED` (204) when paused
(`auto_swap.move:813`). `assert_not_paused` is exposed as
`public(package)` so future receive-paths can gate on it too
(`auto_swap.move:861`).

The cap also has its own `paused: bool` set by the vault owner via
`auto_swap::pause<T>` / `resume<T>`. Worker validation aborts on
`E_CAP_PAUSED` (100). These two pause flags are independent , admin
can't unpause a user-paused cap, and user can't unpause a registry pause.

## Per-cap throttle (v7)

`AutoSwapCapV2<T>` carries three throttle fields:

```move
// auto_swap.move:417
public struct AutoSwapCapV2<phantom T> has key, store {
    id: UID,
    vault_id: ID,
    owner: address,
    max_per_swap: u64,
    expires_at_ms: u64,
    paused: bool,
    max_per_day: u64,
    used_today: u64,
    day_reset_at_ms: u64,
}
```

`validate_for_swap_v2` rolls the day, asserts the budget, and commits
in one atomic block:

```move
// auto_swap.move:828
if (now >= cap.day_reset_at_ms) {
    cap.used_today = 0;
    cap.day_reset_at_ms = now + DAY_MS;
};
assert!(amount <= U64_MAX - cap.used_today, E_OVERFLOW);
let new_used = cap.used_today + amount;
assert!(new_used <= cap.max_per_day, E_DAILY_BUDGET_EXCEEDED);
cap.used_today = new_used;
```

`DAY_MS = 86_400_000`. The overflow guard is the hand-rolled
replacement for OZ's `checked_add` (see `04-move-upgrade-history.md`).
`max_per_day >= max_per_swap` is enforced at mint (`auto_swap.move:881`).

## Allowlists

Two registry-level allowlists, both managed by admin OR treasury:

| Allowlist | Type | Asserted by |
|---|---|---|
| `allowed_dest_types: vector<TypeName>` | Set of destination coin types | `assert_dest_allowed<Dest>` (`auto_swap.move:854`), called from `vault::auto_swap_deposit_v2` and `vault::auto_swap_deposit_to_owner_v2` |
| `allowed_providers: vector<vector<u8>>` | Aggregator provider names ("CETUS", "DEEPBOOKV3", "AFTERMATH", "CETUSDLMM") | Not asserted on-chain; off-chain Onara enforces. Stored here so the canonical list is auditable |

A compromised Worker cannot route output to an unlisted dest type
because `assert_dest_allowed` would abort the PTB.

## How user-side controls map to roles

Vault owners are not in the role hierarchy. They control their own
state through ownership checks:

| Action | Function | Check |
|---|---|---|
| Create vault | `vault::create` | None (sender becomes owner) |
| Withdraw | `vault::withdraw`, `withdraw_and_send` | `sender == vault.owner` |
| Enable auto-swap | `vault::enable_auto_swap`, `enable_auto_swap_v2` | `sender == vault.owner` |
| Pause/resume cap | `auto_swap::pause<T>`, `resume<T>` | `sender == cap.owner` |
| Disable cap | `auto_swap::disable<T>` | `sender == cap.owner` |
| Update cap bounds | `auto_swap::update_bounds<T>` | `sender == cap.owner` |
| Migrate v1 cap to v2 | `auto_swap::upgrade_cap_to_v2<T>` | `sender == cap.owner` |

## The `CapUpgradedToV2` event and the indexer pivot

```move
// auto_swap.move:485
public struct CapUpgradedToV2 has copy, drop {
    old_cap_id: ID,
    new_cap_id: ID,
    owner: address,
}
```

This event is emitted by `upgrade_cap_to_v2<T>` when a user migrates
their v1 cap. Two important wrinkles for indexers:

1. **Event-type identity is pinned to the publishing package.** Every
   Sui event type is identified by `<pkg_id>::<module>::<EventName>`
   where `<pkg_id>` is the package that *defined the struct*. Because
   `CapUpgradedToV2` was defined in the v7 source, it pins to the v7
   package id (`0x8a807f53...b9f3`), not the original v1 publish id.

2. **Off-chain queries had to switch.** Cron queries that previously
   filtered events by the v1 `original-id`
   (`TALISE_AUTOSWAP_PACKAGE_ID`) returned nothing for v7-only events.
   The event-walk discovery for v2 caps now uses
   `TALISE_AUTOSWAP_PACKAGE_LATEST` (or `_V7` if pinned separately).
   v1 events (`AutoSwapEnabled` from v1 mints) still pin to the
   original id and continue to work there.

The same logic applies to every v7 event: `RegistryBootstrapped`,
`WorkerGranted/Revoked`, `OncallGranted/Revoked`,
`TreasuryGranted/Revoked`, `AdminTransfer*`, `DelayChange*`,
`RegistryPaused/Unpaused`, `AllowedDest*`, `AllowedProvider*`,
`AutoSwapValidatedV2`. Anything new in v7 → query at v7's package id.

See `04-move-upgrade-history.md` for the longer story behind why the
OZ AccessControl library could not be adopted to provide all of this
out of the box.
