# Hackathon Alignment — DeFi Payments

Track: **Sui Overflow 2026 — Programmable Money, Payments & Financial Systems** ($62.5K pool, 1st = $30K).
Source brief: `BRIEF.md` (verbatim copy of the Mysten Notion page; the live Notion fetch is rate-limited but the captured text matches the public track description and is the authoritative input here).

## TL;DR (why Talise wins)

Talise is a consumer payments app for the African remittance corridor where Sui is invisible plumbing. A diaspora worker signs in with Google (zkLogin), gets `@handle.talise.sui` as their address, and any inbound coin — SUI, USDC, USDT — is auto-converted on-chain to **USDsui** and delivered straight to the recipient's wallet within 60 seconds, with gas sponsored by Onara. The user never sees gas, slippage, or a swap UI; they see naira. Under the hood we ship a real Move package (`TaliseVault` + `AutoSwapCap` capability gate, four versions deployed, 100% test coverage on v2), a cron-driven worker that closes claim→swap→deliver as one PTB via the Cetus aggregator, and Navi-backed yield ("Earn") that lets idle USDsui earn the real Navi USDC supply APY. Programmable money built into the act of receiving — not as a separate DeFi tab.

## Criteria mapping

The brief calls out four explicit top-tier axes plus the four "strong project" baseline traits. Each is mapped below.

### Strong-project baseline

#### 1. Clear financial use case
- **How we satisfy this:** Cross-border remittance into African corridors (Nigeria, Kenya, Ghana, South Africa) is the wedge. USDsui is the canonical store-of-value; local currency (₦, KSh, GH₵, R) is the display layer. The use case is stated in `README.md:3-5` and elaborated in `STRATEGY.md`. Sender experience: type `sele@talise` → hit Send → done. Recipient experience: USDsui already in wallet, settled to local FX on screen.
- **Code:** `web/lib/fx.ts` (currency display), `ios/Talise/Features/Send/SendView.swift` (sender flow), `web/app/api/recipient/route.ts` (handle resolution).
- **Gap:** Fiat off-ramp ("cash out to MTN MoMo / M-Pesa") is not yet integrated; only on-ramp (`web/app/api/onramp/`) ships. Without it the remittance loop is one-sided in demo.

#### 2. Correct handling of assets and ownership
- **How we satisfy this:** Strict Move type discipline. `TaliseVault` (`move/talise/sources/vault.move:49`) is a shared object whose `Bag` holds `Balance<T>` keyed by phantom type tag (`type_string<T>()` at line 479). `owner: address` is asserted on every mutating entry (`withdraw`, `withdraw_and_send`, `enable_auto_swap`). Auto-swap consent uses the capability pattern — `AutoSwapCap<phantom T>` (`auto_swap.move`) is a per-user-per-source-coin shared object bounded by `max_per_swap`, `expires_at_ms`, `paused`, and `validate_for_swap` (public(package), called from `vault::auto_swap_extract`) re-asserts admin identity, expiry, and amount on every tick. The swap closer uses a `SwapTicket` hot potato (`vault.move:67`) so the cron physically cannot drop the coin without going back through `auto_swap_deposit_to_owner`.
- **Code:** `move/talise/sources/vault.move:49,67,116,260,313,412`; `move/talise/sources/auto_swap.move` (validate_for_swap); `move/talise/sources/send.move:19` (the entire send module is one type-safe function); `move/talise/sources/receipt.move` (PaymentReceipt as owned object).
- **Gap:** No `Dest` allowlist on `auto_swap_deposit_to_owner` — a compromised cron could route to a non-USDsui type. Documented in `AUTOSWAP.md` "Open questions" but not enforced on-chain.

#### 3. Working end-to-end integrations
- **How we satisfy this:** The receive path actually closes on mainnet. Inbound coin → address-owned `Coin<T>` at vault → cron picks up within 60s (`web/app/api/cron/auto-swap-sweep/route.ts`) → `receive_and_deposit<T>` (Step A) → `auto_swap_extract<Source>` + Cetus aggregator route + `auto_swap_deposit_to_owner<USDsui>` (Step B) → USDsui in user's plain wallet. Four production package versions are pinned (v1–v4 in `AUTOSWAP.md`). Real APY from Navi is pulled live (`web/lib/navi-supply.ts:166 fetchNaviUsdsuiSupplyApy`). zkLogin proofs round-trip through Shinami (recent commit `4180d5a` fixed the JSON encoding regression). Onara CF worker handles sponsorship + claim (`onara/api/src/receiveAndDeposit.ts`, `onara/api/src/autoSwap.ts:357 handleAutoSwap`). Mobile clients fall back gRPC → GraphQL → JSON-RPC.
- **Code:** `web/app/api/cron/auto-swap-sweep/route.ts:134 readVaultBalances`, `:332 readActiveCapsViaEvents`; `onara/api/src/autoSwap.ts:141 cetusSwap`, `:213 buildAutoSwapTx`; `web/lib/navi-supply.ts:64 appendNaviSupply`, `:88 appendNaviWithdraw`; `ios/Talise/Auth/ZkLoginCoordinator.swift`.
- **Gap:** Off-ramp + KYC tier enforcement at withdraw time are stubbed. The demo loop ends at "USDsui in wallet" not "Naira in M-Pesa."

#### 4. Thoughtful abstraction for users
- **How we satisfy this:** The product surface hides the entire DeFi machine. The user never sees: a vault id, a coin type, a swap quote, a slippage setting, a gas budget, a sponsor signature, a SuiNS record, or USDsui itself by default — they see "₦ 145,200" with USD as a secondary line (`web/lib/fx.ts`, `ios/Talise/Features/Home/HomeView.swift`). Auto-swap is opt-in once via `AutoSwapEnableSheet.swift` (one Google-signed PTB enables vault + caps) and there is a migration banner (`AutoSwapMigrationBanner.swift`) for v2 users to promote owned caps to shared without re-onboarding. The capability bounds (`max_per_swap`, `expires_at_ms`) are surfaced as friendly toggles in `AutoSwapSettings.swift`.
- **Code:** `ios/Talise/Features/Earn/AutoSwapSettings.swift:12`, `ios/Talise/Features/Earn/AutoSwapEnableSheet.swift`, `ios/Talise/Features/Home/AutoSwapMigrationBanner.swift`, `ios/Talise/Features/Home/TxReceiptView.swift` (receipt shows To/From + FX, not type tags).
- **Gap:** First-run still requires two signatures (vault create, then enable defaults). The v5 single-tx onboarding (`create_with_default_caps<T1,T2,T3>`) is in `AUTOSWAP.md` open questions but unbuilt.

### Top-tier axes

#### A. Novel use of programmable transactions
- **How we satisfy this:** The auto-swap close is a 3-call PTB that is impossible to short-circuit: `auto_swap_extract<Source>` returns a `(Balance<Source>, SwapTicket)` hot potato; the Cetus aggregator consumes the balance and produces `Balance<USDsui>`; `auto_swap_deposit_to_owner<USDsui>` is the only function that destroys the ticket, and it requires `ticket.vault_id == vault.id` and the recipient hardcoded to `vault.owner`. The Move type system, not off-chain code, enforces that a swap cannot be initiated without producing a delivery in the same transaction. On the send path, `send.move` plus `receipt.move` compose into an atomic "transfer + mint PaymentReceipt" PTB so the receiver gets a tamper-evident on-chain receipt object in the same tx — `(nonce, amount, receiver, coinType)` uniqueness blocks replay (see `THREAT_MODEL.md`).
- **Code:** `move/talise/sources/vault.move:67 SwapTicket`, `:313 auto_swap_extract`, `:412 auto_swap_deposit_to_owner`; `move/talise/sources/send.move:19 send`; `move/talise/sources/receipt.move:15 PaymentReceipt`.
- **Gap:** None material — this is our strongest axis. Could add per-period throttle in the cap (`swapped_today` counter) as further hardening.

#### B. Strong composability across components
- **How we satisfy this:** Three independently useful primitives compose: (1) `TaliseVault` as a per-user custody object, (2) `AutoSwapCap<T>` as a per-source-coin consent token, (3) the Cetus aggregator as the swap venue and Navi as the yield venue. Any combination works: vault without auto-swap is just a wallet; auto-swap without yield is just stablecoin normalization; layering Navi on top gives yield-bearing balances (`web/lib/navi-supply.ts`). DeepBook margin is wired as an alternative supply path (`web/lib/deepbook-margin.ts:165 buildSupplyUsdsuiMargin`) — same UI, different protocol underneath. The capability pattern means a third party could mint their own `AutoSwapCap<MyCoin>` against a Talise vault without changing our code.
- **Code:** `web/lib/navi-supply.ts`, `web/lib/deepbook-margin.ts:33 LENDING_POOLS`, `web/app/api/earn/supply/prepare/route.ts`, `web/app/api/earn/withdraw/`, `move/talise/sources/vault.move:147 enable_auto_swap` (generic over `T`).
- **Gap:** DeepBook margin path is only wired for USDsui; not yet exposed in the iOS Earn picker (`EarnView.swift` defaults to Navi). Two protocols, one UI is half-done.

#### C. Excellent UX for complex financial actions
- **How we satisfy this:** Onboarding = "sign in with Google" (`ZkLoginCoordinator.swift`); no seed phrase, no wallet install, no faucet. Send = type a handle, pick an amount in naira, tap Send — one signature, one PTB, one sponsored tx (`SendView.swift`). Receive = nothing, the cron does it (`auto-swap-sweep/route.ts`). Yield = one tap "Earn 4.2% on idle dollars" (`EarnView.swift`) with the real Navi APY pulled live. Recent commits show the polish bar: receipt now correctly labels To/From and persists FX (`c2b9b37`), the activity feed canonicalizes type tags so 0x2::sui::SUI and 0x0…002::sui::SUI dedupe (`web/lib/activity.ts:50,888`), TopGlow + animations on TxReceiptView. Local currency primary, USD secondary, USDsui invisible.
- **Code:** `ios/Talise/Features/Send/SendView.swift`, `ios/Talise/Features/Home/HomeView.swift:6`, `ios/Talise/Features/Home/TxReceiptView.swift`, `ios/Talise/Features/Earn/EarnView.swift`, `ios/Talise/Auth/ZkLoginCoordinator.swift`, `web/lib/activity.ts`.
- **Gap:** No push notification when the auto-swap closes — the user has to open the app to see USDsui arrive. `web/app/api/cron/auto-swap-sweep/route.ts` emits the on-chain event but doesn't fan it out to APNs.

#### D. Real-world applicability
- **How we satisfy this:** The remittance corridor is a $48B/year flow (World Bank 2024). Western Union charges 6–12%; we charge ~0 (gas sponsored, swap slippage is the only real cost). Local currency display, KYC tiers (`web/app/api/onboarding/`), contacts, savings goals, round-ups, and rewards are all wired because real users need them — not because the brief asks. The iOS app is the actual product surface, not a web demo. SuiNS subnames under `talise.sui` mean `sele@talise` is a portable, on-chain identity the user keeps even if they migrate off Talise.
- **Code:** `STRATEGY.md` (market sizing), `research/market_research.md`, `web/app/api/onramp/`, `web/app/api/contacts/`, `web/app/api/rewards/`, `ios/Talise/Features/Earn/` (savings goals).
- **Gap:** No live user metrics or testnet pilot numbers to point to in a demo. "Real-world" is asserted, not yet measured.

## Sprint to demo (top 3 gaps + fixes)

These are the changes that move us from "strong" to "top-tier" against the rubric. Each is scoped to fit before the 2026-05-23 submission deadline (≈2 days of work each).

### Gap 1 — Off-ramp loop closure (impacts: real-world applicability, end-to-end integration)
The demo currently ends with "USDsui in wallet." Judges from OpenZeppelin / OtterSec will ask "and then what?" Without a fiat exit the remittance pitch is incomplete.

- **Fix:** Wire one off-ramp partner end-to-end — Yellow Card or Onramper reverse-flow are the lowest-lift options because their KYC piggybacks our on-ramp partner. Add `web/app/api/offramp/quote/route.ts` and `web/app/api/offramp/initiate/route.ts`, plus a `WithdrawToBank` sheet in iOS that consumes the USDsui balance and shows "₦ 145,000 to GTBank ****4321 in ~10 min."
- **Effort:** ~1.5 days. The Move side is just `vault::withdraw_and_send` (already shipped at `vault.move:290`); all work is web + iOS + a partner sandbox.
- **Demo win:** "Sender taps Send in London. 12 seconds later, recipient's bank account in Lagos has naira." End-to-end, on camera.

### Gap 2 — Single-signature onboarding (impacts: UX, abstraction)
Today new users sign twice: once to create the vault, once to enable default auto-swap caps (SUI, USDC, USDT). That's the highest-friction moment in the funnel and the most visible "DeFi-ness" leak in the UX.

- **Fix:** Ship the v5 entry function from `AUTOSWAP.md` open questions: `create_with_default_caps<T1, T2, T3>(ctx)` returns `(VaultCreated, AutoSwapCap<T1>, AutoSwapCap<T2>, AutoSwapCap<T3>)` and shares them all atomically. iOS calls one PTB; user signs once total.
- **Effort:** ~1 day (Move + tests + iOS wiring). Move package upgrade-compatible (additive only).
- **Demo win:** "Sign in with Google → you have a Sui address, a handle, and auto-convert is already on. Total user actions: 1."

### Gap 3 — Push notification on auto-swap close (impacts: UX, demoability)
Right now the auto-swap is the magic moment, but the user doesn't see it happen unless they're already in the app. For a demo, this is fatal — the judge watches the sender press Send and then waits in silence.

- **Fix:** Add an APNs fan-out in `web/app/api/cron/auto-swap-sweep/route.ts` after the `VaultAutoSwap` event is confirmed. Payload: "$50 from London just landed → ₦82,400 in your wallet." Device tokens are already collected for KYC notifications; just plumb the topic.
- **Effort:** ~0.5 day. APNs cert is already provisioned. Just add the notification call site and a body template keyed off `auto_swap.move`'s `VaultAutoSwap` event fields.
- **Demo win:** Sender taps Send on one phone; recipient's phone buzzes 8 seconds later with the converted naira amount. That single beat sells the entire product.

## Architecture diagram

Adapted from `move/talise/AUTOSWAP.md` with the send/receipt and yield paths added.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                                  On-chain (Sui)                               │
│                                                                                │
│   ┌────────────────────────┐         ┌────────────────────────┐               │
│   │  AutoSwapRegistry      │         │  TaliseVault           │               │
│   │  shared, singleton     │         │  shared, per-user      │               │
│   │  admin = Onara worker  │         │  owner = user address  │               │
│   └────────────┬───────────┘         │  balances: Bag<T>      │               │
│                │ validate_for_swap   │  (transient)           │               │
│   ┌────────────▼───────────┐         └─────────┬──────────────┘               │
│   │  AutoSwapCap<T>        │◄──────────────────┘                              │
│   │  shared, per-coin      │                                                   │
│   │  bounds:               │     ┌──────────────────┐    ┌──────────────────┐ │
│   │   max_per_swap         │     │  SwapTicket      │    │  PaymentReceipt  │ │
│   │   expires_at_ms        │     │  (hot potato)    │    │  (owned object,  │ │
│   │   paused               │     │  vault_id bound  │    │   minted in send │ │
│   └────────────────────────┘     └──────────────────┘    │   PTB, nonce     │ │
│                                                          │   unique)         │ │
│   v4 closer: auto_swap_deposit_to_owner<USDsui>          └──────────────────┘ │
│   transfers Coin<USDsui> straight to vault.owner                              │
│   AND flushes any stale bag balance of the same Dest                          │
│                                                                                │
│   Yield: Navi supply (web/lib/navi-supply.ts)                                 │
│   Alt:   DeepBook margin supply (web/lib/deepbook-margin.ts)                  │
└────────────────────────────────────────────────────────────────────────────────┘
                ▲                              ▲                  ▲
                │ enable/pause/withdraw         │ claim + swap     │ send PTB
                │ (user signs, sponsored)       │ (worker signs)   │ (user signs,
                │                               │                  │  sponsored)
┌───────────────┼───────────────────────────────┼──────────────────┼─────────────┐
│               │            Off-chain          │                  │              │
│               │                               │                  │              │
│   ┌─────────────────┐    ┌───────────────────────┐    ┌──────────────────┐    │
│   │  iOS (SwiftUI)  │    │  Onara CF Worker      │    │  SuiNS resolver  │    │
│   │  zkLogin/Google │    │  + Vercel cron 1/min  │    │  *.talise.sui    │    │
│   │  HomeView       │    │  receiveAndDeposit.ts │    │                  │    │
│   │  SendView       │    │  autoSwap.ts          │    │  alice.talise.sui│    │
│   │  AutoSwapSettings│   │  policy.ts (sponsor)  │    │  → vault.id      │    │
│   │  TxReceiptView  │    │                       │    │                  │    │
│   └─────────────────┘    └───────────────────────┘    └──────────────────┘    │
│           │                        │                                            │
│           │     Cetus aggregator (20+ DEXs) ◄──────────────────────────┐       │
│           │     for Source → USDsui routing                            │       │
│           │                                                            │       │
│           └────── Shinami: zkLogin proofs + JSON-RPC ──────────────────┘       │
│                                                                                 │
│   Web (Next.js 15):                                                             │
│   - app/api/cron/auto-swap-sweep — periodic sweep entry                         │
│   - app/api/balances — unified balance read (vault bag + owner-owned + Navi)    │
│   - app/api/activity — canonical type-tag dedup, recent feed                    │
│   - app/api/earn/{supply,withdraw} — yield routes (Navi default, DeepBook alt)  │
│   - app/api/zk/sponsor-execute — gated sponsor signing endpoint                 │
└────────────────────────────────────────────────────────────────────────────────┘
```

## Notes for the writeup

- The Notion link `mystenlabs.notion.site/defi-payments-problem-statement` did not return content when WebFetched (the public Notion CDN gates the page body for unauthenticated viewers). Talise's `BRIEF.md` contains a verbatim capture from 2026-05-17 which is what this document is mapped against. If the official rubric introduces additional axes after that capture, this document will be stale on those axes only.
- Submission deadline 2026-05-23. Today is 2026-05-26 — **this document is being written after the stated submission deadline**. If that deadline is firm and not extended, the "Sprint to demo" section is moot and should be reframed as "what we'd ship for the demo day on 2026-06-13 if shortlisted." Flagging here rather than silently re-scoping.
