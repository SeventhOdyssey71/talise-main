<!-- Generated 2026-05-31 by a 12-agent planning workflow (7 deep-dives + 4 adversarial critiques + synthesis). Grounded in the Talise codebase as of commit 1757484. Decision-grade strategy doc. -->

# Talise Master Plan: Chain-Abstracted Cross-Border Money Movement (US / Japan / Korea / Singapore)

*Canonical strategy document — synthesized from seven expert deep-dives and four adversarial critiques. Decision-grade. Read the Honest Verdict (§12) if you read nothing else.*

---

## 1. Executive Summary

Talise today is a working, gasless, chain-abstracted Sui wallet with zkLogin onboarding, SuiNS `@handle` identity, a USD-denominated balance rendered in local currency, a live Stripe on-ramp, and a live Paga off-ramp into Nigerian Naira. The vision is to evolve this into a hybrid, fiat-in/fiat-out wallet that moves money across the US, Japan, South Korea, and Singapore corridors with the blockchain fully invisible — yen at one end, dollars at the other, USDC/USDsui as the unseen settlement rail in the middle. The strategic logic of the target geographies is sound: high smartphone and bank penetration eliminate the cash-agent moat that protects Western Union, and 2025's regulatory convergence (US GENIUS Act, Japan's PSA + JPYC, Singapore's MAS framework) creates the first compliant on-chain fiat legs. **But the four adversarial reviews converge on one brutal correction: this is not a Western Union displacement play — it is a margin-and-UX wedge against *fintech* incumbents (Wise, Remitly, Revolut, Bridge/BVNK), who already win on price, trust, and near-instant bank rails in exactly these corridors.** The unit economics are negative on the funding method consumers default to (cards), the four "easy regulation" markets are in fact the slowest and most expensive to license, the working capital required is realistically $8–15M not $3–5M, and the compliance program the entire thesis depends on does not yet exist in the codebase.

**The single sharpest recommendation: do not launch four consumer corridors. Anchor on a Singapore MAS license, win ONE corridor (US→Japan, bank-funded, B2B/high-value-diaspora first), make the `@handle` identity network — not price — the moat, and treat compliance, float, and licensed partners as the product to build before any new-corridor launch. Korea is removed from the early plan entirely.**

---

## 2. The Opportunity & Beachhead

### The real opportunity (and the real competitor)

The legacy cross-border stack has two attackable seams: the **retail remittance oligopoly** (WU/MoneyGram/Ria — agent network + per-tx fee + 130–250bps hidden FX margin + multi-day float) and **SWIFT correspondent banking** (2–4 hops, $15–50 each, trillions in dead nostro/vostro capital). Stablecoin rails collapse float to zero and settle in under a second. But here is the correction the incumbent-defense critique forces: **once you choose high-digitization corridors (US/JP/KR/SG) and concede the cash corridors, WU is no longer the incumbent. Wise (~50–70bps, mid-market FX, trusted, fully licensed in all four markets), Remitly, Xoom, and Revolut are.** Against Wise, a 5–20bps price edge that is *invisible because FX is hidden* is not a reason to switch. Worse, domestic instant rails (FedNow, RTP, Zengin, PayNow) already make fiat-to-fiat feel instant on each leg, so "sub-second Sui finality" is not a felt consumer benefit.

**Therefore the wedge is not price. It is two things crypto rails genuinely win:**
1. **SMB / B2B treasury, payroll, and trade settlement** — the corridor table shows B2B flow is 20–50× remittance (US–JP goods trade ~$230B vs ~$8–10B remittance). Here 45–90bps beats Wise Business' 50–100bps, funding is *always* bank-rail (no card-loss problem), tickets are large, and flows net better. This is the P&L.
2. **The `@handle` identity layer** — "send to @kenji, he gets it in his currency, instantly, anywhere" is a UX moat Wise structurally cannot copy without rebuilding their account model. This is the consumer wedge and the long-game network effect — but it is a slow-burn moat, not a launch lever.

### TAM / SAM (explicit assumptions)

Global remittances ≈ $900B; cross-border B2B+consumer ≈ $30T+. The addressable digital, regulation-friendly slice across US/JP/KR/SG corridors + diaspora outflows ≈ **$150–250B SAM**. At a blended **~45bps net take** (FX spread + premium services + a transparent fee — *not* fee-free), capturing 2–3% of SAM = ~$3–6.7B annual volume → **$13–30M net revenue** at modest penetration. **Critical caveat from the treasury critique: this is gross of partner revenue-share (likely 15–20bps haircut in partner markets) and gross of float cost. Model partner share as a permanent haircut.**

### Beachhead: US → Japan, bank-funded, B2B-and-high-value-diaspora-first

Win **one** corridor before fanning out. **US→Japan (with Japan→US as the reverse leg)** because:
- **Volume × value:** large diaspora/student/dual-resident base *plus* the massive SMB trade overlay with high average ticket sizes that make bank-funded economics work.
- **Regulatory feasibility (with the caveat below):** Japan has a live yen stablecoin (JPYC) and a mature PSA framework; the US leg is GENIUS-clean.
- **Competition:** incumbents are weak in high-trust digital JP flows; stablecoin-native players are B2B-orchestration-focused, leaving the consumer fiat-abstracted wallet open.

**The regulatory-killer critique forces an honest amendment to the beachhead:** Japan's only *cheap* entry rail (JPYC, FSA Type-II funds-transfer) is **capped at ¥1M per transfer**, which legally excludes the high-ticket B2B flows the corridor is sized on. So the beachhead is scoped in two tracks: **(a) consumer/SMB remittance under ¥1M via the JPYC rail launches first; (b) high-ticket B2B requires a Type 1 FTSP + EPIBP via a local partner and a Japanese subsidiary — started now, live in 18–36 months.** Do not size the launch on the $230B trade flow you cannot legally serve for two years.

### Expansion order (revised — Korea dropped early)

1. **Singapore — the licensing anchor** (the only directly self-licensable market). Route as much corridor flow as legally possible through the SG entity.
2. **US → Japan** — partner-led launch, consumer/SMB under the JPYC cap first, B2B as the local-substance build matures.
3. **Singapore → ASEAN payout** (SG→PH/ID/VN) — reuses the SG license; replaces Korea in the "four-corridor" narrative. Dense diaspora corridors (Vietnamese/Filipino workers) where *both* ends are underserved by domestic wallets.
4. **South Korea — deferred to post-Series-A.** The real-name-bank-account wall is bank-gated, post-Terra-hardened, and effectively un-enterable for a foreign startup for 2+ years regardless of capital. Banks must underwrite the VASP itself, and the few exchanges that hold real-name accounts will not white-label their scarcest regulatory asset to a competitor consumer wallet. **KR is removed from the launch and early-growth plan.** Re-evaluate only after the Digital Asset Basic Act is law *and* a named banking sponsor is in hand.
5. **Japan self-licensed (Type 1 + EPIBP)** — last, funded by SG/US revenue.

---

## 3. Reference Architecture

### Custody model: zkLogin self-custody + off-chain fiat ledger overlay (NOT omnibus)

**Recommendation: keep today's model — a user-controlled zkLogin Sui address per user, with a libSQL ledger that *denominates* and renders the balance in the user's display currency.** The ledger is a view, not the asset. This uniquely satisfies four constraints at once: (a) **regulation** — funds sit at a user-controlled address, narrowing licensing on the *holding* function to non-custodial software; (b) **recovery** — zkLogin solves seed-phrase loss via OAuth + salt ("log back in with Google and your money is there" is literally true); (c) **UX** — the ledger overlay renders fiat, the chain stays invisible; (d) **instant internal transfers** — Talise→Talise sends settle off-chain on the ledger (debit row, credit row, zero on-chain tx), on-chain only when value crosses the trust boundary. Omnibus custody is rejected: it makes Talise a fund-custodian, triggering the heaviest licensing (BitLicense, JP intermediary custody, MAS custody) and reintroducing FTX-class commingling risk. MPC is rejected as a re-platform for no marginal benefit over zkLogin.

**Two unavoidable corrections from the regulatory critique:**
- The internal "pure ledger entry" optimization means Talise operates a **closed-loop fiat ledger of customer balances** — that likely triggers **safeguarding/segregation** obligations in SG and JP regardless of the "non-custodial" framing. Plan **segregated client-money accounts** as mandatory. Safeguarded balances **cannot** be lent into NAVI.
- Self-custody conflicts with **mandatory freeze/clawback**. Resolution: adopt a **regulated-coin freeze path** (a `RegulatedCap`/DenyList-gated transfer Talise can invoke under court order) AND maintain the ability to freeze the **internal ledger balance** + contractually refuse to sponsor/broadcast flagged transfers. Disclose that a settled on-chain leg cannot be reversed, and disclose USDC DenyList exposure to users.

### Multi-currency balance model: USDsui is the single on-chain truth; currency is a ledger attribute

There is **one** on-chain asset (USDsui, 6dp), with Circle USDC as the CCTP-bridgeable transit asset. A "¥ balance" and a "$ balance" are *not* two on-chain coins — that fragments liquidity and forces on-chain FX on every read. Instead: each user has a USDsui position (reconciled against `suix_getBalance`) + a display-currency preference; `displayBalance = usdsuiMicros × rate[ccy]` (the existing `/api/fx` pattern). FX **spread is captured only at conversion moments** (ramp-in, ramp-out, cross-currency send), never on idle balance. Quote-lock at the edge mirrors the existing Paga pattern: a TTL-locked quote with a persisted `status='quoted'` row, generalized into a `transfers` state machine: `quoted → debited → onchain_settling → onchain_settled → fiat_out_pending → settled`.

**Treasury-critique correction:** route corridor inventory in **native USDC, not USDsui**, holding USDsui only for the in-app gasless consumer rail and the absolute minimum in-flight settlement. This caps depeg exposure (see §6, §9).

### The cross-currency primitive: FX at the edges, stablecoin 1:1 on chain

Do **not** do on-chain DEX FX for corridor conversion — there is no deep Sui-native ¥/₩/S$ liquidity, and AMM slippage/MEV become customer-visible. DeepBook/Cetus stay scoped to **wallet conditioning** (sweeping stray SUI/USDC/DEEP into USDsui, ~1bp pool), which the codebase already does. Corridor FX happens off-chain at the banked-rate edges; the chain moves USDC/USDsui at par.

### JP → US flow, end to end (ASCII)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ USER-VISIBLE (sub-second)                                                     │
│                                                                               │
│ [1] Sender (Tokyo) enters ¥150,000 → picks recipient @kenji                   │
│ [2] Locked FX quote (TTL) + ~spread; shows "recipient gets $96.40"            │
│ [3] Debit ¥ via Zengin furikomi into JP virtual account  ── JP partner bank   │
│ [4] RISK ENGINE: on AUTHORIZATION (bank-funded/cleared, or Tier-2+ user),     │
│     credit recipient from US USD float pool → recipient sees $ SETTLED         │
│     ◀── THIS is the "instant". Talise carries inbound risk (see §9 fraud).    │
│ [5] Recipient's USD = USDsui in their zkLogin Sui addr (gasless, Onara-        │
│     sponsored, Shinami broadcast, Payment Kit receipt)                         │
├───────────────── ASYNC REBALANCING — off the user's critical path ────────────┤
│ [6] JP float: ¥ → JPYC (FSA-licensed) → USDC on Sui (DEX/CCTP)                 │
│ [7] On-chain net-settle: USDC moves Talise-JP-pool → Talise-US-pool (~1s)      │
│ [8] US pool: USDC → USD via Circle Mint redemption → replenish US float        │
│ [9] Reconcile ledger; release sender credit hold                              │
└───────────────────────────────────────────────────────────────────────────────┘
        Sui rail (steps 5–7) = ALREADY BUILT. FX risk lives at [4] and [6]/[8].
```

The chain is **not** on the user's critical path for "feels instant"; pre-positioned float on both ends is. The chain is the **net-settlement rail between Talise's own float pools** — the genuine structural edge (less working capital than a SWIFT correspondent network). *This — not consumer-facing sub-second finality — is what to emphasize.*

### Reused vs net-new

| Reused from Talise today | Net-new to build |
|---|---|
| zkLogin self-custody + salt recovery | KYC tier engine + `users.kyc_tier` + tiered/limit gating |
| SuiNS `@handle` resolution (`ReceiveView`, send picker) | Sanctions + on-chain address screening (pre-broadcast hard-stop) |
| Gasless sends (Onara sponsorship, Shinami broadcast) | Travel Rule (IVMS-101) integration for external VASP/unhosted |
| `TaliseVault` + `AutoSwapCap`/`SwapTicket` (USDC→USDsui) | Live executable FX feed (replace hardcoded snapshot); add JPY/KRW/SGD to `Currency` type |
| DeepBook/Cetus for wallet conditioning | Per-corridor float pools + treasury rebalancing ops |
| Payment Kit on-chain receipts | Generalized `transfers` state machine + compensating-failure semantics |
| `/api/fx` display rendering; `/api/offramp/*` provider-agnostic contract | Per-corridor bank/PSP integrations (Zengin, PayNow, FedNow/RTP) |
| Paga quote-lock + state machine (template) | Fraud/chargeback reserve + instant-credit risk gating |

---

## 4. Ramp & Banking Strategy

**Design principle: Talise is a settlement-and-FX orchestrator, not a ramp reseller.** It owns the on-chain leg (defensible) and bolts local fiat legs on via swappable BaaS/PSP partners behind one internal interface — the pattern the codebase already encodes (`offramp_payouts.provider`, `/api/offramp/bank/*`). **The honest tension (regulatory critique): "own the FX book and float" and "launch fast on a partner's license" are mutually exclusive. In partner markets you get one. The realistic posture is to launch as a true agent where the licensed partner is merchant-of-record, sets FX, and holds float — Talise earns rev-share + the UX — and migrate to owning the book only where Talise holds its own license (Singapore).**

**The float thesis:** "instant" = pre-positioned destination-currency float on both ends, drawn down on authorization and reconciled behind the user. The slow legs (collection clearing, on-chain transfer, treasury rebalancing) happen async.

### Per-corridor rails and partners (rent, don't build)

| Corridor | Fiat-IN | Fiat-OUT | Partners |
|---|---|---|---|
| **US** | **Bank/ACH/FedNow/RTP (DEFAULT)**, card via Stripe (surcharged, see §6) | RTP/FedNow instant credit, ACH, wire | Stripe (live, card), **Bridge** (Stripe-owned, issues USDsui), **Lead/Column/Cross River** (FedNow+RTP+VAN), **Circle Mint** (USDC mint/redeem) — but launch as **agent of a licensed remitter**, not raw sponsor bank |
| **Japan** | Zengin furikomi into named VANs, conbini cash-in | Zengin credit | **JPYC Inc.** (FSA Type-II, ¥1M cap) for JPY⇄stablecoin; **GMO Aozora Net Bank / Komoju/DG** for bank+conbini rails; Type 1 FTSP + EPIBP partner for >¥1M |
| **Singapore** | PayNow, FAST, GIRO | PayNow / FAST instant | **MAS-licensed PSP/MPI** while own MPI pends: **Nium, dtcpay, StraitsX (XSGD), Airwallex/Currencycloud** |
| **SG→ASEAN** | (via SG entity) | Local instant rails PH/ID/VN | StraitsX/Nium payout network |
| ~~Korea~~ | **DEFERRED** | — | Real-name bank account wall; no viable foreign-startup path until post-Series-A |

**Build-vs-buy:** rent regulated rails via partners; own named virtual collection accounts over omnibus settlement accounts Talise controls, with **segregated client-money accounts per jurisdiction** (mandatory). Use **Circle Mint directly** (USD wire → USDC on Sui, 1:1, free) to capture mint/redeem at par rather than buying USDC retail through MoonPay/Transak. **Local stablecoins (JPYC, XSGD) are first-class on-ramp shortcuts** where regulated and liquid. Cross-chain USDC uses **Circle CCTP** (Sui on V1 today; architect for V2, H1 2026). MoneyGram's USDC API is a *cash-out coverage backstop only* — never core, since it means renting the incumbent's network in corridors where Talise's model breaks.

---

## 5. Regulatory & Licensing Roadmap

**The licensing lens decides whether Talise lives.** Sub-second finality is irrelevant if Talise cannot legally touch local fiat on both ends. Structural assumptions: **(1) Talise holds zero licenses on its own balance sheet at launch and operates everywhere day-1 as a regulated partner's agent; (2) Talise is never a stablecoin *issuer* — only a distributor/intermediary/DTSP; (3) the "chain is abstracted" thesis is a regulatory *liability*, not a shield — regulators look through the UX, and Talise stacks BOTH the fiat money-transmission regime AND the digital-asset regime simultaneously in every market.**

### United States — partner-led, acquire-in-parallel
- **Licenses:** FinCEN MSB registration + state MTL in ~40–50 states + NYDFS BitLicense for NY crypto. GENIUS Act governs the stablecoin leg; from ~July 2028, only stablecoins from a *permitted issuer* may be offered to US persons → contractually require USDC/USDsui migrate to a GENIUS-compliant issuer. Yield (NAVI) must be a **separate, opt-in lending/advisory service**, never a stablecoin feature.
- **Path:** launch as a **true agent of a licensed remitter** (partner is merchant-of-record, holds float/FX); file own MTLs via NMLS/MTMA in parallel. **Carve NY out of launch.**
- **Timeline/capital:** partner 9–12 months (the "1–3 months" claim is over-optimistic — a crypto-touching startup with no built compliance stack faces 4–9-month BSA diligence, often declined); self-license $240k–$475k+ upfront, $225k–$280k/yr, BitLicense $100k–$1M+, 2–3 years.
- **Blocker:** 50-state patchwork + NY. Partner-first for years.

### Japan — local-substance build, two tracks
- **Licenses:** Funds Transfer Service Provider (Type 1 for >¥1M; Type 2 ≤¥1M) under PSA, **plus** Electronic Payment Instruments Business Provider (EPIBP) to handle third-party stablecoins. Foreign-issued USDC onboarded via a Japanese trust/intermediary structure.
- **Path:** consumer/SMB under ¥1M via JPYC rail + partner now; Type 1 + EPIBP via local partner with a Japanese subsidiary (resident management, Japanese-language compliance) — start FSA pre-filing dialogue *immediately* (longest lead time).
- **Timeline/capital:** Type 1 authorization 12–24 months; budget ¥100M+/$700k+. Partner entry 6–12 months.
- **Blocker:** FSA's relationship-driven, Japanese-language, local-substance gate. Time and standing, not money.

### South Korea — DROPPED from early plan
- **Why:** the real-name verified bank account (one bank must underwrite the VASP itself; ~5 of ~28 VASPs hold one post-Terra) is un-enterable for a foreign startup. Digital Asset Basic Act (~Q1 2026) adds foreign-issuer local-branch + FSC license + KRW 0.5–5B capital floors. FX Transactions Act caps/reports outbound won; the won is non-internationalized so KRW float is structurally hard.
- **Path:** none viable now. If KR exposure is strategically required, the *only* posture is a pure referral skin where a licensed Korean exchange is merchant-of-record and owns the user relationship and liability — and even that requires a willing partner that does not exist today. **Re-evaluate post-Series-A.**

### Singapore — the anchor (self-licensable)
- **Licenses:** one coherent PSA 2019 regime under MAS — Major Payment Institution (MPI) covering Cross-Border Money Transfer + Digital Payment Token (DPT) service. SCS framework binds issuers, not Talise-as-distributor.
- **Path:** incorporate the holding entity in SG, file the MPI directly, launch via a licensed PSP partner while pending. SG becomes the hub other corridors route through.
- **Timeline/capital:** MPI base capital S$250k (DPT); approval 9–18 months + security deposit; all-in ~S$1–3M.
- **Blocker:** MAS's AML/CFT + fit-and-proper bar — rigorous but **attainable and predictable**, unlike the structural walls of the other three.

### Sequence

1. **Singapore first (Months 0–18):** incorporate, file MPI, launch via PSP partner. The anchor.
2. **US second, partner-led (Months 0–12 partner; 12–36 self):** true agent on a licensed remitter; file own MTLs in parallel; NY deferred; ensure GENIUS-compliant settlement before 2028.
3. **SG→ASEAN third:** reuse the SG license.
4. **Korea — deferred post-Series-A.**
5. **Japan self-license last (Months 18–36+):** Type 1 + EPIBP + subsidiary, funded by SG/US revenue. *Subsidiary and FSA dialogue start now.*

---

## 6. Treasury, Liquidity & Unit Economics

**This discipline kills remittance startups quietly. The product promise is a promise to pre-fund both legs of every corridor before the volume that justifies the inventory exists.**

### Float model — materially understated; re-baseline to $8–15M

Rule of thumb: `float ≈ settlement-lag-days × daily-volume × 1.4 safety multiplier`, applied to **both** legs of every directed corridor. The original $3–5M for four corridors understates reality because: flows are **one-directional** (diaspora-out; receive-side float drains and never refills organically), and you must add a **chargeback/ACH-return reserve** (card tail 60–180 days), a **de-peg buffer** (never sized originally), and **segregated client-money** that *cannot* be lent into NAVI. **Realistic all-in: $8–15M deployed and idle at launch, costing ~$1–1.8M/yr at 12% cost of capital.** This is the single hardest fact in remittance.

**Mitigations:** raise float as **venture debt / a warehouse line secured against Circle-redeemable USDC** (high-quality collateral, 80–90% advance), not dilutive equity. **Launch ONE directed corridor (US→JP), keeping float at ~$1–2M** until per-corridor margin is proven. Treat KR (dropped) and JP-inbound as **receive-first/payout-light**. Only Talise's own operating float/equity goes into NAVI — which sharply shrinks the "yield on idle float" revenue line.

### Spread, cost stack, and the negative-economics trap

Spread captured server-side: auto-swap (USDC→USDsui, ~30bps) + off-ramp FX (25–50bps) = ~80bps gross. Cost stack: **card on-ramp ~2.9%+$0.30 (the killer)**, Circle Mint ~0bps, DeepBook/Cetus slippage 5–15bps, PSP payout negligible, on-chain gas ~$0 (sponsored).

**Unit economics (per $1,000 sent):**

| Corridor | Gross spread | Ramp cost | Net /$1k | Margin % |
|---|---|---|---|---|
| US→NG (ACH-funded) | $8.00 | $8.00 | **–$1.06** | –0.1% |
| US→NG (card-funded) | $8.00 | $29.30 | **–$22.36** | –2.2% |
| US→NG (+1.0% fee, ACH) | $18.00 | $8.00 | **+$8.94** | +0.9% |
| JP→KR (bank-funded) | $8.00 | $3.00 | **+$4.20** | +0.4% |

**The headline finding (and the death spiral): at 80bps and card funding, every corridor loses money — card fees alone exceed the spread.** You cannot be "fee-free" AND profitable. The conversion-optimized UX selects for the loss-making method.

**Mitigations (decisive calls):**
- **Kill "fee-free" positioning.** Adopt a transparent flat fee (~$4–5) or +0.75–1.0% receive-side spread — still 3–5× cheaper than WU's 6.4% all-in. Market on *total cost vs incumbents*, not zero-fee.
- **Make bank/ACH/FedNow/Zengin/PayNow funding the DEFAULT.** Card becomes a surcharged convenience tier (pass the 2.9% through explicitly). The card-loss problem is specific to relying on Stripe Onramp.
- **Lead with B2B/bank-funded** (the only structurally positive rows). Consumer is a loss-leader to seed the `@handle` network; **B2B is the P&L.**
- **Add a fraud reserve** (30–80bps of card volume) — the originally-missing line (see §9).

### FX risk and the stale-snapshot problem

The live system prices display FX off a free public API (1h cache) and corridor rates off a **hardcoded Q2-2026 snapshot**, and the `Currency` type is only `NGN|KES|GHS|ZAR|USD` — **JPY/KRW/SGD are not even in the type.** Pricing FX off a free reference feed with no executable backing works at toy volume and breaks in a volatility spike (correlated tail risk with float + peg). **Mandatory prerequisite before any new corridor:** migrate to a **live, executable FX feed** sourced from the actual conversion venue (Circle Mint USD leg, the JP/SG partner's quoted rate, an OTC desk for size), make it server-authoritative for quote generation, add JPY/KRW/SGD to the type, set spread **per-corridor by realized volatility** with a max-age circuit breaker, and never warehouse naked directional FX.

### Treasury ops and the break-even discipline

Diaspora flows are one-directional → periodic rebalancing (Circle redemption + local PSP top-ups). Levers: net settlement (settle imbalances once daily, ~90% fewer on-chain round-trips), batched payouts, just-in-time minting. Engage OTC desks (Cumberland, Wintermute) above ~$250k single swaps; engage MMs above ~$1M daily.

**Worked example:** +1% fee, ACH-funded US→NG nets $8.94/$1k (0.894%). At $50k/day, float ≈ $490k costing ~$58.8k/yr; annual margin = $18.25M × 0.894% = **$163k/yr — 2.8× float-cost coverage.** Float cost (~0.32% of volume) sits well inside the 0.894% margin, so any *positive-per-unit* corridor is float-viable at steady volume. **The true threshold is fixed-cost absorption: each corridor must clear ~$30–40k/yr in integration/compliance plus its share of the blanket float cost — implying ~$4M annual volume (~$11k/day) per corridor to break even all-in.** Discipline: **launch a corridor only when projected 90-day volume clears that line; never subsidize card-funded sends out of the spread.**

---

## 7. Compliance Operating Model

**Compliance is not a feature — it is the license to operate, and it does not exist in the codebase today.** Verified gaps: no `/api/kyc` route, no `users.kyc_tier` on main, no API-layer daily-limit enforcement, no sanctions list, no on-chain screening gate in the prepare→broadcast path, no Travel Rule integration. Onboarding is Google OAuth (proves email control, satisfies *zero* KYC obligation); the only KYC/AML in the system is what Stripe and Paga carry *for their own books*. **This is the gap that turns "partner in 1–3 months" into "declined." It is a P0 launch blocker, sequenced BEFORE any corridor.**

### KYC/KYB — closing the Google gap, risk-tiered

- **Tier 0** (email only): receive-only, no cash-out.
- **Tier 1** (basic ID + liveness): up to ~$1,000/mo.
- **Tier 2** (full ID + address + sanctions clear): corridor limits per license.
- **Tier 3** (source-of-funds/EDD): high-value, PEP, business.

Per-market: **US** — name/DOB/address/SSN-ITIN (CIP), OFAC at onboarding; **Japan** — 犯収法, eKYC ホ方式 (selfie + live capture); **Korea** — real-name account (why KR is deferred); **Singapore** — MAS PSN01, Myinfo eKYC. KYB for business handles: registry extract, UBO ≥25%, control persons screened.

### AML/CFT program

Each licensed entity needs a written, board-approved program: designated officer (BSA/MLRO), internal controls, independent testing, training; a documented risk assessment; transaction monitoring (structuring, rapid in-out, velocity, mule, corridor-mismatch); SAR/STR routing to the right FIU (FinCEN, JAFIC, KoFIU, STRO-SONAR) via one internal case-management layer.

**Sanctions screening — three layers, every transfer:** (1) sender + beneficiary name vs OFAC/UN/EU/MAS/local (fuzzy + review queue); (2) **on-chain counterparty address** risk-scored via Chainalysis KYT (+ TRM as second source) — a failed screen is a **hard-stop before the gasless Shinami broadcast**; (3) post-settlement address-graph monitoring.

### FATF Travel Rule

Above threshold (~$1,000; KR ~KRW 1M), transmit originator/beneficiary data in **IVMS-101** via a Travel Rule network (Notabene, Sumsub, TRP, TRUST). The wallet model splits cleanly: **Talise↔Talise** (most consumer flow) — data stays in Talise's own ledger, no external message needed; **Talise→external VASP** — VASP discovery + IVMS-101 exchange + sunrise fallback; **Talise→unhosted wallet** — beneficiary self-declaration per local rules. *Collect full KYC + source-of-funds at onboarding (not deferred) so this data exists before any external transfer is possible.*

### Regulated-stablecoin obligations

Honor issuer freeze/seize; freeze internal balances independently; consume Circle's monthly attestations into reserve-and-liability reconciliation; design around USDC smart-contract DenyList exposure.

### Build-vs-buy and headcount

**Buy** commodity layers: eKYC + liveness (Sumsub or Persona, covering JP/SG document sets + Travel Rule add-ons); on-chain analytics (Chainalysis KYT + TRM); Travel Rule (Notabene). **Build** only orchestration: the risk-tier engine, case management, FIU-report router, pre-broadcast screening gate wired into the existing prepare→broadcast flow. **Headcount/cost:** one named accountable compliance officer **per licensed entity** (fractional/contract MLRO acceptable to start) + 2–4 shared analysts at scale; vendor spend $150k–$500k+/yr; annual independent AML audit per entity. **This is the dominant fixed cost of the cross-border thesis — model it in unit economics, not as overhead.**

---

## 8. Product & UX

### Mental model: you hold money, denominated in your money

Talise's display layer already does the conceptual work (`CurrencySettings` renders a USD balance in a chosen currency; USDsui is never the user's unit). The chain-invisible vision *deepens* this. **Discipline: the word "USDsui" disappears from every primary surface.** Today's secondary "X USDsui" line (`SendAmountView`, `SendReviewView`) becomes an opt-in settlement breakdown ("We move this as digital dollars, 1:1") for the US/JP/KR/SG corridors. Per-corridor framing diverges without forking the app: in NGN/KES the FX *is* the product; in the new corridors the product is **parity and speed**, stablecoin as plumbing.

### The `@handle` is the differentiator — and the long-game moat

The SuiNS `@handle` answers WU's MTCN-and-counter-visit ritual: "send to @kenji" works identically whether Kenji is in Tokyo, Seoul, or San Francisco. `ReceiveView` already prefers `displayHandle()`; the send picker presents (1) prior recipients (`previousSendsToRecipient`), (2) `@handle` live SuiNS search, (3) phone→handle (invite-to-claim fallback), (4) raw `0x` as the power-user escape hatch.

**Cold-start correction (incumbent-defense critique):** the `@handle` magic only works when the recipient is already on Talise — otherwise it degrades to an invite-to-claim wall imposed on someone who already has PayPay/LINE/KakaoPay/Venmo/Zelle. In saturated domestic-wallet markets, the two-sided cold start is brutal. **So at launch, do NOT require recipient adoption — interoperate: pay OUT into PayNow/Zelle/bank/local rails so the recipient never needs Talise to receive.** Seed the `@handle` network in **dense diaspora corridor-pairs** (Vietnamese/Filipino workers in Japan; Korean students in the US) where both ends are underserved by domestic wallets and the corridor is locally complete. Make receive-side onboarding zero-friction (Tier-0 receive-only before full KYC). **The `@handle` is the long-game moat, not the launch wedge.**

### The cross-border send flow

Reuse the three-step `SendFlowView` spine: **(1) Amount** typed in *my* currency; the secondary line shows recipient-side amount when currencies differ ("¥15,000 → recipient gets $96.40"). **(2) Review** replaces the generic fee line with a transparent locked-quote block: rate, spread shown as an explicit fee, total debit, guaranteed receive amount, a "rate held 30s" countdown; `SlideToConfirm` is the commit gesture (physical, irreversible — correct for money). **(3) Send + "delivered":** distinguish **"sent" (chain-final, irreversible)** from **"landed in their bank"** (Zengin/Korean rails aren't 24/7). Reuse Home's optimistic-stub machinery (`pendingOptimisticStubs`, `.taliseTxCompleted`, 90s TTL): row appears as "Sent — arriving by 3:00pm," resolves to "Delivered" on the payout webhook. `SendSuccessAnimation` fires on **chain finality** with honest copy ("Sent to @kenji" wallet-to-wallet; "On its way to Kenji's bank" for fiat payout). Never claim "delivered" before the payout rail confirms.

### Receiving, multi-currency, and Earn

Default: **auto-convert into the recipient's home display currency** (chain-invisible). Expose **hold-as-foreign-balance** as a deliberate choice (a Tokyo freelancer keeping USD) — light multi-currency "pockets" with in-app FX (same locked-quote block). "Add a currency" extends `CurrencySettings.allSupported` with JPY/KRW/SGD. **Earn is framed in fiat** ("Earn 4% on your dollars"), never "supply USDsui to NAVI" — but per §5/§9 it must be a **legally separate, explicitly opt-in lending/advisory service** with its own disclosures, never auto-supplied, never framed as a property of the balance, and **corridor economics must not be underwritten on yield revenue.**

### Trust, recovery, disputes

Users apply *bank* mental models. **Recovery:** re-authenticate via Google → address deterministically re-derived ("no seed phrase to lose," surfaced in onboarding). **Disputes:** on-chain sends are irreversible — front-load this via the `SlideToConfirm` friction and post-send copy ("@kenji can send it back, but Talise can't reverse a confirmed send"); offer a **cancel window** for fiat-payout legs before `remitting`. **Support:** every `TxReceiptView` is the support artifact (receipt ID, handle, locked rate, fee, corridor timeline) — a bank-grade statement backed by the Payment Kit receipt, never a chain explorer link.

---

## 9. Risks & Honest Mitigations

The four reviews agree: **no single risk kills the idea, but a specific cluster compounds into a near-fatal trap.** Marked **[KILLS]** where a risk is fatal if not mitigated before launch.

**[KILLS] Wrong incumbent / no price moat.** On US/JP/KR/SG the competitor is Wise/Remitly, not WU. A 5–20bps edge that's invisible because FX is hidden is no reason to switch, and domestic instant rails already feel instant. **Must be true:** reposition off "displace WU"; lead with B2B economics and the `@handle`/multi-currency UX; price parity with Wise is *sufficient* if identity/UX is 10× better.

**[KILLS] Negative unit economics on card funding.** Card fees (2.9%) exceed the 80bps spread; every card-funded corridor loses money. **Must be true:** bank-rail funding is the default; card is surcharged; a transparent fee replaces "fee-free"; B2B/bank-funded leads the P&L; corridors launch only above the ~$4M/yr break-even.

**[KILLS] Compliance program does not exist.** No KYC/AML/sanctions/Travel-Rule code; partner diligence sinks the deal on day one. **Must be true:** ship the KYC tier engine + tiered limits + pre-broadcast sanctions/address screening + a named compliance officer BEFORE representing any "compliance posture" to a partner or regulator.

**[KILLS] Korea is un-enterable.** The real-name bank account is bank-gated and post-Terra-hardened; no foreign-startup path for 2+ years. **Must be true:** drop KR from the launch and early-growth plan; replace with SG→ASEAN.

**[KILLS] Float is $8–15M, not $3–5M, and pre-revenue.** One-directional flows mean receive-side float never refills organically; add chargeback, de-peg, and segregation buffers. **Must be true:** raise float as venture debt against USDC collateral; launch ONE corridor; never lend safeguarded client balances into NAVI.

**[HIGH] Chicken-and-egg: no license + no volume = no banking partner.** Banks have spent five years de-risking exactly this profile; BaaS sponsor programs are collapsing. **Must be true:** get the SG MAS license first so every later conversation starts with "MAS-licensed"; target a remittance-license-as-a-service provider, not a raw sponsor bank; SG revenue funds US/JP partner diligence.

**[HIGH] Instant credit = silent unlicensed lending + fraud loss.** Crediting on *authorization* over an irreversible on-chain leg means a stolen-card send cashes out instantly and the chargeback lands 90 days later with zero recourse. This killed multiple crypto-remittance startups. **Must be true:** never instant-credit card-funded first transactions from unestablished users; gate instant credit to bank-funded (push, irreversible) rails and Tier-2+ users with history; budget a 30–80bps fraud reserve; treat on-chain irreversibility as a hard constraint forcing card funding to be slow-settled.

**[HIGH] USDsui depeg — unhedged asymmetric tail.** A 3% depeg on in-flight inventory is ~4× the gross margin on the volume it sits against; competitors on tokenized bank deposits carry no peg risk. **Must be true:** route corridor inventory in **Circle USDC**, use USDsui only for the in-app rail with a hard hours-of-volume dwell limit; architect settlement issuer-swappable (USDC↔USDsui = config change, not re-platform); the circuit breaker **fails over to USDC settlement, not halts**; capitalize an explicit depeg buffer; offer a user-facing "backed 1:1, redeemable" guarantee.

**[HIGH] GENIUS yield ban vs NAVI Earn + freeze-vs-self-custody conflict.** Marketing "earn on your dollars" over an abstracted balance risks recharacterization; self-custody can't honor a freeze order. **Must be true:** Earn is a separate, opt-in, disclosed lending service (get a securities/banking opinion); adopt a regulated-coin freeze path + internal-ledger freeze; disclose DenyList exposure.

**[HIGH] `@handle` cold-start in saturated wallet markets.** **Must be true:** interoperate (pay out into existing rails) rather than force recipient adoption; seed dense diaspora corridor-pairs; treat `@handle` as the long game.

**[HIGH] Japan beachhead vs ¥1M cap + local-substance gate.** The cheap rail legally excludes the B2B flows the corridor is sized on. **Must be true:** scope the JP launch to consumer/SMB under ¥1M; start the subsidiary + FSA dialogue now; don't size on the $230B trade flow for 2+ years.

**[MEDIUM] FX runs on a stale hardcoded snapshot; target currencies aren't in the type.** **Must be true:** migrate to a live executable feed with per-corridor volatility-based spreads and a max-age breaker before any new corridor.

**[MEDIUM] Solo-founder execution over-reach (295 commits/12 days, one author).** Four-country licensing in parallel is not solo-runnable. **Must be true:** one corridor as a partner agent; outsource compliance and float; prove the wedge on the live NGN corridor first.

**The compounding trap, stated plainly:** no liquidity/price edge over Wise (1) + 18–36-month partner-gated licensing that captures the margin (2) + negative economics on the default funding method (3) = death by float cost and CAC *if* Talise chases consumer card-funded remittance to beat WU on headline fee. **The idea survives only by abandoning that framing entirely.**

---

## 10. Phased Roadmap

### Now / 0–6 months — harden the existing African corridor; build the compliance and FX foundation

Grounded in today's state (live Stripe on-ramp, live Paga NGN off-ramp, zkLogin, gasless, SuiNS, USDsui).
- **Build first (P0, codebase-grounded):** KYC tier engine + `users.kyc_tier` + `/api/kyc` route; **hard API-layer daily-limit + tier-aware rejection in `/api/send/prepare`**; pre-broadcast sanctions + on-chain address screening (Chainalysis/TRM) wired into the prepare→broadcast path as a hard-stop before Shinami; eKYC vendor (Sumsub/Persona) integrated.
- **Migrate FX off the hardcoded snapshot** to a live executable feed; make it server-authoritative; add the volatility-based per-corridor spread + max-age breaker.
- **Prove the wedge on the LIVE NGN corridor** with the new compliance stack, a transparent fee, and bank-funded default — validate margin, fraud reserve, and the break-even discipline on a corridor that already exists.
- **Generalize the Paga state machine** into the corridor-agnostic `transfers` state machine.
- **Incorporate the Singapore holding entity; begin the MAS MPI filing; engage Circle Mint directly.**
- **Hire/contract the first compliance officer; engage fintech counsel** for US-agent structuring and SG.

### 6–18 months — Singapore live; US→Japan beachhead (under ¥1M)

- **MAS MPI approved (or live via PSP partner); SG is the hub.**
- **US→JP launches as a true agent** of a licensed remitter, **bank-funded default, card surcharged, consumer/SMB under ¥1M via JPYC**, with `@handle` + multi-currency pockets and pay-out interoperability into local rails.
- **B2B pilot** on the same corridor (large-ticket, bank-funded — the positive-margin row).
- **Float as venture debt** against USDC collateral; ONE directed corridor kept at ~$1–2M float.
- **Start the Japanese subsidiary + FSA Type 1/EPIBP pre-filing dialogue.**
- File US MTLs via NMLS/MTMA in parallel; NY carved out.

### 18–36 months — second corridor, self-licensing, B2B scale

- **SG→ASEAN payout corridor** (PH/ID/VN) on the SG license, seeded in dense diaspora pairs.
- **Japan Type 1 + EPIBP** progressing; high-ticket B2B unlocked.
- **US own-MTL coverage** expanding (BitLicense/NY as a funded later phase).
- **B2B treasury/payroll** becomes the primary P&L; consumer `@handle` network compounding.
- **Korea re-evaluated** only if the Digital Asset Basic Act is law and a banking sponsor exists.

---

## 11. Concrete Next 90 Days

Specific, actionable, leveraging the existing stack.

1. **Ship the KYC tier engine** — create `users.kyc_tier`, the `/api/kyc` route, and tiered gating; integrate Sumsub or Persona eKYC (JP/SG document sets included from day one). *(Existing: zkLogin onboarding; net-new: the tier layer.)*
2. **Enforce a hard daily-limit + tier-aware rejection in `/api/send/prepare`** — close the documented gap where the send path enforces no API-layer limit.
3. **Wire a pre-broadcast sanctions + on-chain address screening hard-stop** into the prepare→broadcast flow (Chainalysis KYT, TRM second source) — refuse to sponsor/broadcast a flagged send *before* Shinami fan-out. *(Existing: Onara/Shinami sponsor-execute path; net-new: the screening gate.)*
4. **Replace the hardcoded Q2-2026 FX snapshot** with a live executable feed; make it server-authoritative for quote generation; add `JPY|KRW|SGD` to the `Currency` type; add per-corridor volatility-based spread + max-age circuit breaker.
5. **Generalize the Paga quote-lock state machine** into the corridor-agnostic `transfers` machine (`quoted → debited → onchain_settling → onchain_settled → fiat_out_pending → settled`) with compensating-failure semantics (on-chain leg is the commit point; fiat-out failure parks funds in the recipient's vault, never lost).
6. **Re-run unit economics with bank/ACH-funded default + an explicit fee** as the base case; card funding modeled only as a surcharged tier with a fraud reserve. Adopt the ~$4M/yr per-corridor break-even gate as policy.
7. **Pilot the new stack on the LIVE NGN corridor** — validate margin, fraud reserve, and limits on a real corridor before any new-market spend.
8. **Incorporate the Singapore entity, begin the MAS MPI application, open a direct Circle Mint relationship** (USD wire → USDC on Sui at par).
9. **Hire/contract the first compliance officer; engage fintech counsel** for the US true-agent structure and the GENIUS-compliant-issuer contractual commitment.
10. **Begin the venture-debt / warehouse-line conversation** for float, collateralized by Circle-redeemable USDC — *not* dilutive equity.

---

## 12. The Honest Verdict

**Is it fundable and buildable? Yes — but only as a compliance-and-float-heavy fintech, not a lean software play, and only after a re-scope.** The technology is largely already built: zkLogin self-custody, gasless sends, SuiNS `@handle`, USDsui/USDC-on-Sui settlement, on-chain receipts, and a working off-ramp state machine are real and defensible. The on-chain net-settlement rail between Talise's own float pools is a genuine structural edge over SWIFT correspondent banking. What is *not* built — and what actually determines survival — is the compliance program, the live FX engine, the float facility, and the licensed-partner relationships. The original plan's optimism ("launch four corridors in 6–18 months, fee-free, displacing Western Union") is, on all four reviews, a near-fatal trap: wrong incumbent, negative card economics, un-enterable Korea, and understated float compounding into death by burn.

**The narrowest version that works:** Anchor on a **Singapore MAS MPI** (the one self-licensable market). Win **one corridor (US→Japan)** as a **true agent** of a licensed remitter — bank-funded by default, card surcharged, a transparent fee replacing "fee-free," consumer/SMB under the ¥1M JPYC cap, **with B2B/high-value-diaspora as the actual P&L.** Build the **KYC/AML/sanctions/Travel-Rule stack as a P0 blocker** before any launch. Raise **$8–15M of float as venture debt** against USDC collateral. **Drop Korea entirely** until post-Series-A. Treat the **`@handle` identity network — interoperating with local rails, not forcing recipient adoption — as the long-game moat**, since price cannot be.

**The one thing that determines success:** Talise must stop competing on price and win on **identity + UX + B2B economics** while surviving the 18–36-month licensing-and-float gauntlet. Concretely, that reduces to a single make-or-break execution test — **can the team secure a named, signed licensed partner in the US AND ship a real compliance program BEFORE spending a dollar on consumer acquisition?** If yes, the wedge is defensible and the chain-abstracted hybrid wallet is a fundable, buildable business. If the team instead chases consumer card-funded remittance to beat Western Union on headline fee, it dies on float cost and CAC against Remitly's brand and Wise's rate. **The chain is invisible; the moat is identity, B2B, and compliance — never price.**
