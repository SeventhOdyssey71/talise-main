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

## Proof: coin::send_funds is not gasless for Coin-object holders

Re-probed 2026-05-29 (15:21 UTC) against mainnet, same user. The
exhaustive 25-shape matrix in `web/scripts/probe-gasless-build.mjs`
covers SHAPES A through C of the user's directive and adds B5–B11
composite shapes. Live state at probe time:

- `addressBalance` (USDsui accumulator): 3,788 µ
- `coinBalance` (sum of legacy `Coin<USDSUI>` objects): 666,928 µ
  - object `0x5141…7d04c` — 416,928 µ
  - object `0x1b00…f4809` — 250,000 µ
- chain identifier: `4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S`
- epoch: 1142

Verdict per the user's strict definition
(`effects.status.success === true` AND `gasUsed.computationCost === "0"`
AND `gasUsed.storageCost === "0"`): **no shape qualifies**. The full
matrix output:

| shape | result | validator string |
| --- | --- | --- |
| `A_balance_send_funds` (1000 µ withdrawal) | BuildErr | `Invalid gasless withdrawal from 0x40381c…2222. Gasless transactions must either use the entire balance, or leave at least 10000 for token type USDSUI. Remaining amount is 2788` |
| `A_full_balance_send_entire_accumulator` (3788 µ, all) | BuildErr | `Invalid transaction expiration: Transactions must either have address-owned inputs, or a ValidDuring expiration with at most two epochs of validity` |
| `A_full_balance_send_entire_validduring` (3788 µ + ValidDuring) | BuildErr | `unknown TransactionExpirationKind` (validator rejects the gRPC ValidDuring encoding even when the SDK serializes it correctly) |
| `B1_coin_send_funds_with_coinWithBalance` | BuildErr | same `Invalid gasless withdrawal` — `coinWithBalance({useGasCoin:false})` routes through the accumulator under the hood |
| `B2_coin_send_funds_explicit_split_no_merge` | BuildErr | `Transaction resolution failed: InsufficientGas` |
| `B2m` (mergeCoins prefix) | BuildErr | `InsufficientGas` |
| `B3_coin_send_funds_auto` (no gasPrice/gasBudget override) | BuildErr | `Unable to perform gas selection due to insufficient SUI balance … to satisfy required budget 213528` (SDK does NOT auto-detect gasless eligibility for `coin::send_funds`, contrary to docs) |
| `B4_coin_send_funds_direct_grpc_client` (bypass our fallback proxy, fresh `SuiGrpcClient`) | BuildErr | identical to B3 — proves the proxy is not the bottleneck |
| `B4z` (B4 + explicit `gasPrice(0n) + gasBudget(0n)`) | BuildErr | `InsufficientGas` |
| `B5_balance_send_funds_from_coin_into_balance` (split + into_balance + send_funds) | BuildErr | `InsufficientGas` |
| `B6` (B5 + ValidDuring) | BuildErr | `unknown TransactionExpirationKind` |
| **`B7_coin_send_funds_whole_coin_no_split`** | **BuildOk + simulate success** | `paymentCount: 0`, `computationCost: 1339272`, `storageCost: 0`, `storageRebate: 1339272` — NET zero SUI to user, but `computationCost != 0` fails the strict criterion |
| `B8_coin_move_split_then_send_funds` (Move-level `0x2::coin::split`) | BuildErr | `Function 0x2::coin::split is not supported in gasless transactions` |
| `B9_split_send_funds_plus_residue_back` | BuildErr | `InsufficientGas` |
| `B10_into_balance_split_send_funds` (split @ balance level + residue back) | BuildErr | `InsufficientGas` |
| `B11` (B10 against smallest coin) | BuildErr | `InsufficientGas` |
| `C_pay_send`, `C_pay_send_funds`, `C_pay_transfer`, `C_pay_split_and_transfer`, `C_coin_transfer`, `C_coin_send`, `C_transfer_public_transfer` (all with `setGasPrice(0n)`) | BuildErr | `Function 0x2::<module>::<fn> is not supported in gasless transactions` for every candidate — proves the gasless allowlist is small and explicit |

### Key insights from the matrix

1. The validator's gasless allowlist for MoveCall is tiny — only
   `0x2::balance::send_funds<T>` and `0x2::coin::send_funds<T>` are
   reachable. Every `0x2::pay::*`, `0x2::coin::{transfer,send,split}`,
   `0x2::transfer::public_transfer` is explicitly rejected with
   "Function X is not supported in gasless transactions".

2. The validator's gasless rail rejects ANY PTB that needs allocated
   storage for an intermediate object. SplitCoins, MergeCoins,
   coin::into_balance + balance::split, even
   `coin::send_funds(residue_back_to_self)` — all return
   `Transaction resolution failed: InsufficientGas`. The input coin's
   storage rebate only covers the rebate budget for that single
   primitive call.

3. The ONE shape that simulates `success: true` with `paymentCount: 0`
   is `B7`: `0x2::coin::send_funds<USDSUI>(WHOLE_COIN, recipient)`.
   But it sends the ENTIRE Coin object's balance, not an arbitrary
   amount. For this user with two Coin objects (416,928 µ and 250,000
   µ), `B7` can only send 416,928 µ or 250,000 µ — not 1,000 µ.

4. The accumulator path (SHAPE A and B1) fails the on-chain "use
   entire balance OR leave ≥ 10,000 µ" rule because the user holds
   3,788 µ in the accumulator. ValidDuring is required when the PTB
   has no address-owned inputs, but the gRPC simulate endpoint
   currently rejects the `VALID_DURING` enum variant with
   `unknown TransactionExpirationKind` — a Sui-side bug that prevents
   even the "use entire balance" path from being reachable from the
   gRPC client today.

### Verbatim best-candidate dryRun (SHAPE B1)

```
Error checking transaction input objects: Invalid withdraw reservation:
Invalid gasless withdrawal from
0x40381cbee819c90fdcb96c62a28bcce1fffa0289c38c1d18e55c4031a15f2222.
Gasless transactions must either use the entire balance, or leave at
least 10000 for token type
0x44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI.
Remaining amount is 2788
```

The reservation object `0x40381c…2222` is the user's address-balance
accumulator slot for USDsui. The rule binds at the validator's
`check_gasless_transaction_inputs` stage — before any move execution
— so it cannot be sidestepped at the PTB level.

### Implication for `sponsor-prepare/route.ts`

Per the user's directive ("ONLY then is sponsored fallback acceptable,
and even then we ship it with `mode: \"sponsored-coin-fallback\"` and
a TODO link to a follow-up"), the route now:

1. Still attempts the canonical gasless `balance::send_funds` PTB
   first. When the user's accumulator is funded above the 10k µ
   remainder rule (or covers the entire-balance exception), this path
   succeeds and returns `mode: "gasless"`.
2. On `withdraw reservation` / `accumulator` / `InsufficientGas`
   errors, falls through to the existing Payment Kit sponsored branch
   and returns `mode: "sponsored-coin-fallback"` (distinct from regular
   `"sponsored"` so iOS and analytics can tell the two apart).
3. On any other build error, returns 400 `GASLESS_BUILD_FAILED` so
   real bugs surface loudly.

TODO(gasless-coin-deposit): when Sui adds a public
`accumulator::deposit` / `coin::join_to_accumulator` entry function,
re-run `node web/scripts/probe-gasless-build.mjs` to detect allowlist
inclusion. If it lands, prepend the deposit leg to the canonical
`balance::send_funds` PTB and drop the sponsored-coin-fallback branch.
That's the only path to true arbitrary-amount gasless from
Coin-object balance state.
