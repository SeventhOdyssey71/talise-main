# 01. Move package overview

The on-chain side of Talise is a single Move package, `talise`, that ships
custody, payment-receipts, and a delegated auto-swap surface so any coin
sent to a user's `@handle` lands in their wallet as USDsui without a per-tx
user signature.

Package manifest: `move/talise/Move.toml`. Edition `2024.beta`. Single
dependency on `Sui` pinned to `framework/testnet`. The OpenZeppelin
`contracts-sui` library was evaluated and dropped (see
`move/talise/Move.toml:7` and `04-move-upgrade-history.md`).

## Modules

| Module | File | Responsibility |
|---|---|---|
| `talise::vault` | `move/talise/sources/vault.move` | Per-user custody. Holds `Balance<T>` in a `Bag`. Owns the auto-swap entry points and the `SwapTicket` hot potato. |
| `talise::auto_swap` | `move/talise/sources/auto_swap.move` | Consent + bounds. Defines `AutoSwapRegistry` / `AutoSwapRegistryV2`, `AutoSwapCap<T>` / `AutoSwapCapV2<T>`, role checks, and `validate_for_swap*`. |
| `talise::receipt` | `move/talise/sources/receipt.move` | `PaymentReceipt` NFT minted on every send. Uses `sui::display` so receipts resolve to `https://talise.io/r/{id}`. |
| `talise::send` | `move/talise/sources/send.move` | `send<T>` entry that transfers a `Coin<T>` and mints a receipt atomically in one PTB. |

`vault.move` `use talise::auto_swap` is the only cross-module coupling.
`send` only depends on `receipt`; both are isolated from vault/auto-swap.

## Shared vs owned objects

The architecture is "everything shared, but mutation gated by sender
checks." Shared objects let the Onara hot worker reference them in a
worker-signed PTB; if these were user-owned, the worker could never read
them.

| Object | Storage model | Why |
|---|---|---|
| `TaliseVault` | Shared (per user) | The user's `@handle` SuiNS subname resolves to its address; anyone needs to be able to deposit. Owner-only mutations gate on `vault.owner == ctx.sender()`. |
| `AutoSwapRegistry` / `V2` | Shared (singleton) | Holds the admin address (v1) or the full RBAC state (v7). The cron worker reads it on every swap. |
| `AutoSwapCap<T>` / `V2<T>` | Shared since v3 | The worker needs `&cap` in a worker-signed PTB. v1/v2 minted user-owned; `share_existing_cap<T>` (`vault.move:175`) promotes legacy caps. Owner-only mutations still gate on `cap.owner == ctx.sender()`. |
| `AdminCap` | User-owned (publisher) | Reserved-rights cap minted at v1 init. Currently unused by mutation paths. |
| `PaymentReceipt` | User-owned (sender) | NFT keepsake. Sender keeps it; transfer in same PTB ships the coin to the recipient. |
| `SwapTicket` | None | Hot potato. No `key/store/drop/copy` , can only be consumed by `auto_swap_deposit*` in the same PTB. |

Coins routed to a shared-object address (e.g. the vault's address via a
plain `transfer::public_transfer`) do NOT become a free-floating `Coin<T>`
at the vault. They flow through the global accumulator at
`0x000...0acc`. See `03-move-auto-swap-flow.md` for details.

## RBAC at a glance (full detail in `02-move-rbac-and-caps.md`)

v7 introduces four roles, hand-rolled into `AutoSwapRegistryV2`:

| Role | Trust tier | Held by | Powers |
|---|---|---|---|
| Root / admin | Cold | `registry.admin: address` | Grant/revoke any role, rotate admin (2-step + 48h delay), pause, manage allowlists |
| Treasury | Cold (multi-sig) | `treasury_addresses: vector<address>` | Add/remove allowed dest types and Cetus provider strings |
| Oncall | Warm | `oncall_addresses: vector<address>` | Pause / unpause the registry |
| Worker | Hot (Onara key) | `worker_addresses: vector<address>` | Call `validate_for_swap_v2` |

Per-cap, the vault owner retains pause/resume/disable/update_bounds , see
`auto_swap.move:222` onwards.

## Key invariants

The contracts enforce, by source line:

1. Only `vault.owner` can withdraw (`vault.move:326`).
2. Only `vault.owner` can mint a cap against a vault (`vault.move:153,654`).
3. Only `cap.owner` can pause/resume/disable/update bounds, even if the
   cap is transferred (`auto_swap.move:223,236,247,265,924`).
4. `auto_swap_extract` issues a `SwapTicket` hot potato (no abilities)
   that MUST be consumed by `auto_swap_deposit*` in the same PTB
   (`vault.move:67`). Workers cannot walk away with the source balance.
5. The ticket carries the source `vault_id`; deposit asserts the output
   lands in the same vault (`vault.move:429,481,572,613`).
6. v7 worker validation enforces, in order: registry not paused → sender
   is Worker → cap not paused → cap not expired → amount ≤ `max_per_swap`
   → day rollover if elapsed → overflow-safe addition → daily budget not
   exceeded (`auto_swap.move:805`).
7. v7 deposit asserts `Dest` is on `allowed_dest_types`
   (`auto_swap.move:854`, called from `vault.move:569,610`).
8. v7 admin rotation always honors the delay snapshotted at
   `begin_admin_transfer`, even if the delay is later shortened
   (`auto_swap.move:399,654`). Defeats shrink-attacks.

## Upgrade policy

The package upgrade policy is `compatible` (Sui's default). In practice
that means each version can:

- Add new modules, structs, functions, and entry functions.
- Add new fields to existing structs only by introducing a new struct.

It cannot:

- Change existing struct layouts (field added/removed/reordered).
- Change existing function signatures or visibility.

Concretely: the v7 `AutoSwapCapV2<T>` and `AutoSwapRegistryV2` exist
because the v1 `AutoSwapCap<T>` and `AutoSwapRegistry` layouts are
frozen. v7 added throttle fields by minting a new struct and wiring a
user-signed `upgrade_cap_to_v2<T>` migration entry. The legacy v1
validate path is still callable; it just isn't used by the cron. See
`04-move-upgrade-history.md` for the full v1→v7 timeline.

## See also

- `02-move-rbac-and-caps.md` , RBAC, 2-step transfer, kill-switch, throttle.
- `03-move-auto-swap-flow.md` , End-to-end @handle → USDsui flow.
- `04-move-upgrade-history.md` , v1 → v7 change log.
- `05-move-testing.md` , Test layout and how to run.
