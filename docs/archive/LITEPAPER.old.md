# Talise Litepaper v1.0

> Historical document, preserved for context. See docs/generated/codebase/INDEX.md for current architecture. The active litepaper lives at docs/product/LITEPAPER.md.

**Talise**
Invisible Stablecoin Settlement on Sui
A Protocol for Handle-Addressed, Auto-Converting Consumer Payments
*Litepaper · v1.0 · May 2026*

> "If the user has to think about the chain, the chain hasn't done its job yet."
> — Adeniyi Abiodun, Co-founder, Mysten Labs · *Sui Basecamp keynote, 2025*

---

## 1. Abstract

Talise is a consumer payments protocol that turns a Google-signed username into a Sui address that always settles in dollars. A person who claims `@alice.talise.sui` does not run a wallet, does not paste an address, does not hold a gas token, and does not see a swap interface. Anything sent to that handle — SUI, USDC, USDT, or any future supported coin — is auto-converted to **USDsui**, Sui's dollar-pegged native stablecoin, and delivered to the recipient's wallet within sixty seconds. Idle USDsui earns the live Navi supply yield in one tap.

The protocol runs on Sui mainnet. Every Account is a `TaliseVault` shared object owned by a zkLogin-derived address. Every swap is bounded by a per-source-coin capability (`AutoSwapCapV2<T>`) that the user mints and revokes. Every transaction is sponsored by Onara — a Cloudflare-hosted worker that signs as gas payer under a four-role RBAC anchored in `AutoSwapRegistryV2`. Every privileged action emits an on-chain event with a 48-hour cancel window before activation.

This litepaper describes the architecture, the auto-swap loop, the security and recovery model, the user-facing surfaces, and the roadmap by which Talise becomes the default settlement layer for the African remittance corridor.

---

## 2. The Problem

### 2.1 Remittance Is Broken in Africa

The World Bank's Q4 2024 Remittance Prices Worldwide report puts the global average cost of sending USD 200 at **6.65%**. The Sub-Saharan corridor sits at **7.89%**, the highest of any region. A diaspora worker sending GBP 200 from London to Lagos through Western Union routinely loses GBP 14–20 to fees and an additional 2–4% to the spread between the interbank FX rate and the rate the operator quotes. Settlement is measured in days, not seconds. Wire transfers carry minimums of USD 500 or more. Cash pickup requires the recipient to physically present themselves at an agent location with photo ID and a control number. None of this is a technology problem. All of it is the cumulative interest charged by an infrastructure that was built for inter-institutional batch settlement, not for two people moving twenty dollars between each other.

### 2.2 Existing Crypto Is Engineer-Grade

Cryptocurrency networks have, in aggregate, solved the technical problems. Sui finalizes transactions in under a second at sub-cent cost. Stablecoins denominated in dollars are abundant. And yet the experience of sending fifteen dollars in crypto to a non-technical recipient remains worse than any modern fiat payment rail.

The cause is not the chain. The cause is that the wallet has remained an application — something a user must install, secure with a twelve- or twenty-four-word mnemonic, fund with a gas token, and consciously open whenever any other application wants to move value. When a sender opens a wallet to send USDC to an African recipient, both parties must hold the correct asset on the correct chain, both must have funded an EOA with gas, both must know how to verify a base16 or base58 address, and the sender must accept that any typo is unrecoverable.

> "[Seed phrases] are not good enough… hardware wallets alone are not good enough… multi-sig is good… social recovery is better."
> — Vitalik Buterin, *Why we need wide adoption of social recovery wallets*, 2021

The recipient, who is the entire reason the payment is happening, is the one most punished by this design. They are typically less technical than the sender, on a less-capable device, on a less-reliable network, in a jurisdiction where crypto education is uneven, and they are being asked to learn a vocabulary of `mnemonic`, `gas`, `network`, `approve`, `slippage`, and `decimals` in order to receive the equivalent of a month's groceries.

### 2.3 The Missing Layer in Consumer Crypto

What is missing in consumer crypto is not throughput, not finality, not a stablecoin. What is missing is a layer above the chain that does three things together: an **addressable handle** that resolves to a Sui object the user actually owns; an **auto-conversion mechanism** that normalizes every inbound coin into a single dollar-pegged unit before the user has to think about it; and a **gas abstraction** that lets the user transact without ever holding the native fee token.

Each of these has been demonstrated in isolation. SuiNS provides handles. Cetus and Navi provide swap and yield. Mysten and Shinami provide sponsored transactions. None of these compose into a payment surface that an African remittance recipient with a basic smartphone, a Google account, and no prior crypto exposure can use. Talise is the layer that composes them.

---

## 3. Why Now, Why Sui

Three currents have arrived together in the last twelve months. Two are general to consumer crypto. One is specific to Sui.

### 3.1 zkLogin Has Matured

zkLogin produces a Sui-native authenticated address from an OAuth ID token without a seed phrase, without a passkey enrollment, and without trusting any custodian with the user's funds. A user signs in with Google, the dApp generates an ephemeral keypair, a Groth16 prover (Shinami in production, self-hosted as a fallback) produces a zero-knowledge proof that the user authenticated to a given OAuth provider, and the resulting address is recoverable for as long as the user controls the Google account. This is the auth primitive Talise needs and the one Sui happens to have. No equivalent exists at the protocol layer on any competing chain in production today.

### 3.2 Sub-Second Finality and Parallel Execution

Sui's Mysticeti consensus protocol delivers sub-second finality on owned-object transactions and roughly one-second finality on shared-object transactions, the two regimes Talise's auto-swap path crosses. Parallel execution means that 10,000 Talise users converting inbound coins in the same minute do not contend for a single sequencer; they execute concurrently against disjoint vault objects. A consumer payments product cannot ship on a network whose tail latency goes to thirty seconds during congestion.

### 3.3 USDsui — A Sui-Native Dollar

USDsui is a dollar-pegged stablecoin native to Sui. The auto-swap loop has a fixed destination type because the user, by hypothesis, has expressed a preference for dollars and nothing else. Having a native stablecoin — rather than a bridged one — collapses the trust assumptions: there is no canonical-vs-wrapped distinction, no bridge operator to insure, no chain of custody outside Sui itself.

### 3.4 The Accumulator and Sponsored Gas

Two Sui primitives, both of which shipped in the last twelve months, are what make the invisible-auto-swap pattern build at all.

The first is the **address accumulator**. When a sender executes `transfer::public_transfer<Coin<T>>(coin, vault_address)` against a shared-object address, the Coin does not land as an address-owned `Coin<T>` the way it does for plain wallets. Instead it lands inside a dynamic field of the form `dynamic_field::Field<accumulator::Key<Balance<T>>>` attached to the address itself, at the protocol-reserved address `0x000…0acc`. The discovery that the production accumulator path silently overrides the legacy `Receiving<T>` pattern for shared-object recipients is what forced the v5 Move upgrade and the introduction of `receive_from_accumulator<T>(amount)`. Without that path, the cron sees zero balance even when funds have arrived.

The second is **first-class gas sponsorship**. Sui transactions accept a separately-signed gas-payer signature distinct from the sender. Onara — the Talise sponsor worker — produces that signature on every PTB the user submits, paying gas from a sponsor pool the user never touches. The user holds zero SUI and still transacts.

### 3.5 The Build Window

Each of these primitives existed in some form a year ago. None of them existed together, in production, addressable from a single PTB, with a native dollar-pegged stablecoin as the destination, until recently. The cost of waiting compounds: every quarter that an opinionated consumer-payments layer for Sui remains unbuilt is another quarter in which the wrong solutions — bridge-dependent wallets, custodial neobanks, region-specific apps with no portability — fill the vacuum and harden in place.

---

## 4. Talise Protocol Architecture

### 4.1 Architectural Overview

Talise is organized as five layers. The separation is deliberate. The authentication layer can be swapped between Google, Apple, and Facebook zkLogin without touching custody. The handle layer can re-target a user's vault to a new shared-object id without invalidating their address. The vault and capability layers compose with the wider Sui ecosystem (Navi, Cetus, DeepBook) without modification.

```
┌─────────────────────────────────────────────────────────────────────┐
│                              On-chain (Sui)                          │
│                                                                      │
│   ┌────────────────────────┐         ┌────────────────────────┐     │
│   │  AutoSwapRegistryV2    │         │  TaliseVault           │     │
│   │  shared, singleton     │         │  shared, per-user      │     │
│   │  RBAC: Root/Treasury/  │         │  owner = zkLogin addr  │     │
│   │        Oncall/Worker   │         │  balances: Bag<T>      │     │
│   │  allowed_dest_types    │         │  (transient; drains    │     │
│   │  allowed_providers     │         │   on every swap tick)  │     │
│   │  paused: bool          │         └─────────┬──────────────┘     │
│   └────────────┬───────────┘                   │                    │
│                │ validate_for_swap_v2          │                    │
│   ┌────────────▼───────────┐                   │                    │
│   │  AutoSwapCapV2<T>      │◄──────────────────┘                    │
│   │  shared, per-source    │                                         │
│   │  max_per_swap          │   ┌──────────────────┐                  │
│   │  max_per_day           │   │  SwapTicket      │                  │
│   │  used_today            │   │  (hot potato)    │                  │
│   │  day_reset_at_ms       │   │  vault_id bound  │                  │
│   │  expires_at_ms         │   └──────────────────┘                  │
│   │  paused                │                                         │
│   └────────────────────────┘   Closer: auto_swap_deposit_to_owner_v2 │
│                                Transfers Coin<USDsui> → vault.owner  │
│                                                                      │
│   Yield path: Navi USDsui supply pool (one-tap, real APY)           │
└──────────────────────────────────────────────────────────────────────┘
                ▲                ▲                 ▲
                │ enable / pause │ claim + swap    │ send PTB
                │ (user signs,   │ (worker signs,  │ (user signs,
                │  sponsored)    │  sponsored)     │  sponsored)
┌───────────────┼────────────────┼─────────────────┼───────────────────┐
│               │           Off-chain              │                    │
│               │                                  │                    │
│   ┌─────────────────┐    ┌────────────────────┐    ┌──────────────┐  │
│   │  iOS / Web      │    │  Onara CF Worker   │    │  SuiNS        │ │
│   │  zkLogin/Google │    │  + Vercel cron     │    │  resolver     │ │
│   │  ephemeral key  │    │  Cetus aggregator  │    │ *.talise.sui  │ │
│   │  Shinami proof  │    │  policy gate       │    │ → vault.id    │ │
│   └─────────────────┘    └────────────────────┘    └──────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

| Layer | Responsibility | Realized through |
|---|---|---|
| Authentication | Identifying the user; producing a Sui address from an OAuth ID token | zkLogin, Google sign-in, Shinami prover (self-hosted fallback in `prover/`) |
| Handle | Resolving a human-readable name to the user's vault shared-object id | SuiNS subnames under `talise.sui` |
| Vault | Holding the user's per-coin `Balance<T>` between arrival and conversion | `TaliseVault` shared object, owner-gated withdraws |
| Capability | Bounding what the worker may do on the user's behalf | `AutoSwapCapV2<T>` shared object, per-day throttle, expiry, pause |
| Execution | Claim, swap, deliver, sponsor gas | Onara CF Worker, Vercel cron, Cetus aggregator, Sui sponsored tx |

### 4.2 The Authentication Layer

Talise replaces seed phrases and wallet installs with zkLogin. The user signs in with Google. The client generates an ephemeral Ed25519 keypair, base64url-encodes the public key into the OAuth nonce (the fix in commit `00653cc`), and receives an ID token bound to that ephemeral key. The Shinami prover produces a Groth16 proof that the ID token came from Google for the recorded ephemeral key and salt. The proof is cached and round-trips through the iOS keychain (the regression fixed in commit `4180d5a` was that the cached `AnyCodable` had been stringifying the inner JSON). The resulting address is the user's permanent Sui address. Recovery is Google account recovery: the user does not have a seed phrase to lose because there is no seed phrase to begin with.

Signing follows the same construction the Mysten dapp-kit specifies. The web path is implemented in `web/lib/zksigner.ts`; the iOS path is in `ios/Talise/Auth/ZkLoginCoordinator.swift`. Both submit the user-signed transaction bytes plus the zkLogin signature to Onara for sponsorship.

### 4.3 The Vault Layer

Every Talise user has exactly one `TaliseVault`, a shared object created by `vault::create(ctx: &mut TxContext)`. The vault is the SuiNS resolution target for the user's handle. It holds inbound coins as `Balance<T>` inside a `sui::bag::Bag` between arrival and conversion, and it asserts ownership on every mutating call:

```move
public struct TaliseVault has key {
    id: UID,
    owner: address,
    balances: Bag,
    deposits_total: u64,
    auto_swaps_total: u64,
}
```

The withdraw path is owner-gated:

```move
public entry fun withdraw_and_send<T>(
    vault: &mut TaliseVault,
    amount: u64,
    recipient: address,
    ctx: &mut TxContext,
) {
    assert!(ctx.sender() == vault.owner, E_NOT_OWNER);
    // ...
}
```

The bag is intentionally transient. Auto-swap closes by transferring the converted `Coin<USDsui>` directly to `vault.owner` — the user's plain wallet — and by simultaneously flushing any stale residual balance of the same destination type out of the bag. The vault's steady-state is empty.

### 4.4 The Capability Layer

`AutoSwapCapV2<T>` is a per-user, per-source-coin shared object that represents user consent for the worker to convert `Balance<T>` from the user's vault into a destination type on the registry's allowlist. The cap is minted by the owner via `enable_auto_swap_v2`. The cap carries bounds:

```move
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

The worker-facing validator asserts each bound on every call:

```move
public(package) fun validate_for_swap_v2<T>(
    registry: &mut AutoSwapRegistryV2,
    cap: &mut AutoSwapCapV2<T>,
    amount: u64,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert!(!registry.paused, E_REGISTRY_PAUSED);
    let sender = ctx.sender();
    assert!(vector::contains(&registry.worker_addresses, &sender), E_NOT_WORKER);
    assert!(!cap.paused, E_CAP_PAUSED);
    if (cap.expires_at_ms != 0) {
        assert!(clock.timestamp_ms() <= cap.expires_at_ms, E_CAP_EXPIRED);
    };
    assert!(amount <= cap.max_per_swap, E_AMOUNT_EXCEEDS_CAP);
    // day rollover + overflow-safe accumulation + daily budget
    // ...
}
```

The cap is mutated by the worker only to update `used_today`. All other mutations (`pause`, `resume`, `update_bounds`, `disable`) assert `ctx.sender() == cap.owner` and are user-driven.

### 4.5 The Handle Layer

Handle resolution uses SuiNS subnames under the protocol-owned `talise.sui` second-level name. A user who claims `alice` gets `alice.talise.sui`, whose `target_address` record points to the user's `TaliseVault` shared-object id. The sender's client resolves the subname to the vault id and constructs a `transfer::public_transfer<Coin<T>>(coin, vault_id)` PTB. From the sender's perspective, the handle is the address. From the protocol's perspective, the handle is a portable identity the user keeps across device migrations and even across opting out of Talise.

---

## 5. Security and Recovery Model

### 5.1 Threat Model

Talise's v7 security model bounds the worst case for every actor in the system. The full table is published in `SECURITY-V7.md`. Summary:

| Actor | Trust | Capability | Worst-case if compromised |
|---|---|---|---|
| **Root** (deep cold) | Audit-able | Grant/revoke roles, configure delay | Visible on chain, 48h cancel window before activation |
| **Treasury** (cold, recommended multi-sig) | Trusted | Add/remove allowed dest types, add/remove allowed Cetus providers | Adds malicious dest type → Oncall pauses before activation |
| **Oncall** (warm) | Operationally trusted | Pause / unpause registry | Forced pause (degraded service); no theft path |
| **Worker** (hot, Onara) | Day-to-day | Call `validate_for_swap_v2`, run swaps | Grinds within `max_per_swap` × `max_per_day` per user until Oncall pauses + Root revokes. Funds still land in user wallet (deposit hardwired to `vault.owner`). |
| **Cetus aggregator** | Trusted DEX | Provides swap routes | Bad price bounded by 2% Move-level slippage cap + provider allowlist |
| **End user** | Self-trusted | Withdraw, pause, disable, migrate own caps | N/A — user controls their own funds |
| **Random actor** | Untrusted | `deposit`, `receive_*`, query state | None — every state-changing call's destination is hardwired |

### 5.2 The 4-Role RBAC

`AutoSwapRegistryV2` is the central authority object. It carries a four-role separation:

- **Root**: holds the default-admin slot; only Root can grant or revoke the other three roles.
- **Treasury**: configures `allowed_dest_types` (initially `[USDsui]`) and `allowed_providers` (initially `[CETUS, DEEPBOOKV3, AFTERMATH, CETUSDLMM]`).
- **Oncall**: holds `pause_registry` / `unpause_registry`. Single warm key is acceptable because the worst case is forced pause.
- **Worker**: holds the call site for `validate_for_swap_v2`. The Onara CF Worker holds this role and only this role.

Default-admin transfer is two-step with a 48-hour delay and an explicit cancel window. The delay itself is governed by a separate timelock (`MAX_DELAY_INCREASE_WAIT_MS = 48h`) so an attacker cannot tighten the delay to instantly rotate. Both transfers and delay changes are anchored against snapshots taken at proposal time to defend against shrink-attacks where Root tries to lower the delay during a pending transfer.

The Move surface is rooted in `OpenZeppelin/contracts-sui` v1.1.0. We evaluated `openzeppelin_access::access_control` for the full RBAC and ultimately implemented role membership directly because of an OTW + upgrade-policy interaction in the audited library that prevented us from initializing `AccessControl<TaliseRoot>` after publish under `compatible` upgrade policy. The same OZ math primitives — `openzeppelin_math::core::u64::checked_add` — are used for `used_today + amount` so we abort cleanly on overflow rather than silently wrap. Rationale documented in `SECURITY-V7.md` under "OZ Contracts for Sui — what we adopt."

### 5.3 Allowlists and Throttles

Three independent bounds constrain what the worker can do:

1. **Destination-type allowlist** — `vector<TypeName>` on the registry. Asserted in `auto_swap_deposit_to_owner_v2<Dest>` via `assert_dest_allowed<Dest>`. A compromised Worker cannot route swap output to any type not on the list. The initial list contains exactly `USDsui`.
2. **Provider allowlist** — `vector<vector<u8>>` on the registry, matched against the Cetus aggregator's `provider` field at PTB-build time. Tightens which DEXs the aggregator may route through.
3. **Per-cap daily throttle** — `max_per_day` and `used_today` on `AutoSwapCapV2<T>`, with day rollover when `now_ms >= day_reset_at_ms`. Overflow-safe addition via `checked_add`. Demo defaults are conservative: 10 SUI / 100 SUI per day; 10 USDC / 100 USDC per day; 10 USDT / 100 USDT per day. The user adjusts via `update_cap_bounds_v2`.

A Move-level **slippage hard ceiling** of 2% is asserted at the deposit site: `output_amount * 100 >= expected_amount * 98`. A compromised Onara configuration that accepts a 50%-slippage Cetus route is rejected on chain.

### 5.4 Recovery

zkLogin recovery is Google account recovery. There is no seed phrase to back up, no passkey to enroll on multiple devices, no social-recovery setup to bootstrap. A user who loses their iPhone signs in to a new device with Google, the dApp re-derives the ephemeral key, requests a fresh zkLogin proof from Shinami, and resumes against the same `TaliseVault`. The vault is a shared object — its address does not depend on the device.

For the case where the user loses access to their Google account itself, recovery is the same recovery Google offers: trusted contacts, backup codes, account-recovery support. Talise inherits whatever guarantees the underlying identity provider chose to make. This is the same trade Apple Cash makes when it inherits iCloud recovery.

### 5.5 Audit Posture

Move test coverage as of v7 is **66 / 66 tests passing** across `auto_swap_v7_tests.move` (21 tests for role grants, pause, allowlist, throttle, day rollover, overflow) and the legacy `auto_swap_tests.move` and `vault_tests.move` (45 tests retained for back-compat). Test scenarios include: malicious Worker grinding `used_today` to overflow; compromised Worker depositing to a non-USDsui type; pending admin transfer cancelled mid-flight; delay-change reverted; expired cap rejected after timestamp boundary.

The OpenZeppelin `contracts-sui` v1.1.0 audit reports (`audits/2026-03-v1.0.0.pdf`, `audits/2026-04-v1.1.0-diff.pdf`, `audits/2026-04-v1.1.0-fp-math.pdf`) cover the math primitives we adopt. **External audit of the Talise package itself is scoped before any deployment exceeds USD 10,000 AUM.** Candidate firms documented in `SECURITY-V7.md`: OtterSec, Movebit, Zellic.

Move Prover invariants (e.g. `amount > 0 ∧ used_today + amount ≤ max_per_day ⟹ post.used_today = pre.used_today + amount`) are out of scope for v1 and listed as future work.

---

## 6. The Auto-Swap Loop in Detail

### 6.1 The Four-Step Path

A single auto-swap closes in one PTB containing four calls:

```
Step 1.  claim       — vault::receive_from_accumulator<Source>(amount)
                       (or receive_from_accumulator_to_owner<USDsui> for the
                        destination type — single-tick path, no bag stopover)
Step 2.  extract     — vault::auto_swap_extract_v2<Source>(vault, registry,
                       cap, amount, clock, ctx)
                       → returns (Balance<Source>, SwapTicket)
Step 3.  swap        — Cetus aggregator route: Balance<Source> → Balance<USDsui>
                       (provider must be on registry.allowed_providers)
Step 4.  deliver     — vault::auto_swap_deposit_to_owner_v2<USDsui>(vault,
                       registry, balance_usdsui, ticket, clock, ctx)
                       → asserts USDsui ∈ allowed_dest_types
                       → asserts ticket.vault_id == vault.id
                       → transfers Coin<USDsui> to vault.owner
                       → flushes any stale USDsui residue from the bag
```

Three properties hold together:

1. **The hot potato cannot escape.** `SwapTicket` has no `drop`, no `store`, no `copy`, no `key`. The only thing the runtime can do with the ticket is hand it to a `deposit_*_v2` function before the transaction ends. A worker who extracts cannot walk away without depositing.
2. **The deposit cannot redirect.** The ticket carries `vault_id` captured at extract time. The deposit function asserts `ticket.vault_id == object::id(vault)`, so funds cannot be siphoned to another vault inside the same PTB.
3. **The destination is hardcoded.** `auto_swap_deposit_to_owner_v2<Dest>` transfers to `vault.owner` — there is no recipient parameter. A compromised worker who passes a different `vault` argument fails the ticket-vault-id assertion. A compromised worker who passes the right vault is forced to send to the right user.

### 6.2 Gas Sponsorship via Onara

The user signs the PTB with their zkLogin signature; Onara signs separately as gas payer. Sui's transaction format accepts the two signatures independently. Onara is implemented as a Cloudflare Worker (`onara/api/src/autoSwap.ts`, function `handleAutoSwap`). It runs a policy gate before adding the sponsor signature: the transaction must originate from a known Talise UI; the targets must be the canonical Talise package and registry; the gas budget must be under a configured ceiling. The sponsor key is derived from a single mnemonic held in CF Workers Secrets.

Onara is opinionated about what it signs. It is also self-contained: the API surface is documented and Onara could in principle be self-hosted by an integrator that wants to sponsor its own users' Talise transactions.

### 6.3 The Accumulator Path

Sui mainnet's current behavior for `transfer::public_transfer<Coin<T>>(coin, shared_object_address)` routes the deposit through the address accumulator at `0x000…0acc`, attached as `dynamic_field::Field<accumulator::Key<Balance<T>>>` keyed by the recipient's UID. The legacy `Receiving<T>` claim path silently misses these deposits. Talise's v5 upgrade introduced `receive_from_accumulator<T>(amount)`; the v6 upgrade introduced `receive_from_accumulator_to_owner<T>(amount)` for the case where the inbound coin is already USDsui, so the destination type bypasses the bag entirely.

This was a discovery, not a design. Surfacing the right RPC method to drain accumulator slots — and getting that to compose with shared-object claim semantics — was the gating piece between "auto-swap demo" and "auto-swap that closes on mainnet."

### 6.4 Slippage Discipline

Onara requests Cetus aggregator quotes with a configured slippage tolerance (default 1%). The Move-level deposit asserts the realized output is no worse than 2% below the expected output. The combined effect: an Onara misconfiguration that loosens the off-chain slippage cap still fails on chain.

---

## 7. Surfaces

Talise is consumed through multiple independent surfaces. None is privileged over the others; the protocol does not assume any specific client.

### 7.1 The iOS Reference Client

The first surface is a SwiftUI iOS application. It exercises the entire protocol: zkLogin sign-in (`ZkLoginCoordinator.swift`), vault creation, handle claim, send (`SendView.swift`), receive (passive — the cron does it), auto-swap settings (`AutoSwapSettings.swift`), yield (`EarnView.swift`), history, and receipts (`TxReceiptView.swift`). The client targets gRPC primary with JSON-RPC fallback for resilience. It is intentionally the only surface that needs to demo end-to-end. It is also one of many possible clients.

### 7.2 The Web Application

`talise.app` is the production landing surface and the waitlist gate. `app.talise.app` will host the in-app web surface. The web codebase shares the Move bindings and the Onara client with iOS. Send, receive, earn, and settings are all reachable from web; the auto-swap cron is part of the web deploy and runs on Vercel's cron primitives, sweeping at one-minute cadence (`web/app/api/cron/auto-swap-sweep/route.ts`).

### 7.3 The Onara Worker

Onara is the gas-sponsorship layer. It is a Cloudflare Worker (`onara/api/`) with a documented HTTP API: `POST /sponsor` accepts a partially-signed PTB and returns the same PTB with the sponsor signature attached. The policy gate is configurable per integrator. Self-hosting is an explicit goal; an app that wants to sponsor its own users' Talise transactions deploys its own Onara instance against its own sponsor key.

### 7.4 Future: Developer SDK

A v2 deliverable is a TypeScript SDK that exposes the same surface third-party Sui apps would need to do auto-swap-as-a-service: claim a `TaliseVault`, mint `AutoSwapCapV2<T>`, register a webhook for `VaultAutoSwap` events. The SDK is documented as future work in this paper because the canonical client surface (iOS, web) is shipping first.

---

## 8. Why Talise Is Different

### 8.1 vs. Traditional Remittance Rails

Wise, Remitly, MoneyGram, and Western Union are correspondent-banking products. Each transfer is a message routed between regulated institutions across one or more currency boundaries. Settlement requires a corresponding institution at the destination. Costs are dominated by the FX spread and the cost of inter-bank settlement. Talise does not operate a balance sheet. Funds land on a public chain in the recipient's own vault, denominated in USDsui from the moment the swap closes. The remittance loop closes when an off-ramp partner converts USDsui to local fiat at the destination, paying off-ramp fees that Talise does not control. The "Talise stack" portion of the cost is essentially the Sui transaction fee — sponsored by Onara — plus the Cetus aggregator slippage. For USD 200 in volume on a liquid pair, that combined cost is under USD 0.50.

### 8.2 vs. Generic Sui Wallets

Phantom, Suiet, and Slush are wallets. They are applications a user opens, secures with a mnemonic or passkey, funds with gas, and explicitly switches to whenever any other application wants to move value. They expose every Sui primitive the user might want — multiple coin types, multiple chains, manual swaps, manual yield, contract approvals. They are excellent tools for users who want to be sovereign over a portfolio. They are the wrong abstraction for a recipient who just wants the equivalent of fifteen dollars in dollars.

Talise inverts the assumption. The user does not see a coin type. The user does not see a swap UI. The user does not see a gas budget. The user sees a handle, an inbound amount in local currency, and a balance.

### 8.3 vs. Embedded-Wallet SDKs

Privy, Magic, and Web3Auth are SDKs for developers who want to embed a wallet inside their application. They abstract the key-management problem at the SDK boundary, but each integration is its own silo: two applications using the same embedded-wallet provider produce two separate user-facing accounts. Talise's positioning is the opposite. The Account is bound to the user's Google identity and resolves to a single `TaliseVault` regardless of which Talise-integrated surface invokes it.

Talise is the destination. It is not the SDK.

### 8.4 vs. Xend

Xend is the most architecturally similar product in the consumer-crypto-payments space, and it deserves a direct comparison. Xend is built on Solana; Talise on Sui. Xend authenticates via WebAuthn passkeys bound to Squads Grid embedded smart accounts; Talise authenticates via zkLogin, with no passkey enrollment required. Xend's differentiator is OS-level intent routing — the Apple-Cash-of-Solana pattern. Talise's differentiator is the invisible auto-swap — every inbound coin is normalized to USDsui within the recipient's wallet inside sixty seconds. Both are valid bets. They are not competitors so much as they are two different theses about which UX gap consumer crypto needs to close first. Talise picked Sui because: (a) zkLogin removes the passkey-enrollment step entirely, which matters when the recipient is on a low-spec Android device; (b) the accumulator + sponsored-gas primitive supports the invisible-auto-swap pattern as a single PTB; (c) USDsui is a native dollar, not a bridged one.

---

## 9. Use Cases

### 9.1 Diaspora Remittance (the wedge)

A construction worker in London opens Talise on iOS. He types `mom.talise.sui` in the To field, types `200` in the GBP field (the app shows ~£200 → ~₦382,500 at the current FX), and taps Send. Onara sponsors the gas. The transaction closes on Sui in under a second. Within 60 seconds, the Vercel cron picks up the inbound coin at `mom.talise.sui`'s vault, claims from the accumulator, routes through Cetus to USDsui, and delivers `Coin<USDsui>` to the recipient's plain Sui wallet. The recipient's iOS app shows `₦ 382,500` as a fresh entry in the activity feed. Total elapsed time: 10–15 seconds end-to-end.

### 9.2 Freelancer Receiving USDC

A graphic designer in Nairobi gets paid USD 800 in USDC from a US client. The client sends to `chioma.talise.sui` — they do not know or care that the destination chain is Sui. The cron sweeps the inbound USDC and routes it through Cetus to USDsui. The freelancer's wallet now holds 800 USDsui, displayed as `KSh 103,200` (the iOS FX layer renders local currency primary, USD secondary, USDsui invisible).

### 9.3 Yield-Bearing Idle Balance

The freelancer above does not need the funds for two weeks. She opens the Earn tab. The app shows "9.17% APY on idle dollars" — the live Navi USDsui supply rate, fetched from `fetchNaviUsdsuiSupplyApy` in `web/lib/navi-supply.ts`. She taps Supply. One zkLogin-signed, Onara-sponsored PTB later, her USDsui is in the Navi supply pool and accruing interest. Withdraw is symmetric: one tap, one PTB, immediate liquidity.

### 9.4 Family-Pool Savings (future)

A planned use case is family-pool savings under SuiNS subnames. A diaspora worker reserves `family.talise.sui` and creates child handles (`mom.family.talise.sui`, `sister.family.talise.sui`) that route to distinct vaults. The worker can broadcast a single PTB that splits an inbound transfer across the children's vaults. This is future work; the SuiNS subname tree supports it, but the splitting PTB and the iOS UI are not built yet.

---

## 10. Roadmap

### Live (Q2 2026)

- **Move package v7** published on Sui mainnet. `AutoSwapRegistryV2`, four-role RBAC, per-cap daily throttle, dest + provider allowlists, global pause, slippage hard ceiling. 66 / 66 Move tests passing.
- **iOS in private beta.** zkLogin sign-in, vault create, send, receive, auto-swap, Earn (Navi). gRPC primary + JSON-RPC fallback.
- **Onara worker** running on Cloudflare with Vercel-cron sweep, signing as gas payer + Worker role.
- **Web waitlist** live at `talise.app`.

### Q3 2026

- **External audit** of the Talise Move package. Candidate firms: OtterSec, Movebit, Zellic.
- **Fiat off-ramp** in Lagos via a Yellow Card or Onramper reverse-flow partner. Closes the loop from "USDsui in wallet" to "Naira in bank account."
- **v8 one-tap onboarding** via `create_with_default_caps<T1, T2, T3>` — vault creation and default cap minting in a single PTB so new users sign once.

### Q4 2026

- **Multi-corridor expansion** — Kenya (M-Pesa off-ramp), Ghana (mobile money), South Africa (instant-EFT).
- **Developer SDK** for TypeScript — auto-swap-as-a-service for other Sui apps.
- **APNs push** on auto-swap close so the recipient sees the converted amount land without opening the app.

### 2027

- **Mainnet-ready audit closure** (post-audit fixes shipped, Move Prover invariants formalized where applicable).
- **Regulated entity** in target markets — initially as a payment-services license in Nigeria and a remittance license in Kenya.
- **OS-level intent routing** — handle taps in iMessage, Safari, and select third-party iOS apps route into the Talise payment sheet. (This is the Xend-style ambition but on Sui.)

---

## 11. Conclusion

Talise is bank-quality consumer payments hidden inside a Sui address. The infrastructure is shipped: seven versions of the Move package, a four-role RBAC anchored in `AutoSwapRegistryV2`, an accumulator-aware claim path that closes against mainnet's actual deposit semantics, a per-cap daily throttle that bounds any operational compromise, a 2% Move-level slippage ceiling that resists off-chain misconfiguration, an Onara sponsor that lets the user transact without ever holding gas, and a zkLogin auth path that lets the user sign in with Google and never see a seed phrase.

The next twelve months are about scaling distribution and depth, not invention. External audit. Fiat off-ramp. Multi-corridor expansion. Single-PTB onboarding. Push notifications. None of these require a new primitive. All of them require careful product, partnership, and regulatory work in the markets that need the product most.

The applications are where the protocol becomes visible. The protocol is where the value lives.

---

## 12. References

1. Mysten Labs. *Sui — The Programmable Settlement Layer*. https://sui.io/
2. Blackshear, S. et al. *Move: A Language With Programmable Resources*. Mysten Labs.
3. Mysten Labs. *zkLogin: A Privacy-Preserving Identity Solution for Sui*. https://docs.sui.io/concepts/cryptography/zklogin
4. Mysten Labs. *Sponsored Transactions on Sui*. https://docs.sui.io/concepts/transactions/sponsored-transactions
5. SuiNS Foundation. *Sui Name Service Documentation*. https://docs.suins.io/
6. World Bank. *Remittance Prices Worldwide Quarterly*, Issue 51, Q4 2024. https://remittanceprices.worldbank.org/
7. Cetus Protocol. *Cetus Aggregator API Documentation*. https://cetus-1.gitbook.io/cetus-developer-docs/
8. Navi Protocol. *NAVI Protocol Lending Documentation*. https://naviprotocol.gitbook.io/
9. OpenZeppelin. *OpenZeppelin Contracts for Sui v1.1.0*. https://github.com/OpenZeppelin/contracts-sui (audits: `2026-03-v1.0.0.pdf`, `2026-04-v1.1.0-diff.pdf`, `2026-04-v1.1.0-fp-math.pdf`).
10. Shinami. *Managed zkLogin Prover and Gas Station*. https://docs.shinami.com/
11. Buterin, V. *Why we need wide adoption of social recovery wallets*. vitalik.ca, January 2021.
12. Talise. *AUTOSWAP.md — Auto-Swap Architecture and Version History*. `/move/talise/AUTOSWAP.md`.
13. Talise. *SECURITY-V7.md — v7 Threat Model, RBAC, and Migration Plan*. `/move/talise/SECURITY-V7.md`.
14. Talise. *HACKATHON.md — Sui Overflow 2026 Submission Notes*. `/HACKATHON.md`.

---

*talise.app · Talise Litepaper v1.0 · May 2026*
