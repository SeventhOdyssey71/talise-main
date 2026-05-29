# Gasless allowlist — what we found in `0x2`

Probed 2026-05-29 via `web/scripts/probe-gasless-build.mjs` against
mainnet for user `0xb9aad5433f0d3b76e35d9985706b3fa9e571262f2fa1f12043589ca681d2866c`
(who holds 666,928 µ USDsui in two legacy `Coin<USDSUI>` objects and only
3,788 µ in their Address Balance accumulator).

## The two validator-side error strings that nail the rules

Building a PTB with `tx.setGasPrice(0n)` and submitting `tx.build()` (or
`simulateTransaction`) returns these two distinct rejections that fully
specify the gasless allowlist:

1. **Command-type allowlist** — from a PTB that ended with a plain
   `tx.transferObjects([split], recipient)`:

   > `Error checking transaction input objects: Feature is not supported:
   > Gasless transactions only support MoveCall, MergeCoins, and
   > SplitCoins commands`

   `TransferObjects`, `Publish`, `Upgrade`, `MakeMoveVec`, and
   `MergeCoins` are NOT on the command-type allowlist. (`MergeCoins` IS
   on it per the same error string but isn't useful without a target
   call.)

2. **Function-target allowlist within MoveCall** — from a PTB that
   prepended `0x2::funds_accumulator::add_impl<Balance<USDSUI>>(bal,
   sender)`:

   > `Error checking transaction input objects: Feature is not supported:
   > Function 0x2::funds_accumulator::add_impl is not supported in
   > gasless transactions`

   So the validators carry an explicit per-function allowlist for the
   move-call subset. We have not enumerated every entry; we know
   `0x2::balance::send_funds<T>(Balance<T>, address)` IS on it (the
   current happy path uses it), and `0x2::funds_accumulator::add_impl`
   is NOT.

## What `0x2` exports for the accumulator surface

`sui_getNormalizedMoveModulesByPackage('0x2')` returned 65 modules. The
accumulator-related ones are:

| module | exposed functions |
| --- | --- |
| `accumulator` | `accumulator_address`, `accumulator_key`, `accumulator_u128_exists`, `accumulator_u128_read`, `create_u128`, `destroy_u128`, `emit_deposit_event`, `emit_withdraw_event`, `is_zero_u128`, `root_add_accumulator`, `root_borrow_accumulator`, `root_borrow_accumulator_mut`, `root_has_accumulator`, `root_id`, `root_id_mut`, `root_remove_accumulator`, `update_u128` |
| `accumulator_settlement` | (no exposed functions) |
| `accumulator_metadata` | (no exposed functions) |
| `funds_accumulator` | `add_impl` (Friend), `create_withdrawal` (Friend), `redeem` (Friend), `withdraw_from_object` (Friend), `withdrawal_join` (Public), `withdrawal_limit` (Public), `withdrawal_owner` (Public), `withdrawal_split` (Public) |

`0x2::address_balance` **does not exist** as a module
(`-32602: No module found with module name address_balance`).

The deposit-side primitives we wanted to call (`funds_accumulator::add_impl`,
`funds_accumulator::create_withdrawal`) are `visibility: Friend` —
**unreachable from a PTB regardless of allowlist**. The only Public
funds_accumulator functions are operators on an already-existing
`Withdrawal` value (`split`, `join`, `limit`, `owner`).

`0x2::balance` exposes one promising-named function — `redeem_funds` —
but it CONSUMES a `Withdrawal` and returns a `Balance`. It is the
withdrawal-completion side, not the deposit side.

`0x2::coin::send_funds<T>(Coin<T>, address)` exists publicly and was a
candidate alternative (no accumulator round-trip needed), but the
probe shows the gasless rail still imposes a per-address gas
reservation that fails for this user; we did not isolate whether the
function itself is on the allowlist because the reservation check
fires first. Worth re-probing on a user whose SUI accumulator is
non-empty.

## Implication for `sponsor-prepare/route.ts`

There is **no on-chain primitive callable from a PTB that deposits a
`Coin<T>` into the sender's Address Balance accumulator**. A composite
"prefix-deposit + withdrawal + send_funds" gasless PTB is therefore
not achievable today.

The existing `ACCUMULATOR_UNDERFUNDED` 400 in
`web/app/api/send/sponsor-prepare/route.ts` is the right safety net.
Surfacing the error to iOS as a 400 (rather than silently falling
through to the sponsored rail) remains the correct behaviour until one
of these lands:

- Sui framework upgrade adds a public `Coin<T> → accumulator` entry
  function AND that function gets added to the gasless allowlist; OR
- We adopt the two-tx pattern: a sponsored consolidation tx (Onara
  pays) prepended to the gasless send, surfaced to iOS as
  `mode: "gasless-after-consolidation"` and gated by a per-user
  perf-cache flag so we don't repeat it on every send.

## How to re-probe

```sh
cd web
node scripts/probe-gasless-build.mjs <sender> <recipient> <amount-usdsui>
```

The script tests four PTB shapes:

- `A_withdrawal_send_funds` — current canonical gasless.
- `B_coin_send_funds_direct` / `B2_coin_send_funds_no_join` —
  `0x2::coin::send_funds` with a split coin source.
- `C_funds_accumulator_add_impl_prefix` — composite deposit + send.
- `D_transfer_coin_object` — plain `transferObjects` (sanity check for
  the command-type allowlist).

Each shape prints `BUILD_OK` / `BUILD_ERR` with the validator's
human-readable rejection string. When the on-chain allowlist is
expanded, this probe is the fastest way to detect it.
