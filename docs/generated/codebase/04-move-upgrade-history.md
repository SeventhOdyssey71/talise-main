# 04. Upgrade history v1 → v7

The Talise Move package has shipped seven on-chain versions. Each one
was a `compatible`-policy upgrade (additive changes only). Mainnet
package ids are recorded in `move/talise/AUTOSWAP.md`.

## Timeline

| Ver | Package id prefix | What changed | Why |
|---|---|---|---|
| v1 | `0xc74a7df0...d394` | Initial publish. `AutoSwapRegistry`, `AdminCap`, `AutoSwapCap<T>` (user-owned). `TaliseVault`, `deposit`, `withdraw`, `auto_swap_extract`, `auto_swap_deposit`. | Path-C delegated auto-swap MVP. Caps were `key, store` and transferred to the user. |
| v2 | `0x45654c43...9046` | Added `receive_and_deposit<T>(vault, Receiving<Coin<T>>, ctx)`. | Coins sent to the vault address landed as orphan address-owned objects. Vault needed a way to claim them via `transfer::public_receive`. |
| v3 | `0x4ae445e0...4e55` | Caps now SHARED on mint (`enable_auto_swap` calls `transfer::public_share_object`). Added `share_existing_cap<T>` to promote pre-v3 user-owned caps. | Cron-driven swaps are signed by Onara. Sui PTBs require the signer to own every owned-object argument , a user-owned cap can never appear in a worker-signed PTB. Sharing the cap lets any signer reference it; `validate_for_swap`'s `sender == admin` assert keeps it safe; `cap.owner == ctx.sender()` on mutations keeps the user in control. |
| v4 | `0x29a0d730...715a` | Added `auto_swap_deposit_to_owner<Dest>` that transfers swap output (and any stale bag balance of same type) to `vault.owner` instead of bag-stashing. | UX: swapped USDsui should appear in the user's plain wallet, not invisibly inside the shared vault. |
| v5 | `0xd969ca63...f12c6` | Added `receive_from_accumulator<T>(vault, amount, ctx)` using `balance::withdraw_funds_from_object`. | Mainnet started routing plain `transfer::public_transfer` to shared-object addresses through the accumulator at `0x000...0acc` instead of parking a `Coin<T>`. The v2 `receive_and_deposit` path then errored with "Could not find the referenced object at version". v5 uses the right primitive. |
| v6 | `0x5dd612e4...66cd` | Added `receive_from_accumulator_to_owner<T>(vault, amount, ctx)`. | Mirror of v4's wallet-direct delivery, but for the accumulator path. USDsui sent to `@handle` now arrives in the wallet in one tick with no bag stopover. |
| v7 | `0x8a807f53...b9f3` | Institutional-grade hardening. `AutoSwapRegistryV2` (4-role RBAC: Root / Treasury / Oncall / Worker), 2-step + 48h delay admin rotation, `AutoSwapCapV2<T>` with per-day throttle, dest-type allowlist asserted on chain, provider allowlist, global pause, `upgrade_cap_to_v2<T>` for user-signed v1→v2 migration. Bootstrap registry: `0x46c93c9b...4601`. | Path-C had a single admin key and no daily budget. v7 makes a Worker compromise bounded by `max_per_day` per user with Oncall+Root able to revoke in minutes. |

## Compatibility constraint

Sui's `compatible` policy prohibits modifying existing public struct
field layouts. This is the source of the v2-vs-original split:

- The v1 `AutoSwapRegistry` and `AutoSwapCap<T>` layouts are frozen.
- v7 needed throttle fields on the cap and full RBAC state on the
  registry. Neither could be added in place.
- Solution: define new structs `AutoSwapRegistryV2` and
  `AutoSwapCapV2<T>` and write parallel entries
  (`validate_for_swap_v2`, `auto_swap_extract_v2`,
  `auto_swap_deposit_to_owner_v2`, etc.). User-signed
  `upgrade_cap_to_v2<T>` migrates one cap at a time.

The v1 `validate_for_swap` and `auto_swap_extract` paths still compile
and still work. The cron is wired to v2.

## Why not OZ AccessControl

OpenZeppelin's `contracts-sui` v1.1.0 ships an `access_control` module
with typed `Auth<Role>` capabilities, time-locked default-admin
transfer, and grant/revoke. The v7 SECURITY spec
(`move/talise/SECURITY-V7.md`) initially planned to adopt it.

It was dropped for two reasons:

1. **OTW at init-time only.** OZ AccessControl requires a One-Time
   Witness (OTW) consumed inside `module init`. OTWs are claimed once,
   at publish, and cannot be re-acquired during an upgrade.
   v7 is an upgrade of an already-published package, so v1's `init`
   already ran , there is no way to reach a fresh OTW path that the
   OZ constructor could consume. A new module `init` could be added in
   v7, but it would not have an OTW for the existing publisher; the
   only OTWs available at upgrade time are those from any new
   `OTW`-typed structs defined in v7, which OZ's API does not accept
   as the AccessControl initializer.

2. **Framework rev conflict.** OZ pins a specific Sui-framework rev that
   does not match Talise's `framework/testnet` pin. Pulling OZ
   triggers a "multiple versions of package 0x2" build error that
   requires `override = true` in `Move.toml` , see the comment at
   `Move.toml:7`. Combined with reason 1, the only viable path was
   hand-rolling.

The v7 source borrows OZ's patterns (snapshot-the-delay, 2-step
transfer with cancel) without importing the library.
`auto_swap.move:339-361` documents this trade-off inline.

### OZ math, also dropped

`openzeppelin_math::core::u64::checked_add` was planned for the
throttle's `used_today + amount`. Dropped for the same `override =
true` reason. Replaced with an explicit overflow guard:

```move
// auto_swap.move:835
assert!(amount <= U64_MAX - cap.used_today, E_OVERFLOW);
let new_used = cap.used_today + amount;
```

Safety-equivalent for u64; just less ergonomic.

## The `upgrade_cap_to_v2` PTB bug

A past bug worth memorializing: the entry function
`upgrade_cap_to_v2<T>` was defined in
`move/talise/sources/auto_swap.move:918` (in the `auto_swap` module),
but an early off-chain PTB builder targeted it as
`<pkg>::vault::upgrade_cap_to_v2` instead of
`<pkg>::auto_swap::upgrade_cap_to_v2`. The error surfaced as a generic
"function not found" at PTB-build time, which is easy to misread as a
package-id mismatch rather than a module-name typo.

Lesson: when an entry function logically belongs to "the vault flow"
but mechanically lives in another module, always grep the source for
the function name to confirm its actual module path. The fix was a
one-line correction in the PTB builder (`web/lib/vault.ts`).

## Test count progression

| After version | Test files | Test count |
|---|---|---|
| v1 (initial) | `auto_swap_tests` | small |
| v2 | added `receive_and_deposit` coverage | 42 |
| v3 | tests migrated to `take_shared` for caps | 42 |
| v4 | added `auto_swap_deposit_to_owner` cases | ~45 |
| v5/v6 | (no new tests added; accumulator paths exercised on testnet) | 45 |
| v7 | added `tests/v7_tests.move` with 21 new cases | **66/66 passing** |

Counts of `#[test]` / `#[test, expected_failure(...)]` annotations
across the test files:

- `tests/v7_tests.move`: 21
- `tests/auto_swap_tests.move`: 18 (some tests pre-existed v3 migration)
- `tests/vault_tests.move`: 22
- `tests/receipt_tests.move`: 2
- `tests/send_tests.move`: 3

Total: 66. See `05-move-testing.md`.
