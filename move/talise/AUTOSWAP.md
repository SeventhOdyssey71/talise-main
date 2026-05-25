# Talise Auto-Swap (Path C)

On-chain delegated auto-swap. Lets a user's `@talise` subname always
hold USDsui — any other coin sent to that handle gets swapped to
USDsui automatically, gas sponsored by Onara, with no per-swap user
signature.

## Architecture in one picture

```
┌─────────────────────────────────────────────────────────────────┐
│                          On-chain                                │
│                                                                  │
│   ┌───────────────────────┐         ┌──────────────────────┐    │
│   │  AutoSwapRegistry     │         │  TaliseVault         │    │
│   │  (shared, singleton)  │         │  (shared, per-user)  │    │
│   │  admin = worker addr  │         │  owner = user addr   │    │
│   └───────────┬───────────┘         │  balances: Bag<T>    │    │
│               │                     └──────────┬───────────┘    │
│               │ validate_for_swap              │                │
│               │                                │ deposit / withdraw
│   ┌───────────▼───────────┐                    │                │
│   │  AutoSwapCap<T>       │◄───────────────────┘                │
│   │  (user-owned)         │     hardwired vault_id              │
│   │  max_per_swap         │                                     │
│   │  expires_at_ms        │                                     │
│   │  paused               │                                     │
│   └───────────────────────┘                                     │
└─────────────────────────────────────────────────────────────────┘
                              ▲                  ▲
                              │ enable / pause   │ withdraw
                              │                  │
┌─────────────────────────────┼──────────────────┼────────────────┐
│                       Off-chain                                  │
│                                                                  │
│   ┌─────────┐    ┌──────────────────────┐    ┌────────────────┐ │
│   │  iOS    │    │  Onara worker         │    │  SuiNS         │ │
│   │  app    │    │  (CF Worker / cron)   │    │  resolution    │ │
│   └─────────┘    └──────────────────────┘    └────────────────┘ │
│        │                  │                          │           │
│        │ sign-as-user     │ sign-as-worker           │ resolve   │
│        │                  │                          │           │
│        ▼                  ▼                          ▼           │
│      enable/             auto_swap_extract → Cetus → auto_swap   │
│      withdraw/           deposit (atomic PTB)        chiamaka    │
│      pause                                           @talise →   │
│                                                      vault id    │
└──────────────────────────────────────────────────────────────────┘
```

## Modules (this folder)

- **`sources/auto_swap.move`** — consent + bounds.
  - `AutoSwapRegistry` (shared, singleton): records the global admin
    address allowed to validate swaps.
  - `AutoSwapCap<phantom T>`: per-user-per-source-coin opt-in. Owned
    by the user. Bounds: `max_per_swap`, `expires_at_ms`, `paused`.
  - `enable / disable / pause / resume / update_bounds` — user-facing
    consent surface.
  - `validate_for_swap` — internal-ish: asserts (admin == sender,
    not paused, not expired, amount ≤ cap). Called by `vault::auto_swap_extract`.

- **`sources/vault.move`** — custody.
  - `TaliseVault` (shared, per-user): `Bag` of `Balance<T>`. Anyone
    can `deposit`, only `vault.owner` can `withdraw`.
  - `auto_swap_extract<Source>` — worker-signed extract; runs
    `validate_for_swap`, splits a `Balance<Source>` out of the bag.
  - `auto_swap_deposit<Dest>` — companion that re-injects the swap
    output back into the same vault. Atomic PTB: extract → Cetus →
    deposit, or the whole thing aborts.

## Tests

`tests/auto_swap_tests.move` covers:

- Enable then disable round trip (cap mint + burn).
- Validate rejects amount > cap.
- Validate rejects non-admin sender.
- Validate rejects paused cap.
- Deposit + withdraw round trip.
- Non-owner can't withdraw.

Run: `cd move/talise && sui move test`.

## What's NOT in this folder yet (the remaining work)

This package is the foundation. To ship Path C end to end, four more
pieces have to land. They're independent — any subset can ship to a
testnet for review before the others land.

### 1. Onara worker — auto-swap executor (Cloudflare worker route)

Live polling + PTB composition lives in `onara/api/src/`.

- New endpoint `POST /auto-swap` on Onara worker that:
  - Accepts `{ vaultId, capId, sourceType, amount }` from the trigger.
  - Builds a PTB: `auto_swap_extract` → Cetus swap → `auto_swap_deposit`.
  - Signs as the registered admin address (Onara's sponsor keypair —
    same one already in `wrangler secret SUI_MNEMONIC`).
  - Submits, returns digest.
- Polling source can be one of:
  - Vercel cron that calls `GET /api/auto-swap/sweep` every 60s, which
    in turn calls `getOwnedCoins(vaultAddress)` for every user with an
    active AutoSwapCap and triggers the Onara endpoint when non-USDsui
    is detected.
  - Cleaner: a Sui websocket subscription on `VaultDeposit` events,
    filtered to non-USDsui types, kicking off the swap immediately.
    Better latency, worse failure handling. Start with cron.

### 2. Web backend — SDK + API routes

New routes in `web/app/api/`:

- `POST /api/vault/create` — mints a vault for the signed-in user,
  records `vault_id` on the user row.
- `POST /api/vault/enable-autoswap` — body `{ sourceType, maxPerSwap, expiresAtMs }`,
  builds a PTB calling `auto_swap::enable<T>`, returns it for the
  user's zkLogin to sign.
- `POST /api/vault/pause` / `resume` / `disable` / `update-bounds` —
  user-driven cap management.
- `GET /api/vault/state` — returns the user's vault contents +
  active caps (which coin types are auto-swap-enabled).
- SuiNS subname update: when the vault is created, repoint the user's
  `@talise` subname target from their plain wallet to the vault id
  (already a SuiNS operator move in `lib/suins-lookup.ts`).

### 3. iOS — opt-in + management UI

- Onboarding tail: after username claim, show "Always hold USDsui?
  Enable auto-swap" — one tap mints the vault + caps for the common
  coins (SUI, USDC, USDT).
- Settings → "Auto-convert to USDsui" toggle list per coin type,
  paused/active state, max-per-swap slider.
- Activity feed: render `VaultAutoSwap` events as "Auto-swapped 0.5
  SUI → $1.20 USDsui" rows.

### 4. Mainnet deploy + migration

- `sui client publish --gas-budget 100000000` from this folder, with
  the deploying address being the intended `admin` (= Onara sponsor
  address). Records package id + registry id in env:
  - `TALISE_AUTOSWAP_PACKAGE_ID`
  - `TALISE_AUTOSWAP_REGISTRY_ID`
- For every existing Talise user with a SuiNS subname, surface a
  one-time "Upgrade your wallet" CTA that mints their vault and
  repoints their subname. Old wallets keep working — auto-swap is
  purely additive.
- Audit: at minimum, run `sui-security` static analysis and have a
  second engineer review the `auto_swap_extract` / `validate_for_swap`
  pair end-to-end. Two-step compromise is the only path to fund loss
  (admin key + a leaked cap with high `max_per_swap`), but it's worth
  burning an hour on.

## Open questions / future work

- **Destination allowlist.** Today the Move code doesn't constrain
  the `Dest` type on `auto_swap_deposit`. The off-chain SDK builds
  the PTB with `Dest = USDsui`, but a compromised SDK could route
  somewhere else. v2: add an allowlist of `Dest` type-names to the
  `AutoSwapRegistry`, asserted inside `auto_swap_deposit`.
- **DEX allowlist.** Same idea but for the venue. v2: a `pools`
  field on `AutoSwapRegistry` containing approved Cetus pool ids,
  asserted by an extra `validate_pool` step.
- **Admin rotation.** v1 hardwires `admin` at publish. v2 adds an
  `AdminCap`-gated `rotate_admin(registry, &AdminCap, new_admin)`.
- **Pause-the-world.** A registry-level pause flag that disables every
  cap at once — useful incident-response lever.
- **Per-user accumulator throttle.** Today the cap limits amount per
  swap, not per period. v2: track `swapped_today` in the cap, reset
  daily. Forces a malicious admin to drip-drain over time, buying
  monitoring + revocation time.
