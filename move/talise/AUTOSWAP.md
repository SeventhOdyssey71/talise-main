# Talise Auto-Swap

On-chain delegated auto-swap. Any coin sent to a user's `@talise`
subname gets converted to USDsui and **delivered straight to the
user's plain wallet**, gas sponsored by Onara, with no per-swap user
signature.

The vault is plumbing the user never has to think about. Cash in →
USDsui in their wallet → spend.

## Architecture in one picture

```
┌──────────────────────────────────────────────────────────────────┐
│                          On-chain                                 │
│                                                                   │
│   ┌───────────────────────┐         ┌───────────────────────┐    │
│   │  AutoSwapRegistry     │         │  TaliseVault          │    │
│   │  (shared, singleton)  │         │  (shared, per-user)   │    │
│   │  admin = worker addr  │         │  owner = user addr    │    │
│   └───────────┬───────────┘         │  balances: Bag<T>     │    │
│               │                     │  (transient, drained  │    │
│               │ validate_for_swap   │   on every swap)      │    │
│   ┌───────────▼───────────┐         └──────────┬────────────┘    │
│   │  AutoSwapCap<T>       │◄───────────────────┘                 │
│   │  (SHARED — v3+)       │     hardwired vault_id               │
│   │  max_per_swap         │                                      │
│   │  expires_at_ms                                               │
│   │  paused                                                      │
│   └───────────────────────┘                                      │
│                                                                   │
│   Output path (v4+):                                              │
│   auto_swap_deposit_to_owner — transfers Coin<USDsui> directly    │
│   to vault.owner (the user's plain wallet) instead of stashing    │
│   it in the bag. Also flushes any stale bag balance for the same  │
│   Dest type on every tick, so leftovers from older swaps clear    │
│   automatically.                                                  │
└──────────────────────────────────────────────────────────────────┘
                              ▲                  ▲
                              │ enable / pause   │ withdraw (rarely)
                              │                  │
┌─────────────────────────────┼──────────────────┼──────────────────┐
│                       Off-chain                                    │
│                                                                    │
│   ┌─────────┐    ┌──────────────────────┐    ┌─────────────────┐  │
│   │  iOS    │    │  Onara worker         │    │  SuiNS          │  │
│   │  app    │    │  (CF Worker)          │    │  resolution     │  │
│   └─────────┘    └──────────────────────┘    └─────────────────┘  │
│        │                  │                          │             │
│        │ sign-as-user     │ sign-as-worker           │             │
│        │                  │  via Vercel cron, 1/min  │             │
│        ▼                  ▼                          ▼             │
│      enable / pause     receive_and_deposit  ─→  cap-bounded swap  │
│      migrate-cap        (claim address-owned ─→  auto_swap_extract │
│      withdraw           coins into bag)       ─→  Cetus aggregator │
│                                               ─→  deposit_to_owner │
│                                                                    │
│                       eromonsele.talise.sui → vault.id            │
└────────────────────────────────────────────────────────────────────┘
```

## What a single user transaction looks like

1. Alice types her handle into someone's "Send to" field and the
   sender hits Send. SuiNS resolves `alice.talise.sui` to her vault
   shared-object id — not her plain wallet.
2. The coin (SUI, USDC, USDT, whatever) lands at the vault address as
   an address-owned `Coin<T>`. Address-owned because the vault is a
   shared object and you can't transfer directly *into* a shared bag.
3. Within ≤60s the Vercel cron picks it up:
   - **Step A — claim**: `vault::receive_and_deposit<T>` folds the
     address-owned coin into `vault.balances` (the bag). This requires
     no user signature; the worker signs as Onara.
   - **Step B — swap**: `vault::auto_swap_extract<Source>` pulls a
     `Balance<Source>` out of the bag, hands back a `SwapTicket` hot
     potato; Cetus aggregator routes Source → USDsui; the hot potato
     is closed by `vault::auto_swap_deposit_to_owner<USDsui>`, which:
     - Transfers the swap output as `Coin<USDsui>` to `vault.owner`.
     - Also empties any prior `Balance<USDsui>` left over in the bag
       (the migration-friendly flush for accounts that hold pre-v4
       residue), so the user wallet receives both in one tx.
4. Alice sees the USDsui appear in her wallet balance — same place
   she sees every other coin. The vault never gives her a number to
   reason about.

## Modules (this folder)

- **`sources/auto_swap.move`** — consent + bounds.
  - `AutoSwapRegistry` (shared, singleton): records the global admin
    address allowed to validate swaps.
  - `AutoSwapCap<phantom T>`: per-user-per-source-coin opt-in. **Shared
    object since v3** (was user-owned in v1/v2 — see migration notes
    below). Bounds: `max_per_swap`, `expires_at_ms`, `paused`.
  - `enable_auto_swap` (in `vault.move`) / `disable` / `pause` /
    `resume` / `update_bounds` — user-facing consent surface. Owner
    asserted on every mutation via the recorded `cap.owner` field.
  - `validate_for_swap` — `public(package)`: asserts (admin == sender,
    not paused, not expired, amount ≤ cap). Called by
    `vault::auto_swap_extract`.

- **`sources/vault.move`** — custody + swap entries.
  - `TaliseVault` (shared, per-user): `Bag` of `Balance<T>`. Anyone
    can `deposit`; only `vault.owner` can `withdraw` / `withdraw_and_send`.
  - `receive_and_deposit<T>` (v2+): claims an address-owned
    `Coin<T>` sent to the vault address into the bag. The cron's
    Step A.
  - `auto_swap_extract<Source>`: worker-signed extract; runs
    `validate_for_swap`, splits `Balance<Source>` out of the bag,
    returns it alongside a `SwapTicket`.
  - **`auto_swap_deposit_to_owner<Dest>` (v4+)** — the swap closer.
    Consumes the `SwapTicket`, joins the swap output with any stale
    bag balance for the same `Dest` type, transfers the combined
    `Coin<Dest>` to `vault.owner`. **This is the function that puts
    USDsui in the user's actual wallet.**
  - `auto_swap_deposit<Dest>` (legacy, v1–v3): older closer that
    deposited output into the bag. Kept for backwards-compatible call
    paths but no longer the path the cron takes — see the upgrade
    notes.
  - `share_existing_cap<T>` (v3+): one-shot promoter for v2-era
    user-owned caps. Owner signs once, cap becomes shared.

## Version history + migration

| Version | Package id | What changed |
|---------|-----------|--------------|
| v1 | `0xc74a7df0…d394` | Original publish (this is `original-id` for type tags forever). Caps minted user-owned. |
| v2 | `0x45654c43…9046` | Adds `receive_and_deposit<T>`. Caps still user-owned. |
| v3 | `0x4ae445e0…4e55` | Caps now **shared on mint**. Worker can reference them. Adds `share_existing_cap<T>` for in-place v2→v3 cap migration. |
| v4 | `0x29a0d730…715a` | Adds `auto_swap_deposit_to_owner<Dest>`. Auto-swapped USDsui lands in user's wallet, not in the bag. Stale bag balances drain on every swap. |

**Env vars (production):**

- `TALISE_AUTOSWAP_PACKAGE_ID` — `original-id` (v1). Used for type
  tags, `AutoSwapEnabled` event filters, registry references. Never
  changes.
- `TALISE_AUTOSWAP_PACKAGE_LATEST` — `published-at` of the latest
  upgrade (v4 today). Used as the target for entry-function calls
  that exist only in newer versions: `enable_auto_swap`,
  `share_existing_cap`, `receive_and_deposit`, `auto_swap_deposit_to_owner`.
- `TALISE_AUTOSWAP_REGISTRY_ID` — `AutoSwapRegistry` shared-object id.

## Tests

Move package coverage as of the v2 ship was 100%. Tests are unchanged
since v3/v4 added new functions but didn't alter existing behavior;
the v4 deposit-to-owner path needs a dedicated test (TODO — see "Open
questions" below).

## Open questions / future work

- **Test coverage for `auto_swap_deposit_to_owner`.** Add unit tests
  covering:
  - Swap output transferred to `vault.owner` (not stuck in bag).
  - Stale bag balance for the same `Dest` type flushed on first swap.
  - `E_WRONG_VAULT` when a ticket from vault A is deposited into B.
- **Single-tx onboarding.** A v5 `create_with_default_caps<T1, T2, T3>`
  entry function returning the vault id and minting SUI/USDC/USDT
  shared caps in one shot — so new users sign once total, not twice
  (vault create + enable defaults).
- **Destination allowlist.** Today nothing constrains `Dest` on
  `auto_swap_deposit_to_owner`. The cron always picks USDsui, but a
  compromised cron could route somewhere else. A registry-level
  allowlist asserted inside the deposit function would close that.
- **DEX allowlist.** Same idea for the swap venue — approved Cetus
  pool ids on `AutoSwapRegistry`, asserted by a `validate_pool` step.
- **Per-user period throttle.** `max_per_swap` bounds amount per swap,
  not per period. A `swapped_today` field on the cap (reset on day
  rollover) would force a malicious admin to drip-drain over time.
- **Admin rotation.** v1 hardwires `admin` at publish. An `AdminCap`-
  gated `rotate_admin(registry, &AdminCap, new_admin)` is overdue.
- **Pause-the-world.** A registry-level pause flag that disables every
  cap at once — useful incident-response lever.
