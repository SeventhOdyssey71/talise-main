# 43. Flow: auto-swap (the hero feature)

Auto-swap is what makes Talise feel like a dollar-denominated bank
account. Anything sent to your handle, whether it is SUI, USDC, USDT, or
some random meme coin, lands in your wallet as USDsui within about a
minute. The user did not sign a swap. The user did not even know a swap
happened. This is the single most distinctive piece of the product.

This doc covers the protocol-level story. The Move-level details
(SwapTicket layout, v1 to v7 cap migration, the validate-for-swap
checks) are in `03-move-auto-swap-flow.md`.

## What the user sees

A non-USDsui inbound triggers, at the user's option, one of two surface
behaviors:

- **Auto-convert banner on `/home`.** When any non-USDsui coin is held
  by the user's address, the dashboard surfaces an inline "Convert
  all" affordance. Tapping it iterates over each coin, builds a
  T2000-backed Cetus swap PTB per coin, and converts to USDsui.
- **Cron-driven auto-swap (the protocol path).** If the user has
  enabled the per-asset `AutoSwapCap`, the cron worker on Onara
  performs the conversion without any user interaction, subject to
  per-swap and per-day caps.

The cron-driven path is the one that makes the product feel
"invisible." The user does nothing. The activity feed shows a single
"received" row in USDsui, denominated in the user's local currency.

## The accumulator path: why this is a Sui-specific story

The natural mental model is: "a coin sent to address X means X owns a
`Coin<T>` object at that address." For end-user addresses that is
correct. For **shared-object addresses** (and a Talise vault is a
shared object), it is not.

When `transfer::public_transfer` (or any vanilla transfer) targets a
shared-object address, the Sui runtime routes the value through a
**global accumulator at address `0x000...0acc`**. The accumulator stores
the inbound value as `dynamic_field::Field<accumulator::Key<Balance<T>>>`,
keyed by the destination's UID and the coin type. The destination object
does not gain a free-floating `Coin<T>`.

This means a naive scan for the user's inbound coins, using
`suix_getOwnedObjects` filtered on the vault's address, returns empty
even when value has clearly been deposited. The v1 and v2 cron worker
hit exactly this bug: every receipt looked like zero coins to claim.

The fix in v5 of the Move package was to add an entry that drains the
accumulator slot:

```move
public entry fun receive_from_accumulator<T>(
    vault: &mut TaliseVault,
    amount: u64,
    ctx: &mut TxContext,
) {
    let withdrawal = balance::withdraw_funds_from_object<T>(&mut vault.id, amount);
    // …folds the withdrawn balance into the vault's Bag
}
```

`balance::withdraw_funds_from_object` is the Sui framework primitive
that pops a value out of the accumulator slot for a given object UID
and coin type.

v6 added the companion entry `receive_from_accumulator_to_owner<T>`,
which does the same accumulator drain but wraps the proceeds as
`Coin<T>` and transfers them directly to `vault.owner`. The cron
worker uses this for USDsui (the destination type, which needs no
conversion) so the flow is one tick: accumulator → wallet.

For non-USDsui types the flow is: accumulator → vault Bag (v5) →
extract via `auto_swap_extract<Source>` → Cetus aggregator swap →
`auto_swap_deposit_to_owner<USDsui>` → wallet.

## Detecting inbound coins without owned-object lookups

Because the accumulator hides deposits from owned-object queries, the
cron uses two endpoints instead:

- `suix_getAllBalances(address)` returns the live, summed
  balance-by-coin-type for an address, including the accumulator slots.
- `suix_getCoins(address, coinType, cursor)` pages through coins held
  at the address. For pre-accumulator-rollout objects, this still
  works for direct coin holdings.

The cron picks up new value by polling `getAllBalances` per active
vault address, diffing against the last-known total, and acting when
a non-USDsui type has a positive new balance.

## The SwapTicket hot-potato pattern

The Move package treats a swap as a single atomic interaction with a
hot-potato discipline. The relevant pieces are in `move/talise/sources/vault.move`:

1. **Extract.** `auto_swap_extract<Source>` validates the
   AutoSwapCap (sender == worker, cap not paused, amount under caps,
   day-rollover handled, etc.) and pulls a `Balance<Source>` out of
   the vault. It returns the balance plus a `SwapTicket` struct with
   `key`, `store`, `drop`, and `copy` abilities all absent. A
   SwapTicket cannot be stored, cannot be dropped, cannot be copied,
   and cannot be transferred. It can only be consumed.

2. **Swap.** The PTB hands the `Balance<Source>` to the Cetus
   aggregator, which routes through whichever underlying pools give
   the best price, and produces a `Balance<USDsui>`.

3. **Deposit.** `auto_swap_deposit_to_owner<USDsui>` takes the
   `Balance<USDsui>`, the `SwapTicket`, and the vault. It destructures
   the ticket (which is what satisfies the hot-potato discipline),
   asserts the ticket's `vault_id` matches the depositing vault,
   wraps the balance as a `Coin<USDsui>`, and transfers it to
   `vault.owner`.

The hot-potato property is what prevents a malicious worker from
walking away with the source balance. The ticket has no abilities, so
the only way to satisfy the type system is to call a deposit entry in
the same PTB. The deposit entry asserts the destination is the same
vault the extract was issued against, so the worker cannot redirect
the output.

## The Cetus aggregator path

The swap leg uses Cetus's aggregator (router v3 / aggregator SDK),
which is the meta-DEX router on Sui that picks the best route across
20+ underlying pools. The cron's TypeScript code in `web/lib/t2000.ts`
(which wraps Cetus + Navi behind a unified API) does:

1. **Route discovery.** Ask the aggregator for a route from `Source`
   to USDsui at the given amount. The route is a sequence of hops
   across one or more underlying pools.
2. **PTB composition.** Build a PTB that opens with the auto-swap
   extract, hands the resulting balance to the aggregator's swap
   builder, and closes with the auto-swap deposit-to-owner.
3. **Sign and submit.** The worker key (one of `worker_addresses` in
   the v7 registry) signs as sender. Onara does not sponsor cron
   transactions; the worker pays its own gas.

The full Move-level details (registry validation order, allowed-dest
type assertion, day-rollover semantics) are in
`03-move-auto-swap-flow.md`.

## Failure modes

**No Cetus route exists.** Some long-tail coins have no liquidity
path to USDsui. The aggregator query returns no route; the cron
skips that coin and leaves the balance in the accumulator for the
user to handle manually (via "Convert all" or by sending it
elsewhere). The protocol does not stuck the user; it just does
nothing on its own.

**Slippage breached.** Every conversion asserts on chain that the
realized output is no worse than 2% below the quoted output. A
misconfigured off-chain swap cannot quietly hand the user a bad
price. If the assertion fires, the entire PTB reverts. The vault
balance is restored. The cron retries on the next sweep, ideally
with a fresh route.

**Accumulator drain succeeds but Cetus swap fails.** The PTB is
atomic. If the swap leg fails, the entire transaction reverts and
the accumulator slot is restored. No partial drain. The cron retries.

**Daily cap exceeded.** The user-controlled `max_per_day` field on
the AutoSwapCapV2 is the protective ceiling. Once exceeded for the
day, the cron stops. The next conversion will not run until the day
rolls over (the timestamp comparison is on chain in
`validate_for_swap_v2`, so a compromised worker cannot fake the
clock).

**Registry paused.** v7 added a global kill-switch. Oncall keys (warm
tier, not worker) can flip the registry into paused. All
`validate_for_swap_v2` calls revert until unpaused.

**Cap paused.** The vault owner can pause their own cap from the
Settings surface. The cron skips that cap until the user resumes.

## Cross-references

- `03-move-auto-swap-flow.md` for the Move-level deep dive.
- `02-move-rbac-and-caps.md` for the 4-role model and how the cron
  worker fits inside it.
- `04-move-upgrade-history.md` for the v1 to v7 migration that
  introduced the accumulator drain.
- `move/talise/AUTOSWAP.md` (in-tree) for version history and the
  full conversion path.
