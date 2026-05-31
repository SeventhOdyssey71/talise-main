<!-- Engineering build-phases plan. Translates docs/strategy/cross-border-masterplan.md into concrete, codebase-grounded workstreams, branches, dependencies, acceptance criteria, and merge order. Companion to the master plan — read that first for the *why*; this is the *how* and the *in-what-order*. Grounded in the Talise codebase as of commit 1757484. -->

# Talise Build-Phases Plan — Cross-Border Foundations

*Engineering translation of [`cross-border-masterplan.md`](./cross-border-masterplan.md). The master plan answers "what business, why, and what kills it." This document answers "what code, in what files, on what branches, in what order, gated by what acceptance criteria." Everything here is **additive** and **non-breaking** — the live NGN corridor (Stripe on-ramp, Paga off-ramp), gasless send path, zkLogin, and SuiNS `@handle` identity keep working through every phase.*

---

## 0. How to read this

The master plan's §12 verdict reduces the whole company to one execution test: *ship a real compliance program and secure a named licensed partner before spending a dollar on consumer acquisition.* This document sequences the **engineering** half of that — the compliance program, the FX engine, the corridor-agnostic money-movement spine — so the product side (licensing, float, partners) has working software to point regulators and partners at.

Three rules govern every phase:

1. **Additive only.** New tables, new columns with safe defaults, new routes, new Swift views. We never rename or drop a column the live NGN path reads. The Paga state machine is *generalized*, not replaced — the existing `paga_offramps` rows and `/api/offramp/paga/*` routes keep resolving.
2. **Compliance is P0, before any new corridor.** Per master plan §7 and the four `[KILLS]` findings: no KYC tier engine, no API-layer limits, no sanctions/address screening, no Travel Rule exist on `main` today. Phase 0 builds them. No Phase 1 corridor ships until Phase 0's screening hard-stop is live in the prepare→broadcast path.
3. **The chain stays invisible; the ledger denominates fiat.** We keep the master plan §3 custody model: one USDsui position per zkLogin address, a Postgres ledger that *renders* a display currency. We do not add per-currency on-chain coins.

### The 13 feature branches in flight

The master plan is being built across parallel feature branches. This document is the merge map for them. (The directive names 15 workstreams; 13 distinct `feat/*` branches are enumerated below — `feat/ios-earn-reframe` and this `docs/build-phases` branch round out the set.)

| Branch | Owns | Phase | Master-plan anchor |
|---|---|---|---|
| `feat/kyc-tier-engine` | `users.kyc_tier`, `/api/kyc/*`, tier model, eKYC vendor (Sumsub/Persona) webhook | 0 | §7 KYC/KYB; §11.1 |
| `feat/send-limits` | API-layer per-tier daily/velocity limits enforced in `/api/send/prepare` + `/sponsor-prepare` | 0 | §7; §11.2; `[KILLS]` compliance |
| `feat/sanctions-screening` | Name + on-chain address screening, pre-broadcast hard-stop (Chainalysis KYT / TRM) | 0 | §7 sanctions; §11.3; `[HIGH]` |
| `feat/fx-live-feed` | Replace hardcoded `FX` snapshot with live executable feed; add JPY/SGD/PHP/IDR/VND to `Currency`; per-corridor spread + max-age breaker | 0 | §6 FX risk; §11.4; `[MEDIUM]` |
| `feat/corridor-registry` | Corridor registry: which `(src,dst)` pairs are live, their rails, limits, spread policy, required tier | 0 | §4 per-corridor rails; §10 |
| `feat/transfers-state-machine` | Generalize Paga state machine into corridor-agnostic `transfers` table + machine | 0 | §3 transfers machine; §11.5 |
| `feat/treasury-float-ledger` | Per-corridor float-pool ledger, reconciliation rows, segregation flags | 0 | §6 float model; §9 `[KILLS]` float |
| `feat/travel-rule` | IVMS-101 originator/beneficiary exchange for Talise→external-VASP / unhosted | 2 | §7 Travel Rule; §10 18–36mo |
| `feat/offramp-adapters` | Provider-agnostic off-ramp adapter interface; PayNow/FAST (SG) + Zengin (JP) adapters | 1 | §4 rails; §10 6–18mo |
| `feat/onramp-bank-funding` | Bank/ACH/FedNow/RTP funding as the DEFAULT in-ramp; card surcharged | 1 | §6 economics; §11.6; `[KILLS]` card |
| `feat/ios-multicurrency` | iOS multi-currency "pockets", `CurrencySettings.allSupported` += new ccys, hold-as-foreign | 1 | §8 receiving/multi-currency |
| `feat/ios-crossborder-send` | iOS cross-currency send: locked-quote review block, "sent vs landed" states | 1 | §8 cross-border send flow |
| `feat/ios-earn-reframe` | Reframe Earn in fiat ("Earn 4% on your dollars"), separate opt-in lending disclosure | 1 | §8 Earn; §9 `[HIGH]` GENIUS |

`docs/build-phases` (this branch) is documentation only and merges first so the others share one merge map.

---

## 1. Codebase ground truth (what exists today)

So every branch builds on the real thing, not a guess:

- **DB**: `web/lib/db.ts` — Postgres (migrated off libSQL but preserves the libSQL-style `db().execute({sql,args})` / `db().batch()` API). Schema + `ensureSchema()` live here; the `c=db()` client is exported. Existing tables: `users`, `tx_history`, `invoices`, `rewards_events`, `savings_goals`, `redemptions`, `roundup_queue`, `waitlist_signups` (+ dead `waitlist`), `paga_offramps`, `mobile_sessions`.
- **FX**: `web/lib/fx.ts` — `type Currency = "NGN"|"KES"|"GHS"|"ZAR"|"USD"`, hardcoded `FX` record (units per USD), `SYMBOL`, pure `usdcToLocal()` helpers. No I/O. iOS `ios/Talise/App/CurrencySettings.swift` carries its own live-ish display rates and `allSupported`.
- **Send path**: `web/app/api/send/prepare/route.ts` (server-side PTB kind bytes for iOS) and `web/app/api/send/sponsor-prepare/route.ts` (gasless PTB) → `web/app/api/zk/sponsor` / `zk/sponsor-execute` / `zk/assemble-signature` → iOS broadcasts → `web/app/api/send/gasless-submit` + `gasless-confirm`. Auth via `readEntryIdFromRequest` (`web/lib/mobile-sessions.ts`) / `readSessionEntryId` (`web/lib/session.ts`). **No tier check, no API-layer daily limit, no sanctions gate anywhere in this path today.**
- **Off-ramp (the template)**: `web/app/api/offramp/paga/{quote,confirm,status/[id]}/route.ts` + `web/lib/paga.ts`. State machine on `paga_offramps.status`: `quoted → debited → remitting → settled` (terminal `failed`). Quote is TTL-locked; `~25bps` spread. This is the pattern the master plan §3 generalizes.
- **On-ramp**: `web/app/api/onramp/{session,hosted-session,webhook}/route.ts` (Stripe Crypto Onramp, card → USDC on Sui).
- **Infra**: `web/lib/rate-limit.ts` (`rateLimitAsync`, Redis-backed when Upstash env present, `getClientIp`), `web/lib/session.ts`, `web/lib/sui.ts` (`COIN_TYPES`, `USDSUI_DECIMALS`), `web/lib/usdsui.ts`, `web/lib/shinami.ts`, `web/lib/onara/*` (sponsor), `web/lib/suins*.ts`.
- **iOS**: `ios/Talise/Features/Send/{SendFlowView,SendAmountView,SendReviewView,...}.swift`, `Features/Home/HomeView.swift` (optimistic stubs), `Features/Earn/EarnView.swift`, `Features/Receive/ReceiveView.swift`, `App/CurrencySettings.swift`.

---

## 2. Phase 0 — Harden + Compliance Foundation (0–6 months)

**Goal:** make the live NGN corridor compliant, move FX off the hardcoded snapshot, and build the corridor-agnostic money-movement spine — so a new corridor in Phase 1 is *configuration + an adapter*, not a re-architecture. Per master plan §10 (Now/0–6mo) and §11 (next 90 days): no new market opens until this lands. **The proving ground is the existing NGN corridor** — every Phase 0 capability is validated against real Paga flow before any new-corridor spend.

### 2.1 Workstreams

#### A. KYC tier engine — `feat/kyc-tier-engine`
- **Schema (additive):** `ALTER TABLE users ADD COLUMN kyc_tier SMALLINT NOT NULL DEFAULT 0` (Tier 0 = email-only, the current Google-OAuth state, so every existing row is valid without backfill). New table `kyc_verifications` (vendor ref, tier requested, status, document set, jurisdiction, timestamps). Register both in `ensureSchema()` and the `web/lib/db.ts` table-map comment.
- **Routes:** `web/app/api/kyc/start/route.ts` (kick off Sumsub/Persona session), `web/app/api/kyc/webhook/route.ts` (vendor callback → promote tier), `web/app/api/kyc/status/route.ts`.
- **Lib:** `web/lib/kyc/tiers.ts` — tier definitions matching master plan §7 (T0 receive-only; T1 basic ID+liveness, ~$1k/mo; T2 full ID+address+sanctions clear; T3 SoF/EDD). `web/lib/kyc/vendor.ts` — Sumsub/Persona adapter behind one interface (JP/SG document sets included from day one per §11.1).
- **Tier is the join point** for `feat/send-limits` (reads `kyc_tier`) and `feat/travel-rule` (collects full KYC + source-of-funds at onboarding so the data exists before any external transfer — §7).

#### B. Send limits — `feat/send-limits`
- **Lib:** `web/lib/limits.ts` — per-tier daily-amount + velocity policy, currency-normalized via `feat/fx-live-feed`. Reuses `web/lib/rate-limit.ts` (`rateLimitAsync`) for the velocity counter and adds a USD-notional daily aggregate keyed on `userId`.
- **Enforcement (the documented gap):** a hard, tier-aware rejection injected into `web/app/api/send/prepare/route.ts` and `web/app/api/send/sponsor-prepare/route.ts` — *before* PTB construction. Returns `403 { error, tier, limit, remaining }`. Closes master plan §11.2.
- **Order constraint:** depends on `feat/kyc-tier-engine` (reads `users.kyc_tier`) and `feat/fx-live-feed` (normalizes limits to USD notional). Lands after both.

#### C. Sanctions / address screening — `feat/sanctions-screening`
- **Lib:** `web/lib/screening/names.ts` (sender+beneficiary vs OFAC/UN/EU/MAS, fuzzy + review-queue hook), `web/lib/screening/address.ts` (on-chain counterparty risk score via Chainalysis KYT, TRM as second source).
- **The hard-stop:** wired into the prepare→broadcast path as a synchronous gate that refuses to sponsor/broadcast a flagged send *before* the Shinami fan-out (`web/lib/shinami.ts` / `zk/sponsor-execute`). Per master plan §7 layer-2 and §11.3 — a failed screen is a hard-stop, not a warning.
- **Schema (additive):** `screening_events` (subject, list-hit, score, decision, reviewer). New review-queue surfaced via `web/app/api/kyc/*` admin (out of scope for launch; queue rows only).
- **Order constraint:** independent of A/B for code, but the gate is wired into the *same* prepare/sponsor-prepare routes `feat/send-limits` touches — coordinate the two edits (see §2.4 merge order).

#### D. FX live feed — `feat/fx-live-feed`
- **`web/lib/fx.ts` (additive, non-breaking):** extend `type Currency` to `"NGN"|"KES"|"GHS"|"ZAR"|"USD"|"JPY"|"SGD"|"PHP"|"IDR"|"VND"` and add their `FX`/`SYMBOL` entries. The pure `usdcToLocal()` signature is preserved.
- **New executable feed:** `web/lib/fx-feed.ts` + `web/app/api/fx/route.ts` (already exists for display) extended to a *server-authoritative quote* source backed by the real conversion venue (Circle Mint USD leg; partner-quoted JP/SG rate; OTC desk for size — §6). Hardcoded `FX` becomes the *fallback* only, behind a max-age circuit breaker.
- **Per-corridor spread** set by realized volatility, consumed by `feat/corridor-registry`. Never warehouse naked directional FX (§6, §9 `[HIGH]` depeg).
- **Order constraint:** foundational — `feat/send-limits`, `feat/corridor-registry`, `feat/transfers-state-machine`, and both iOS branches consume the extended `Currency` type and the quote source. Lands early.

#### E. Corridor registry — `feat/corridor-registry`
- **Lib:** `web/lib/corridors.ts` — a typed registry of `(src,dst)` corridors: which are live, their fiat-in/fiat-out rails (Stripe/Paga today; PayNow/Zengin in Phase 1), required `kyc_tier`, spread policy (from `feat/fx-live-feed`), per-corridor limits, and the `~$4M/yr break-even` gate flag from §6. NGN is the first registry entry, describing the *existing* live corridor — proving the registry models reality before any new corridor is added.
- **Why a registry:** every other branch reads it instead of hardcoding corridor knowledge. `feat/transfers-state-machine` reads rails; `feat/send-limits` reads per-corridor limits; iOS reads the live-corridor list.
- **Order constraint:** depends on `feat/fx-live-feed` (spread policy). Independent of A/B/F otherwise.

#### F. Transfers state machine — `feat/transfers-state-machine`
- **Schema (additive, generalizes `paga_offramps`):** new `transfers` table with the master plan §3 states: `quoted → debited → onchain_settling → onchain_settled → fiat_out_pending → settled` (terminal `failed`/`refunded`). Columns: corridor id (FK-ish to registry), src/dst currency, locked-quote ref, on-chain digest, provider, provider ref. **`paga_offramps` is NOT dropped** — Phase 0 writes a parallel `transfers` row for each Paga flow (dual-write), proving parity before any cutover.
- **Lib:** `web/lib/transfers/machine.ts` — the state transitions + **compensating-failure semantics**: the on-chain leg is the commit point; a fiat-out failure parks funds in the recipient's vault (never lost), per §11.5.
- **Order constraint:** depends on `feat/corridor-registry` (corridor id, rails) and `feat/fx-live-feed` (locked quote). The Paga routes (`/api/offramp/paga/*`) are extended to dual-write, not rewritten.

#### G. Treasury float ledger — `feat/treasury-float-ledger`
- **Schema (additive):** `float_pools` (corridor, currency, balance, segregated flag) + `float_movements` (append-only reconciliation ledger: draw-down on authorization, replenish on rebalance). Per master plan §6 float model and the `[KILLS]` float finding.
- **Lib:** `web/lib/treasury/ledger.ts` — debit/credit float on the `transfers` state transitions (instant credit drawn from destination float; reconciled async). Enforces the §3 correction: **segregated client-money balances cannot be lent into NAVI** (a hard flag the NAVI supply path in `web/lib/navi-supply.ts` must check).
- **Order constraint:** depends on `feat/transfers-state-machine` (hooks the state transitions).

### 2.2 Phase 0 dependency graph

```
feat/fx-live-feed ──┬──► feat/send-limits ◄── feat/kyc-tier-engine
                    │
                    ├──► feat/corridor-registry ──► feat/transfers-state-machine ──► feat/treasury-float-ledger
                    │
                    └──► (consumed later by iOS branches)

feat/sanctions-screening ──► (wires into the same prepare/sponsor-prepare routes as feat/send-limits)
```

- `feat/fx-live-feed` and `feat/kyc-tier-engine` are the two roots — they unblock the most.
- `feat/send-limits` needs **both** roots (tier + USD-notional FX).
- `feat/corridor-registry → feat/transfers-state-machine → feat/treasury-float-ledger` is a strict chain.
- `feat/sanctions-screening` is code-independent but **route-coupled** with `feat/send-limits` (both edit `prepare`/`sponsor-prepare`).

### 2.3 Phase 0 acceptance criteria

Phase 0 is "done" (gate to open Phase 1) when **all** hold against the **live NGN corridor**:

1. **KYC**: a Tier-0 user can receive but a `403` blocks cash-out; a user can step up T0→T1→T2 via the vendor flow; `users.kyc_tier` promotes on webhook; every existing prod user is valid at T0 with zero backfill.
2. **Limits**: `/api/send/prepare` and `/api/send/sponsor-prepare` reject over-limit sends with a tier-aware `403` *before* PTB build; limits are USD-notional and currency-correct via the live feed.
3. **Screening**: a known-bad address (test fixture) is hard-stopped *before* Shinami broadcast; a clean send is unaffected; every screen writes a `screening_events` row.
4. **FX**: `Currency` includes JPY/SGD/PHP/IDR/VND; quotes are server-authoritative from the live feed; the max-age breaker falls back to the snapshot and surfaces a degraded-mode flag; display rendering for the live NGN/USD path is byte-identical to today.
5. **Corridor registry**: NGN is modeled as a live registry entry with its real Paga rails/limits/spread; reads replace any hardcoded NGN corridor knowledge.
6. **Transfers machine**: every Paga off-ramp writes a parallel `transfers` row that reaches `settled`/`failed` in lockstep with the legacy `paga_offramps` row (dual-write parity proven); a forced fiat-out failure parks funds in the vault, never loses them.
7. **Treasury**: float draw-down/replenish rows are written on the NGN transfer transitions; the segregation flag blocks a NAVI supply attempt on a safeguarded balance.
8. **Non-breaking**: the live Stripe on-ramp, Paga off-ramp, gasless send, zkLogin, and SuiNS `@handle` flows are unchanged for an existing Tier-equivalent user; `web` builds and the iOS app compiles.

### 2.4 Phase 0 merge order

1. `docs/build-phases` (this branch) — the shared map.
2. `feat/fx-live-feed` — root; extends `Currency`, adds the feed. Everything downstream rebases on it.
3. `feat/kyc-tier-engine` — root; adds `users.kyc_tier`. Independent of FX.
4. `feat/corridor-registry` — needs FX (spread). 
5. `feat/sanctions-screening` — wires the screening gate into `prepare`/`sponsor-prepare` **first** (cleaner diff than landing limits first).
6. `feat/send-limits` — needs tier + FX; rebases on the screening route edits to avoid a prepare-route conflict.
7. `feat/transfers-state-machine` — needs corridor registry + FX.
8. `feat/treasury-float-ledger` — needs the transfers machine.

> Conflict hot-spot: `web/app/api/send/prepare/route.ts` and `sponsor-prepare/route.ts` are touched by both `feat/sanctions-screening` and `feat/send-limits`. Land screening first; limits rebases. Both insert their check as an early guard *before* `coinWithBalance`/PTB construction.

---

## 3. Phase 1 — Singapore Anchor + First New Corridor (6–18 months)

**Goal:** with the Phase 0 spine live, open the first new corridor as a *config + adapter* exercise, and ship the iOS cross-border experience. Per master plan §10 (6–18mo): MAS MPI (or live via PSP partner), US→JP as a true agent (bank-funded default, card surcharged, consumer/SMB under the ¥1M JPYC cap), `@handle` + multi-currency pockets with pay-out interoperability into local rails. Singapore is the licensing **anchor** (§5) and the hub other corridors route through.

### 3.1 Workstreams

#### H. Off-ramp adapters — `feat/offramp-adapters`
- **Lib:** `web/lib/offramp/adapter.ts` — formalize the provider-agnostic interface the master plan §3 says Paga already implies (`provider`, `quote()`, `confirm()`, `status()`). `web/lib/offramp/paga.ts` (refactor of existing `web/lib/paga.ts` to the interface — behavior-preserving). New: `web/lib/offramp/paynow.ts` (SG PayNow/FAST), `web/lib/offramp/zengin.ts` (JP Zengin furikomi).
- **Routes:** generalize `web/app/api/offramp/paga/*` into `web/app/api/offramp/[provider]/{quote,confirm,status/[id]}/route.ts`, dispatching on `corridor.fiatOut` from the registry. Keep the legacy `/api/offramp/paga/*` paths as thin shims so live clients don't break.
- **Order constraint:** depends on Phase 0's `feat/transfers-state-machine` (writes corridor-agnostic `transfers` rows) and `feat/corridor-registry` (rail lookup).

#### I. Bank-funded on-ramp — `feat/onramp-bank-funding`
- **The economics fix (§6, §11.6, `[KILLS]` card):** make bank/ACH/FedNow/RTP the **default** funding method; card (existing Stripe) becomes a surcharged convenience tier that passes the 2.9% through explicitly.
- **Routes/lib:** extend `web/app/api/onramp/*` with a bank-rail session (Circle Mint USD wire → USDC on Sui at par per §4; FedNow/RTP via the US partner). `web/lib/onramp/funding.ts` — funding-method selection + surcharge math feeding the §6 unit-economics gate.
- **Risk gate (§9 `[HIGH]` instant credit):** never instant-credit card-funded first transfers from unestablished users; gate instant credit to bank-funded (push, irreversible) rails and Tier-2+ users with history. This reads `feat/kyc-tier-engine` + `feat/treasury-float-ledger`.
- **Order constraint:** depends on Phase 0 (tier engine, float ledger).

#### J. iOS multi-currency — `feat/ios-multicurrency`
- `ios/Talise/App/CurrencySettings.swift` — extend `allSupported` with JPY/SGD/PHP/IDR/VND (mirroring `feat/fx-live-feed`'s `Currency`). Add "Add a currency" + light multi-currency **pockets** (hold-as-foreign as a deliberate choice — §8), with the same locked-quote block for in-app FX.
- **Order constraint:** consumes Phase 0 FX feed (rates) + corridor registry (which currencies are live). Independent of `feat/ios-crossborder-send` at the data layer but they share `CurrencySettings`.

#### K. iOS cross-border send — `feat/ios-crossborder-send`
- Reuse the three-step `SendFlowView` spine (§8). `SendAmountView` secondary line shows recipient-side amount when currencies differ ("¥15,000 → recipient gets $96.40"). `SendReviewView` replaces the generic fee line with the transparent locked-quote block (rate, spread-as-explicit-fee, total debit, guaranteed receive, "rate held 30s" countdown); `SlideToConfirm` remains the commit gesture.
- **"Sent vs landed" states:** reuse `HomeView` optimistic-stub machinery (`pendingOptimisticStubs`, `.taliseTxCompleted`, 90s TTL). Distinguish chain-final "Sent" from rail-confirmed "Delivered"; `SendSuccessView` fires on **chain finality** with honest copy. Never claim "delivered" before the payout webhook.
- **Order constraint:** consumes the quote source (`feat/fx-live-feed`), the `transfers` states (`feat/transfers-state-machine`), and shares `CurrencySettings` with `feat/ios-multicurrency`.

#### L. iOS Earn reframe — `feat/ios-earn-reframe`
- `ios/Talise/Features/Earn/EarnView.swift` — reframe in fiat ("Earn 4% on your dollars," never "supply USDsui to NAVI"), as a **legally separate, explicitly opt-in lending/advisory service** with its own disclosures (§8, §9 `[HIGH]` GENIUS). Never auto-supplied; corridor economics must not be underwritten on yield.
- **Order constraint:** depends on the `feat/treasury-float-ledger` segregation flag (safeguarded balances can't be supplied). Otherwise independent — can land any time in Phase 1.

### 3.2 Phase 1 dependency graph

```
Phase 0 (all) ──► feat/offramp-adapters ──► (PayNow/Zengin live)
              ──► feat/onramp-bank-funding (bank default + instant-credit risk gate)
              ──► feat/ios-multicurrency ─┐
              ──► feat/ios-crossborder-send ┤ share CurrencySettings; consume FX feed + transfers states
              ──► feat/ios-earn-reframe (needs treasury segregation flag)
```

### 3.3 Phase 1 acceptance criteria

1. **First new corridor (US→JP under ¥1M) end-to-end on testnet/sandbox:** quote → debited → onchain_settling → onchain_settled → fiat_out_pending → settled, with the recipient credited from destination float and reconciled async (§3 ASCII flow).
2. **Off-ramp adapters:** PayNow and Zengin adapters pass the same interface contract tests Paga passes; legacy `/api/offramp/paga/*` shims still resolve for live clients.
3. **Bank-funded default:** the on-ramp defaults to bank/ACH; card is selectable but surcharged with the 2.9% shown explicitly; a card-funded first transfer from an unestablished user is *not* instant-credited.
4. **iOS:** a user can add a foreign-currency pocket; a cross-currency send shows the locked-quote block + countdown and resolves "Sent" (chain) → "Delivered" (payout webhook); Earn reads as fiat with the separate-service disclosure.
5. **Non-breaking:** NGN corridor and all Phase 0 acceptance criteria still pass.
6. **Break-even gate:** the corridor opens only when projected 90-day volume clears the ~$4M/yr all-in line (§6) — a policy flag in `feat/corridor-registry`, not just code.

### 3.4 Phase 1 merge order

1. `feat/offramp-adapters` (refactor Paga to interface first — behavior-preserving — then add PayNow/Zengin).
2. `feat/onramp-bank-funding`.
3. `feat/ios-multicurrency` (lands `CurrencySettings` changes first).
4. `feat/ios-crossborder-send` (rebases on the `CurrencySettings` changes).
5. `feat/ios-earn-reframe` (independent; any time after `feat/treasury-float-ledger`).

---

## 4. Phase 2 — Scale (18–36 months)

**Goal:** the master plan §10 (18–36mo): second corridor, self-licensing, B2B scale. Engineering-side this is mostly *more registry entries + more adapters + the Travel Rule wiring that external-VASP volume now requires.*

### 4.1 Workstreams

#### M. Travel Rule — `feat/travel-rule`
- **Lib:** `web/lib/travel-rule/ivms.ts` (IVMS-101 message build), `web/lib/travel-rule/network.ts` (Notabene / TRP / TRUST adapter), VASP-discovery + sunrise fallback.
- **Wiring (§7 split):** **Talise↔Talise** transfers stay in the internal `transfers` ledger — no external message. **Talise→external VASP** triggers VASP discovery + IVMS-101 exchange. **Talise→unhosted** triggers beneficiary self-declaration. The threshold (~$1k) is read from the corridor registry.
- **Dependency:** needs `feat/kyc-tier-engine` (originator/beneficiary KYC + source-of-funds collected at onboarding so the data exists), `feat/transfers-state-machine` (classifies the transfer type), and `feat/sanctions-screening` (shared screening verdict). This is why it's Phase 2: it depends on the entire Phase 0 spine being live and on external-VASP volume existing.

#### Scale-out workstreams (no new dedicated `feat/*` branch — they reuse the spine)
- **SG→ASEAN payout (PH/ID/VN):** new corridor-registry entries + new off-ramp adapters behind the Phase 1 `feat/offramp-adapters` interface (StraitsX/Nium payout network). Currencies already added in Phase 0's `feat/fx-live-feed`.
- **B2B / treasury / payroll:** the §6 positive-margin P&L. New B2B handles via KYB (extends `feat/kyc-tier-engine` Tier-3/KYB), larger limits per the registry, batched payouts on the treasury ledger.
- **US own-MTL coverage, Japan Type 1 + EPIBP, Korea re-evaluation:** licensing/ops milestones (master plan §5) that unlock larger limits and remove the partner rev-share haircut — gated by the *registry* (raising per-corridor limits/required-tier as licenses land), not by new core code.

### 4.2 Phase 2 dependencies & order

```
Phase 0 spine + Phase 1 adapters ──► feat/travel-rule ──► external-VASP corridors unlocked
                                 ──► SG→ASEAN (registry entries + adapters)
                                 ──► B2B/KYB (extends kyc-tier-engine; registry limits)
```

Order: `feat/travel-rule` first (it gates legal external-VASP volume), then SG→ASEAN corridors and B2B incrementally — each is additive registry + adapter work, never a re-architecture.

### 4.3 Phase 2 acceptance criteria

1. A Talise→external-VASP transfer above threshold transmits a valid IVMS-101 message via the network adapter and blocks on a failed counterparty exchange (sunrise fallback honored); Talise↔Talise transfers send no external message.
2. SG→ASEAN corridors (PH/ID/VN) run the full `transfers` machine through the new payout adapters with no core-spine changes.
3. KYB onboarding promotes a business handle to a B2B tier with registry-defined larger limits; batched payouts reconcile on the treasury ledger.
4. All Phase 0 + Phase 1 acceptance criteria still pass; no regression to the live consumer corridors.

---

## 5. The full merge map (one picture)

```
                         ┌─────────────────────── PHASE 0 (P0 blocker) ───────────────────────┐
docs/build-phases ─►     fx-live-feed ─┬─► send-limits ◄─ kyc-tier-engine                      │
                                       ├─► corridor-registry ─► transfers-state-machine ─► treasury-float-ledger
                                       └─► (iOS later)                                          │
                         sanctions-screening ─► [prepare/sponsor-prepare gate]                  │
                         └────────────────────────────────────────────────────────────────────┘
                                                   │  (Phase 0 acceptance gate)
                                                   ▼
                         ┌─────────────────────── PHASE 1 (anchor + 1st corridor) ─────────────┐
                         offramp-adapters ─► onramp-bank-funding                                │
                         ios-multicurrency ─► ios-crossborder-send ;  ios-earn-reframe          │
                         └────────────────────────────────────────────────────────────────────┘
                                                   │  (Phase 1 acceptance gate + break-even gate)
                                                   ▼
                         ┌─────────────────────── PHASE 2 (scale) ─────────────────────────────┐
                         travel-rule ─► SG→ASEAN corridors ; B2B/KYB                            │
                         └────────────────────────────────────────────────────────────────────┘
```

**Invariants enforced across every merge:**
- `users.kyc_tier` defaults to 0 → existing rows valid, no backfill, NGN keeps working.
- `paga_offramps` is never dropped; `transfers` dual-writes until parity is proven, then becomes canonical.
- `web/lib/fx.ts`'s `Currency` only *grows*; `usdcToLocal()` stays pure and signature-stable.
- The screening hard-stop and the limit guard sit *before* PTB construction in `prepare`/`sponsor-prepare` — never after broadcast.
- Legacy `/api/offramp/paga/*` routes survive as shims when generalized.
- Safeguarded/segregated balances are flagged and excluded from `web/lib/navi-supply.ts`.

---

## 6. Mapping to the master plan's "next 90 days" (§11)

| Master plan §11 item | Branch(es) | Phase |
|---|---|---|
| 1. KYC tier engine + `/api/kyc` + eKYC | `feat/kyc-tier-engine` | 0 |
| 2. Hard daily-limit + tier-aware rejection in send path | `feat/send-limits` | 0 |
| 3. Pre-broadcast sanctions + address screening hard-stop | `feat/sanctions-screening` | 0 |
| 4. Replace hardcoded FX snapshot; add new currencies | `feat/fx-live-feed` | 0 |
| 5. Generalize Paga → `transfers` machine | `feat/transfers-state-machine` (+ `feat/corridor-registry`) | 0 |
| 6. Re-run unit economics; bank-funded default + fee | `feat/onramp-bank-funding` (policy in `feat/corridor-registry`) | 1 |
| 7. Pilot the new stack on the LIVE NGN corridor | Phase 0 acceptance gate (§2.3) | 0 |
| 8. Incorporate SG entity; MAS MPI; Circle Mint | *business/ops* (engineering anchor: SG hub in `feat/corridor-registry`) | 0→1 |
| 9. Hire compliance officer; fintech counsel | *business/ops* | 0 |
| 10. Venture-debt / warehouse line for float | *business/ops* (engineering: `feat/treasury-float-ledger` accounting) | 0 |

Items 8–10 are business/ops, not code — but the engineering plan gives them working software to anchor on: the SG hub in the corridor registry, the float-pool ledger that makes the warehouse-line accounting real, and the compliance stack a partner's diligence will demand.

---

## 7. What this plan deliberately does NOT do

Per the master plan §9 `[KILLS]` findings and §12 verdict, these are out of scope on purpose:
- **No Korea corridor.** Dropped from the launch and early-growth plan (§5, §9 `[KILLS]`); no `feat/*` branch builds KRW rails. KRW is intentionally *not* added to `Currency` in Phase 0.
- **No four-corridor consumer launch.** One corridor (US→JP), gated on Phase 0 + break-even.
- **No "fee-free" framing in code or copy.** Transparent fee / surcharged card is built into `feat/onramp-bank-funding` + the iOS quote block.
- **No omnibus custody, no MPC re-platform, no on-chain DEX FX for corridor conversion** (§3) — the zkLogin self-custody + ledger-overlay model is preserved; DeepBook/Cetus stay scoped to wallet conditioning only.
- **No yield-underwritten corridor economics** — Earn is a separate, opt-in, disclosed service (`feat/ios-earn-reframe`), never a balance property.
