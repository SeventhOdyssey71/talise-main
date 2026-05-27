# 03. Auto-swap flow

End-to-end: someone sends any supported coin to `alice.talise.sui`,
within ~60 seconds it appears as USDsui in Alice's plain wallet. Alice
signs zero transactions; the Onara worker signs everything, with bounds
enforced on-chain.

## The picture

```
sender wallet
    │
    │ transfer::public_transfer(coin, vault_addr)
    ▼
Sui address-accumulator at 0x000...0acc
    │ dynamic_field::Field<accumulator::Key<Balance<T>>>
    │   keyed by vault.id
    │
    │ [Step A , cron, every 60s]
    │ vault::receive_from_accumulator<T>(vault, amount)
    │   = balance::withdraw_funds_from_object<T>(&mut vault.id, amount)
    │   → folds Balance<T> into vault.balances bag
    ▼
TaliseVault (shared object)
  balances: Bag { T => Balance<T> }
    │
    │ [Step B , cron, same or next tick]
    │ vault::auto_swap_extract_v2<Source>(&mut vault, registry, cap, amount, &clock, ctx)
    │   → (Balance<Source>, SwapTicket)
    │
    ▼
Cetus aggregator (off-chain routing, on-chain PTB calls)
  Balance<Source> → Balance<USDsui>
    │
    │ vault::auto_swap_deposit_to_owner_v2<USDsui>(
    │   &mut vault, &registry, output, ticket, &clock, ctx
    │ )
    │   - assert_dest_allowed<USDsui>(registry)
    │   - assert ticket.vault_id == vault.id
    │   - join output with any stale Balance<USDsui> in bag
    │   - coin::from_balance + transfer::public_transfer to vault.owner
    ▼
Alice's plain wallet  ← Coin<USDsui>
```

USDsui sent directly to `@handle` shortcuts the swap: the cron special-
cases the dest type and calls `receive_from_accumulator_to_owner<USDsui>`
(see `vault.move:264`) to drain the accumulator straight to
`vault.owner`, skipping the bag.

## The accumulator twist

When you `transfer::public_transfer(coin, shared_object_addr)`, the
runtime does NOT park a `Coin<T>` as address-owned at the shared
object's address. It routes the value through the global accumulator
at `0x000...0acc`. The accumulator stores inbound value as
`dynamic_field::Field<accumulator::Key<Balance<T>>>` keyed by the
destination object's `UID`.

This broke the v2 path. `receive_and_deposit<T>` consumes a
`Receiving<Coin<T>>` (`vault.move:276`) but there is no Coin object to
receive , the framework returns `"Could not find the referenced object
at version SequenceNumber(X)"`. v5 adds the correct primitive:

```move
// vault.move:244
public entry fun receive_from_accumulator<T>(
    vault: &mut TaliseVault,
    amount: u64,
    ctx: &TxContext,
) {
    let withdrawal = balance::withdraw_funds_from_object<T>(&mut vault.id, amount);
    let bal = balance::redeem_funds(withdrawal);
    let value = balance::value(&bal);
    assert!(value > 0, E_ZERO_AMOUNT);
    deposit_balance(vault, bal, ctx.sender());
}
```

`balance::withdraw_funds_from_object<T>` is Sui's accumulator-withdraw
primitive. The framework asserts `amount <= slot_value` so over-pulling
is impossible. The off-chain cron reads `suix_getAllBalances` to pick
`amount`; if more arrived between read and tx, the leftover stays in
the slot for the next tick.

Companion `receive_from_accumulator_to_owner<T>` (`vault.move:264`,
added v6) routes USDsui straight to `vault.owner`, no bag stopover.

`receive_and_deposit<T>` (`vault.move:276`) stays in the code for the
rare edge where a real `Coin<T>` lands at the vault address. The cron
no longer uses it.

## The `SwapTicket` hot potato

```move
// vault.move:67
public struct SwapTicket {
    vault_id: ID,
    from_type: vector<u8>,
    from_amount: u64,
}
```

No `key`, `store`, `drop`, or `copy`. Move's type system can do exactly
one thing with it: pass it to a function that destructures it.
`auto_swap_deposit*` (`vault.move:420,473,562,602`) are the only
consumers. If the worker tries to extract a balance and walk away, the
PTB will not type-check.

The deposit functions assert `ticket.vault_id == object::id(vault)`
(`E_WRONG_VAULT` = 204). So even inside a single PTB the output cannot
flow to a different vault.

## Cetus integration points

The Move side does not contain any Cetus types or dependencies. The
integration is shaped by what the PTB looks like off-chain:

1. Cron calls `vault::auto_swap_extract_v2<Source>(...)` → returns
   `(Balance<Source>, SwapTicket)`.
2. The PTB passes `Balance<Source>` (or rather a `Coin<Source>` after
   `coin::from_balance`) into the Cetus aggregator's swap PTB. The
   aggregator returns `Coin<USDsui>`.
3. The PTB converts back: `coin::into_balance(coin_out)` →
   `Balance<USDsui>`.
4. PTB calls `vault::auto_swap_deposit_to_owner_v2<USDsui>(..., output,
   ticket, ...)`. Hot potato consumed. Output transferred to
   `vault.owner`. Tx commits.

The Move side trusts the aggregator's output amount , there is no
oracle-priced slippage check on chain. Slippage is enforced off-chain
by Onara with a target ceiling of 2%; `SECURITY-V7.md:103-107` was
updated 2026-05-27 to match this reality (previously it overclaimed an
on-chain assert that does not exist). The on-chain provider allowlist
(`allowed_providers`) is for auditability , not asserted in Move.

## Per-call assertions (v7 happy path)

`vault::auto_swap_extract_v2<Source>` (`vault.move:526`) asserts:

1. `cap.vault_id == object::id(vault)` (`E_WRONG_VAULT`)
2. `amount > 0` (`E_ZERO_AMOUNT`)
3. Delegates to `auto_swap::validate_for_swap_v2`:
   - `!registry.paused` (`E_REGISTRY_PAUSED`)
   - `sender ∈ worker_addresses` (`E_NOT_WORKER`)
   - `!cap.paused` (`E_CAP_PAUSED`)
   - `now <= cap.expires_at_ms` if non-zero (`E_CAP_EXPIRED`)
   - `amount <= cap.max_per_swap` (`E_AMOUNT_EXCEEDS_CAP`)
   - day-rollover bump if `now >= day_reset_at_ms`
   - `amount <= U64_MAX - used_today` (`E_OVERFLOW`)
   - `used_today + amount <= max_per_day` (`E_DAILY_BUDGET_EXCEEDED`)
4. `vault.balances.contains(Source type key)` (`E_TYPE_NOT_HELD`)
5. `Balance<Source>.value >= amount` (`E_INSUFFICIENT_BALANCE`)

`vault::auto_swap_deposit_to_owner_v2<Dest>` (`vault.move:602`):

1. `Dest ∈ registry.allowed_dest_types` (`E_DEST_NOT_ALLOWED`)
2. `ticket.vault_id == object::id(vault)` (`E_WRONG_VAULT`)

## Navi supply integration

Move side: none. There are no Navi imports or types in `move/talise/`.
Earn-vault supply happens in the iOS/web stack via Navi's SDK
(`web/lib/navi-supply.ts`). The Talise Move package has no opinion on
where post-swap USDsui goes after it lands in `vault.owner`'s wallet;
Navi supply is a downstream user-signed PTB.

## What happens on partial failure

PTBs are all-or-nothing: if any call aborts, the entire transaction
reverts. The hot-potato design means there is no "extracted but not
deposited" state , that state cannot exist between txs.

Failure modes:

- **Accumulator drain aborts** (insufficient slot, etc.) → vault bag
  unchanged, swap doesn't run this tick; cron retries next minute.
- **Validation aborts** (cap throttled, paused, expired) → vault bag
  unchanged, no balance extracted.
- **Extract aborts after validate** (bag empty for type, insufficient
  amount) → `total_validations` increment + `AutoSwapValidatedV2` event
  were emitted then rolled back: nothing observable on chain.
- **Cetus swap aborts** (no route, insufficient liquidity) → extract
  was rolled back, hot potato never existed in committed state.
- **Deposit aborts** (dest not allowed, wrong vault) → extract rolled
  back, ticket destructure rolled back.

The off-chain cron treats any abort as "skip this user this tick" and
retries on the next 60-second loop. There is no partial commit state to
clean up.
