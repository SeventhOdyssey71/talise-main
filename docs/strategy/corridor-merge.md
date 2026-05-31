<!-- Companion to docs/strategy/cross-border-masterplan.md. Merges the African corridors (NG/KE/GH/ZA — partly live today) and the Asian/global corridors (JP/SG/PH/ID/VN/US) into one decision-grade matrix. Grounded in that master plan and the codebase as of commit 1757484. -->

# Talise Corridor Merge: African + Asian/Global Matrix

*Decision-grade corridor map. This document does not re-argue strategy — read [cross-border-masterplan.md](./cross-border-masterplan.md) for the thesis (chain stays invisible, compliance is a P0 blocker, FX moves off the hardcoded snapshot, the Paga state machine generalizes into a corridor-agnostic `transfers` machine). This is the **what-launches-where-and-when** companion: every corridor Talise touches, its rails, its licensing posture, its spread, its per-tx cap, and its phase.*

The two corridor families are governed by the **same** settlement spine — USDsui (1:1 USD, 6dp) for the in-app gasless rail, Circle USDC on Sui as the CCTP-bridgeable inventory and net-settlement asset between Talise's own float pools (master plan §3, §6). What diverges is **framing**: in the African corridors the FX *is* the product; in the new corridors the product is **parity + speed + the `@handle`**, stablecoin as invisible plumbing (§8).

---

## 1. The Two Families, One Spine

| | African family | Asian / global family |
|---|---|---|
| **Corridors** | NG / NGN, KE / KES, GH / GHS, ZA / ZAR | JP / JPY, SG / SGD, PH / PHP, ID / IDR, VN / VND, US / USD |
| **Product framing** | FX *is* the product; receive in local currency | Parity + speed; `@handle` identity; FX hidden |
| **Today's state** | NGN live (Stripe in / Paga out); KES/GHS/ZAR in FX type, no payout rail | None live; JPY/SGD/PHP/IDR/VND **not yet in the `Currency` type** |
| **Settlement asset** | USDsui in-app · USDC inventory | USDsui in-app · USDC inventory |
| **Licensing anchor** | (none today — Stripe/Paga carry their own) | **Singapore MAS MPI** = the self-licensable hub all flow routes through |
| **Role in the plan** | Prove the wedge + economics on a corridor that *already exists* | The growth surface, gated behind compliance + float + a license |

> **Codebase reality check (§6, §11):** `web/lib/fx.ts` defines `type Currency = "NGN" | "KES" | "GHS" | "ZAR" | "USD"` against a **hardcoded Q2-2026 snapshot** (NGN 1620, KES 132, GHS 14, ZAR 18.5). **JPY / SGD / PHP / IDR / VND are not in the type.** Adding them — backed by a *live executable* feed with per-corridor volatility-based spread and a max-age circuit breaker — is the documented prerequisite (P0) before any Asian/global corridor goes live.

---

## 2. The Merged Corridor Matrix

All eleven endpoints (US is both a source hub and a payout endpoint). **Status** is one of: **live** (in production today) · **partner** (launches as a true agent of a licensed remitter / PSP — Talise is not merchant-of-record) · **planned** (architected, not yet contracted). **Spread** is the gross take captured at conversion edges only (never on idle balance, §3); blended target ~45bps net (§2), but per-corridor by realized volatility (§6). Caps reflect either a legal rail ceiling or a KYC-tier limit.

| # | Corridor | Status | Fiat-IN rail | Fiat-OUT rail | Licensing posture | Spread (gross) | Per-tx cap | Launch phase |
|---|----------|--------|--------------|---------------|-------------------|----------------|------------|--------------|
| **AFRICAN FAMILY** |
| 1 | **NG / NGN** | **live** | Stripe Crypto Onramp (card → USDC on Sui) | **Paga** USDsui → NGN bank (quote→debited→remitting→settled) | Stripe + Paga carry KYC/AML for their own books; Talise has **no license** on its balance sheet | **~25bps** off-ramp (Paga) + ~30bps auto-swap = ~55bps; add transparent fee/+0.75–1.0% receive spread per §6 | Tier-gated: Tier-1 ~$1k/mo, Tier-2 corridor limit | **Now / 0–6mo** — harden + re-prove on the new compliance stack |
| 2 | **KE / KES** | planned | Stripe card (in type, no NG-style flow yet) | M-Pesa / bank payout (rail TBD) | Partner remitter / PSP; no own license | ~50–80bps target | Tier-gated | 18–36mo (African expansion) |
| 3 | **GH / GHS** | planned | Stripe card | MTN MoMo / bank payout (rail TBD) | Partner remitter / PSP | ~50–80bps target | Tier-gated | 18–36mo |
| 4 | **ZA / ZAR** | planned | Stripe card | EFT / RTC instant bank (rail TBD) | Partner remitter / PSP; SARB exchange-control sensitivity | ~50–80bps target | Tier-gated + SARB reporting threshold | 18–36mo |
| **ASIAN / GLOBAL FAMILY** |
| 5 | **US / USD** | **partner** (P0) | **Bank / ACH / FedNow / RTP (DEFAULT)**; card via Stripe **surcharged** | RTP / FedNow instant credit; ACH; wire | True **agent of a licensed remitter**; FinCEN MSB + state MTL filed in parallel via NMLS/MTMA; **NY/BitLicense carved out**; GENIUS-compliant issuer contractually required pre-2028 | ~45–90bps (B2B end); bank-funded only — no card-loss row | Tier-gated; instant-credit only Tier-2+ & bank-funded (§9 fraud) | **6–18mo** (beachhead reverse leg) |
| 6 | **JP / JPY** | **partner** | Zengin furikomi into named VANs; conbini cash-in | Zengin credit | **Two-track:** ≤¥1M via **JPYC Inc.** (FSA Type-II) + partner now; >¥1M needs **Type 1 FTSP + EPIBP** via local partner + JP subsidiary (18–36mo) | ~45–90bps | **¥1,000,000 hard legal cap** on the JPYC rail (excludes high-ticket B2B for ~2yr) | **6–18mo** (the beachhead: US→JP, consumer/SMB <¥1M) |
| 7 | **SG / SGD** | **partner → self** | PayNow, FAST, GIRO | PayNow / FAST instant | **The anchor.** MAS **MPI** (Cross-Border Money Transfer + DPT) filed directly; launch via MAS-licensed PSP (Nium, dtcpay, StraitsX/XSGD, Airwallex/Currencycloud) while pending | ~45–90bps; own the book here (only self-licensed market) | MAS PSN01 tier limits | **0–18mo** (incorporate + file first; hub for all routing) |
| 8 | **PH / PHP** | planned | (via SG entity) | Local instant rails (InstaPay / PESONet) via StraitsX/Nium payout net | Reuses the **SG MPI**; no separate PH license at launch | ~50–90bps | Tier-gated | **18–36mo** (SG→ASEAN payout) |
| 9 | **ID / IDR** | planned | (via SG entity) | Local instant rails (BI-FAST) via StraitsX/Nium | Reuses the SG MPI | ~50–90bps | Tier-gated | **18–36mo** (SG→ASEAN) |
| 10 | **VN / VND** | planned | (via SG entity) | Local bank / NAPAS rails via partner payout net | Reuses the SG MPI; VND tightly controlled, payout-only | ~50–90bps | Tier-gated + local inbound caps | **18–36mo** (SG→ASEAN) |
| — | ~~**KR / KRW**~~ | **DROPPED** | — | — | Real-name verified bank account is bank-gated, post-Terra-hardened; **un-enterable for a foreign startup 2+ yr** (§5). Removed from launch & early-growth plan | — | — | **Post-Series-A only** — re-evaluate iff Digital Asset Basic Act is law *and* a named banking sponsor exists |

**Reading the matrix:**
- **One corridor is live today (NG).** Everything else is partner-led or planned — consistent with the master plan's "win ONE corridor before fanning out" discipline (§2).
- **US and JP are the two halves of the single beachhead** (US→JP, with JP→US reverse leg). They launch *together* in the 6–18mo phase, bank-funded by default, consumer/SMB under the ¥1M JPYC cap, B2B as the local-substance build matures.
- **SG is filed first even though it's not the highest-volume corridor** — it is the *license*, the hub every later corridor routes through (§5 sequence).
- **The four "easy" original markets were Africa-heavy and Korea; the merged plan keeps NG live, defers KE/GH/ZA to the 18–36mo African-expansion window, and replaces Korea with SG→ASEAN.**

---

## 3. Per-Corridor Cap & Spread Logic (why the numbers above)

| Driver | African family | Asian / global family |
|---|---|---|
| **Cap source** | KYC tier limits (§7): Tier-1 ~$1k/mo, Tier-2 per-license corridor limit | **JPY: ¥1M legal rail cap** (JPYC Type-II) is the binding one; others are tier limits; VND has local inbound controls |
| **Spread floor** | NGN ~25bps off-ramp realized today (Paga, §6) | ~45bps blended net target; bank-funded B2B clears it, card cannot |
| **Why not "fee-free"** | Card on-ramp ~2.9% + $0.30 *alone* exceeds 80bps gross — every card-funded send loses money (§6). Bank/rail funding is the **default**; card is a surcharged tier; a transparent fee replaces "fee-free" | Same arithmetic; this is why US defaults to ACH/FedNow and card is explicitly surcharged |
| **Break-even gate** | A corridor launches only when projected 90-day volume clears **~$4M/yr (~$11k/day)** all-in fixed-cost absorption (§6) | Same gate; B2B leads the P&L because bank-funded rows are the only structurally positive ones |

All FX spread is captured **only at conversion moments** — ramp-in, ramp-out, cross-currency send — never on idle balance (§3). `displayBalance = usdsuiMicros × rate[ccy]`; the ledger is a view, the USDsui position is the truth.

---

## 4. Diaspora Corridor-Pairs — the `@handle` Network Seeding Strategy

The endpoints above are *rails*. The **network** is seeded along directed **diaspora corridor-pairs** — dense, locally-complete migrant flows where **both ends are underserved by the saturated domestic wallets** (PayPay/LINE in JP, Venmo/Zelle in US, GCash in PH). This is where the SuiNS `@handle` ("send to @kenji, he gets it in his currency, instantly") stops being a cold-start liability and becomes the moat (§8).

**Cold-start rule (§8):** at launch Talise does **not** require recipient adoption — it **interoperates**, paying OUT into PayNow / Zelle / bank / local rails so the recipient never needs Talise to receive. Receive-side onboarding is zero-friction (Tier-0, receive-only, before full KYC). The `@handle` is the **long game**, lit up first inside these dense pairs.

| Diaspora corridor-pair | Direction | Why it seeds the network | Maps to corridors | Phase |
|---|---|---|---|---|
| **Filipino workers in Japan → PH families** | JP → PH | Large, remittance-dense, JP domestic wallets don't serve outbound PH; both ends underserved | JP (#6) → PH (#8) | 18–36mo (needs SG→ASEAN payout) |
| **Vietnamese workers in Japan → VN families** | JP → VN | Fast-growing JP labor migration; VND payout-only fits | JP (#6) → VN (#10) | 18–36mo |
| **Vietnamese / Filipino workers in Singapore → home** | SG → VN / PH / ID | Routes entirely through the SG MPI; the cleanest licensed path | SG (#7) → PH/ID/VN (#8/9/10) | 18–36mo |
| **Japanese students / dual-residents in the US ↔ JP** | US ↔ JP | The beachhead itself; high-trust digital flow, weak incumbent presence | US (#5) ↔ JP (#6) | 6–18mo |
| **Nigerian diaspora in US / UK → NG families** | US/UK → NG | Lights up the **already-live NG rail** from the receive side; proves diaspora-`@handle` seeding on a corridor that exists today | US (#5) → NG (#1) | Now / 0–6mo (validate) |
| **African diaspora in US → KE / GH / ZA** | US → KE / GH / ZA | Extends the proven US→NG pattern across the African family as payout rails come online | US (#5) → KE/GH/ZA (#2/3/4) | 18–36mo |

**Seeding mechanics:** each pair is a *directed, one-sided* flow (diaspora-out; receive-side float drains and never refills organically — the §6 float warning). Seed where the corridor is *locally complete* (both communities present, no domestic-wallet substitute), make receive zero-friction, and let `@handle`-to-`@handle` internal transfers settle off-chain (debit row + credit row, zero on-chain tx, §3) so the network compounds at zero marginal cost while cross-boundary value still rides the USDC net-settlement rail.

---

## 5. ASCII Corridor Map

```
                              TALISE CORRIDOR MAP
                  ( settlement spine: USDC / USDsui on Sui — invisible )

        AFRICAN FAMILY                                  ASIAN / GLOBAL FAMILY
   FX is the product                             parity + speed + @handle, FX hidden

   ┌────────────┐  live                                          ┌────────────┐
   │  NG / NGN  │◀───────────────┐                  ┌───────────▶│  JP / JPY  │ partner
   │ Stripe→Paga│                │                  │  beachhead │ Zengin/JPYC│ ¥1M cap
   └────────────┘                │   ┌──────────┐   │   US ↔ JP  └────────────┘
                                 └──▶│          │◀──┘                  │
   ┌────────────┐ planned            │ US / USD │                      │ JP→PH / JP→VN
   │  KE / KES  │◀────────────────┐  │ ACH/FedNow│                     ▼   (18–36mo)
   │  M-Pesa    │                 └─▶│  (hub +   │   ┌──────────┐  ┌────────────┐
   └────────────┘                    │  payout)  │   │ SG / SGD │  │  PH / PHP  │ planned
                                 ┌───▶│  partner  │   │ PayNow   │  │ InstaPay   │
   ┌────────────┐ planned        │    └────┬─────┘   │ MPI=ANCHOR│ └────────────┘
   │  GH / GHS  │◀───────────────┤         │         └────┬─────┘  ┌────────────┐
   │  MTN MoMo  │                 │        │   diaspora    │       │  ID / IDR  │ planned
   └────────────┘                 │        │   @handle     │  SG→  │  BI-FAST   │
                                  │        │   seeding     │ ASEAN └────────────┘
   ┌────────────┐ planned         │        │               │ payout ┌────────────┐
   │  ZA / ZAR  │◀────────────────┘        ▼               └───────▶│  VN / VND  │ planned
   │  EFT/RTC   │                  African diaspora                  │  NAPAS     │
   └────────────┘                  in US/UK → NG/KE/GH/ZA            └────────────┘

   ┌──────────────────────────────────────────────────────────────────────────────┐
   │  ✗ KR / KRW — DROPPED. Real-name bank-account wall, post-Terra-hardened,       │
   │    un-enterable for a foreign startup 2+ yr. Re-evaluate post-Series-A only.   │
   └──────────────────────────────────────────────────────────────────────────────┘

   Legend:  live = in production today   ·   partner = launch as agent of a licensee
            planned = architected, not contracted   ·   ✗ = removed from the plan
   Spine:   every cross-currency hop = USDC/USDsui net-settle between Talise float
            pools on Sui (~1s), off the user's critical path. Float pre-positioned
            on BOTH ends is what makes it "feel instant" — not chain finality.
```

---

## 6. Phase Summary (corridors by launch window)

Cross-referenced to the master plan's phased roadmap (§10).

| Phase | Window | Corridors going live | Gating prerequisite |
|---|---|---|---|
| **P0 — harden + foundation** | Now / 0–6mo | **NG** (re-proven on new compliance stack); incorporate **SG**, begin MPI filing | KYC tier engine + tiered limits + pre-broadcast sanctions/address screening; **live executable FX feed**; generalized `transfers` state machine; add JPY/SGD/PHP/IDR/VND to `Currency` type |
| **P1 — anchor + beachhead** | 6–18mo | **SG** (via PSP partner, then MPI), **US** + **JP** (US→JP beachhead, bank-funded, <¥1M) | MAS MPI live or PSP-bridged; US true-agent partner signed; named compliance officer; float as venture debt (~$1–2M, ONE corridor) |
| **P2 — second corridor + scale** | 18–36mo | **PH / ID / VN** (SG→ASEAN payout); **KE / GH / ZA** (African expansion); JP Type-1/EPIBP unlocks >¥1M B2B | SG MPI reused; JP subsidiary + FSA Type-1 in progress; B2B becomes primary P&L |
| **Deferred** | Post-Series-A | **KR** — only if Digital Asset Basic Act is law AND a banking sponsor is in hand | A willing licensed Korean exchange to be merchant-of-record — does not exist today |

---

## 7. What This Changes in the Codebase (additive pointers, not a build task)

This document is strategy, not implementation. But the matrix above implies concrete, **additive** foundations the master plan already sequences as P0 (§11) — recorded here so the corridor matrix and the build stay in lockstep:

- **`web/lib/fx.ts`** — extend `type Currency` with `JPY | SGD | PHP | IDR | VND` (and keep KRW out), backed by a live executable feed, per-corridor volatility-based spread, and a max-age circuit breaker. The current hardcoded Q2-2026 snapshot is toy-volume-only.
- **`web/app/api/offramp/paga/`** — the `quote → debited → remitting → settled` state machine is the **template**; generalize it into a corridor-agnostic `transfers` machine (`quoted → debited → onchain_settling → onchain_settled → fiat_out_pending → settled`) so every corridor above plugs into one interface (the `offramp_payouts.provider` pattern).
- **Compliance (P0 blocker, §7):** `users.kyc_tier` + `/api/kyc` + tiered limit enforcement in the send path + pre-broadcast sanctions/address screening — none exist today, and every "partner" status in the matrix is contingent on them.

---

*Grounded in [cross-border-masterplan.md](./cross-border-masterplan.md) (§2 beachhead, §3 architecture, §5 licensing sequence, §6 economics/caps, §7 compliance, §8 `@handle` cold-start, §10 roadmap) and the codebase at commit 1757484 (`web/lib/fx.ts`, `web/app/api/offramp/paga/`).*
