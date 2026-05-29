# Paga Offramp Integration Plan

Status: design only. No production code in this document. Targets the existing
`BankWithdrawView` stub inside `WithdrawFlowView` (`ios/Talise/Features/Withdraw/`)
which already says "Coming soon" on Continue.

---

## Public partnership (sourced)

The Paga ↔ Sui partnership was announced on **2026-05-08** at Sui Live in Miami,
coinciding with the launch of **USDsui**, Sui's yield-bearing USD stablecoin
issued by **Bridge** (the Stripe-owned stablecoin orchestrator) on the Sui
blockchain.

Headline scope per the public reporting:

- Paga will integrate **Sui Dollar (USDsui)** into its enterprise API and
  consumer app for direct dollar-denominated settlement.
- Crypto **on-ramps and off-ramps** across Paga's operating markets.
- **High-yield USD accounts** backed by USDsui.
- **Tokenized RWAs** (real estate, bonds, solar projects) on Sui rails.
- Both Paga and Sui are admitted to the **CBN VASP supervisory programme**
  (Nigeria's AML sandbox for virtual asset service providers).

Reach context (matters for our underwriting):
- Paga processes ~**$1.5B/month** and reported **$11B / 169M tx in 2025**.
- Paga has publicly explored Mexico and Ethiopia previously, but production
  payout coverage today is **Nigeria-first**. No public confirmation of
  Ghana / Sierra Leone / Mexico payout endpoints as of May 2026.

What the announcement does **not** say:
- It does not promise a public USDsui → NGN settlement API for third parties.
- It does not name Talise (we are not in the launch cohort).
- It does not commit a timeline or SLA for the offramp surface.

Sources are listed at the bottom of this document.

---

## Paga API surface (what is actually public today)

Paga **does have a public Business REST API** with real, documented endpoints.
This is unusually good for an African fintech — most peers (Onafriq, Maplerad
business tier, Fonbnk) are gated behind BD.

### Environments

```
Sandbox:    https://beta.mypaga.com/
Production: https://www.mypaga.com/
Base path:  /paga-webservices/business-rest/secured/<operation>
```

### Auth

Three credentials, fetched from the Paga Business dashboard under
Developer Tools → API Keys:

| Header        | Description                              |
| ------------- | ---------------------------------------- |
| `principal`   | Public key / Merchant ID                 |
| `credentials` | Secret key                               |
| `hash`        | SHA-512 HMAC over ordered request fields |

Hash construction = concatenate specific request fields in a fixed,
endpoint-defined order, then HMAC-SHA512 with `hashKey`. Documented field order
is published per endpoint.

### Endpoints we need

| Operation                | Path                       | Why                                  |
| ------------------------ | -------------------------- | ------------------------------------ |
| `getBanks`               | `/getBanks`                | Bank list + `bankUUID` for dropdown  |
| `validateDepositToBank`  | `/validateDepositToBank`   | Pre-flight: account holder name, fee |
| `depositToBank`          | `/depositToBank`           | The actual NGN payout to bank        |
| `transactionStatus`      | `/transactionStatus`       | Status within 48h window             |
| `getOperationStatus`     | `/getOperationStatus`      | Idempotent re-query by `referenceNumber` |
| `accountBalance`         | `/accountBalance`          | Float monitoring                     |
| `moneyTransferBulk`      | `/moneyTransferBulk`       | Future: batch payouts (up to 300/req)|

### Concrete request shape — `depositToBank`

```
POST /paga-webservices/business-rest/secured/depositToBank
Headers: principal, credentials, hash, Content-Type: application/json

{
  "referenceNumber": "<our-uuid-v4>",
  "amount": "12500.00",
  "currency": "NGN",
  "destinationBankUUID": "<from getBanks>",
  "destinationBankAccountNumber": "0123456789",
  "remarks": "Talise withdraw",
  "statusCallbackUrl": "https://api.talise.app/api/offramp/paga/webhook"
}
```

Hash order: `referenceNumber | amount | destinationBankUUID | destinationBankAccountNumber`

Response (happy path):

```
{
  "responseCode": 0,
  "message": "...",
  "transactionId": "...",
  "fee": 25.00,
  "vat": 1.88,
  "destinationAccountHolderNameAtBank": "EROMONSELE ODIGIE",
  "sessionId": "..."
}
```

### Coverage

- **Nigeria**: all NIBSS-reachable banks, NGN settlement.
- **Other countries**: not part of this public API surface as of May 2026.
- Paga has previously discussed Mexico / Ethiopia, but those are **not**
  documented destinations in the `depositToBank` endpoint.

### Limits (consumer-side, since business-API limits are not public)

- KYC 1: ₦50,000/day
- KYC 2: ₦200,000/day
- KYC 3: ₦5,000,000/day

Business API limits are negotiated with BD and not published.

### Settlement timing

`depositToBank` is realtime via NIBSS NIP. Practical expectation: 1–60s
end-to-end when both sides are healthy. We must still treat it as async because
NIBSS occasionally queues.

---

## Settlement path

We have three plausible routes. The decision changes whether we need a Paga BD
relationship, a Bridge BD relationship, or both.

### Option A — Talise holds NGN float, swaps USDC off-platform

1. User signs a Sui tx burning `X USDsui` from their custody address to Talise
   treasury.
2. Backend marks the payout `funded`.
3. Backend calls Paga `depositToBank` from a pre-funded NGN merchant wallet.
4. Treasury rebalances offline by swapping USDC → NGN through Yellow Card /
   Maplerad / OTC at a slower cadence.

Pros: simplest integration. No Bridge dependency. Works on day one.
Cons: we carry FX risk and float cost. Requires ~₦50–100M working float to
hit reasonable volume.

### Option B — Burn USDsui through Bridge → USD → Paga

1. User burns USDsui via Bridge redemption API.
2. Bridge wires USD to a Paga-controlled USD account (per the announced
   partnership).
3. Paga settles NGN to user's bank.

Pros: matches the announced Paga ↔ Sui design. No float on our side.
Cons: requires us to be inside the Paga + Bridge integration — neither
exposes this to third parties today. **Blocking on BD on both sides.**

### Option C — Burn USDsui locally, deliver USDC to Paga, Paga settles NGN

1. User burns USDsui, we mint/transfer USDC on Sui (or bridged) to a Paga
   custody address.
2. Paga's own stablecoin desk (via Nuvei / Circle) converts and settles NGN.

Pros: lighter BD ask than B (just stablecoin acceptance).
Cons: still needs Paga BD to accept USDC inflows from us as a counterparty,
and Paga has not publicly opened this endpoint.

**Recommendation: ship A first**, design the DB and webhook surface so B is a
drop-in replacement when Paga BD opens that door. This is the only path that
does not block on a partnership we don't yet have.

---

## Integration design

Designing only — no code in this doc, no edits outside `docs/offramp/`.

### Web routes (Next.js, `web/app/api/offramp/...`)

| Route                                    | Method | Purpose                                  |
| ---------------------------------------- | ------ | ---------------------------------------- |
| `/api/offramp/bank/banks`                | GET    | Proxied `getBanks`, 24h cache            |
| `/api/offramp/bank/resolve`              | POST   | Wraps `validateDepositToBank` (name lookup) |
| `/api/offramp/bank/quote`                | POST   | Returns NGN amount, fee, FX rate, expires_at |
| `/api/offramp/bank/initiate`             | POST   | Locks quote, creates payout row, returns Sui tx to sign |
| `/api/offramp/bank/confirm`              | POST   | Submits signed tx, calls Paga `depositToBank` |
| `/api/offramp/bank/status?ref=...`       | GET    | Reads DB; falls back to `getOperationStatus` |
| `/api/offramp/paga/webhook`              | POST   | Paga `statusCallbackUrl` receiver        |

### Quote contract (sketch)

```
POST /api/offramp/bank/quote
{ "amountUsdsui": "25.00" }
->
{
  "quoteId": "qt_...",
  "rate": 1612.50,
  "amountNgn": "40312.50",
  "feeNgn": "25.00",
  "vatNgn": "1.88",
  "netNgn": "40285.62",
  "expiresAt": "2026-05-28T14:32:00Z"   // 90s lock
}
```

### DB tables

```
offramp_payouts (
  id              uuid pk,
  user_id         uuid,
  reference       text unique,        -- our referenceNumber sent to Paga
  status          text,               -- pending|funded|sent|settled|failed|refunded
  amount_usdsui   numeric(20,8),
  amount_ngn      numeric(20,2),
  rate            numeric(20,8),
  fee_ngn         numeric(20,2),
  vat_ngn         numeric(20,2),
  bank_uuid       text,
  bank_acct       text,
  bank_acct_name  text,
  sui_tx_digest   text,
  paga_tx_id      text,
  paga_session_id text,
  provider        text default 'paga',
  created_at      timestamptz,
  funded_at       timestamptz,
  settled_at      timestamptz,
  failed_at       timestamptz,
  failure_reason  text
);

offramp_webhook_events (
  id              uuid pk,
  provider        text,
  payload         jsonb,
  signature_ok    bool,
  payout_id       uuid references offramp_payouts(id),
  received_at     timestamptz
);

offramp_fx_quotes (
  id              uuid pk,
  user_id         uuid,
  reference       text unique,
  rate            numeric,
  amount_usdsui   numeric,
  amount_ngn      numeric,
  expires_at      timestamptz,
  consumed        bool default false
);
```

### Webhook handler

`POST /api/offramp/paga/webhook` MUST:

1. Read raw body (do not parse before signing).
2. Recompute HMAC-SHA512 over the documented field order using our stored
   `hashKey`.
3. Compare constant-time against the inbound `hash` header.
4. Look up `offramp_payouts.reference`. If missing, 404.
5. Update status idempotently: only transition forward
   (`pending → funded → sent → settled`).
6. Insert into `offramp_webhook_events` regardless of success.
7. Return 200 only after DB commit.

### State machine

```
pending  -> funded     (user's Sui burn tx confirmed)
funded   -> sent       (depositToBank returned responseCode 0)
sent     -> settled    (webhook says CREDITED)
sent     -> failed     (webhook says FAILED) -> trigger refund job
funded   -> failed     (Paga rejected) -> refund USDsui to user
```

### iOS wiring

`BankWithdrawView.submit()` (already exists, currently a stub) calls:

1. `POST /api/offramp/bank/resolve` once account number reaches 10 digits
   (debounced 500ms). Display resolved name inline.
2. `POST /api/offramp/bank/quote` on amount blur or 800ms idle. Show
   "1 USDsui ≈ ₦1,612.50" and net NGN. Lock for 90s with a countdown ring.
3. On Continue: `POST /api/offramp/bank/initiate` → backend returns either
   (a) a ready-to-sign Sui PTB blob, or (b) for sponsored-tx mode a transaction
   digest after sponsor co-signs.
4. iOS signs and posts back to `/api/offramp/bank/confirm`.
5. Poll `/api/offramp/bank/status` until `settled` or `failed`. Show success
   screen with last-4 of bank account and net NGN.

No iOS edits in this phase — the SwiftUI surface already exists, only the
network layer is missing.

---

## Geographic coverage

| Country       | Paga payout supported?         | Plan                       |
| ------------- | ------------------------------ | -------------------------- |
| Nigeria       | Yes, all NIBSS banks           | Ship via Paga              |
| Ghana         | Not in public API              | Plan B (Korapay / Yellow Card) |
| Sierra Leone  | Not in public API              | Plan B (Yellow Card)       |
| Mexico        | Paga has discussed expansion, no public payout API | Plan B (Bitso / Conduit) |
| Kenya / Ethiopia | Not in public API           | Plan B (Onafriq / Fonbnk)  |

Treating Paga as the **Nigeria specialist** is the correct framing. Other
corridors should be routed through a different provider behind the same
`/api/offramp/bank/*` interface; the `provider` column on `offramp_payouts`
already supports this.

---

## Risk + compliance

- **KYC**: Paga's consumer tiers are well-known. For the business API, Paga
  requires the merchant (us) to be KYB'd, and the **endpoint requires a verified
  bank account number** — we should still gate at our layer with a minimum of
  BVN-equivalent verification on the Talise user before allowing offramp.
- **Sanctions / OFAC**: Paga screens its end of the wire, but we still need our
  own screening on the user side (name + bank acct holder name). Hook into
  Sumsub / ComplyAdvantage at the `initiate` step.
- **CBN VASP supervisory programme**: both Paga and Sui are admitted; this is a
  regulatory tailwind, not a license for Talise. We are still operating as a
  software interface to a licensed VASP (Paga). Document this clearly in T&Cs.
- **Transaction limits**: cap per-tx at ₦1,000,000 day-one; per-user-per-day at
  ₦2,000,000. Aligned with KYC 2 ceiling, leaves room for tier-1 users without
  exposing us to Paga limit-rejection at runtime.
- **Float risk (Option A)**: NGN treasury devaluation. Mitigate by rebalancing
  daily through Yellow Card OTC and holding only ~2x daily-volume float.
- **Idempotency**: every call to `depositToBank` uses a deterministic
  `referenceNumber` derived from `payout.id`. Retries are safe.

---

## Open questions (need answers from Paga BD before launch)

1. Does Paga's business API expose a **direct USDsui → NGN** endpoint as part
   of the Sui partnership, or is that strictly internal to Paga's consumer app?
2. What are the business-tier daily / monthly limits and the underwriting
   process to raise them?
3. What is the **fee schedule** for `depositToBank` at our projected volume?
4. Does Paga issue a **dedicated NGN merchant float account** we can top up via
   Bridge USD wires (Option B), and what is the cutoff time?
5. Is there a **production webhook signature scheme** beyond the SHA-512 hash
   on requests? (The docs are clearer on request hashing than callback
   verification.)
6. What is the **chargeback / refund** path if Paga settles to the wrong
   account and we have already burned the user's USDsui?
7. SLA / uptime commitment for `depositToBank` and the webhook delivery.
8. Are non-Nigeria corridors (Mexico, Ethiopia, Ghana) on the roadmap, and on
   what timeline?

---

## Implementation phases

### Phase 1 — Sandbox proof of concept (1–2 days)

- Provision Paga sandbox credentials (self-serve at business.paga.com).
- Build a single Next.js route `/api/offramp/bank/_sandbox` that wraps
  `getBanks`, `validateDepositToBank`, `depositToBank` against
  `beta.mypaga.com`.
- Manual curl + small CLI driver to confirm hash construction works.
- No DB, no iOS wiring yet. Deliverable: a logged successful sandbox payout
  reference number.

### Phase 2 — Testnet → mainnet promo (3–5 days)

- Add `offramp_payouts` and `offramp_webhook_events` tables.
- Implement `/api/offramp/bank/{banks,resolve,quote,initiate,confirm,status}`
  end-to-end, using a **dummy FX feed** (e.g., +1.5% over a CoinGecko USD/NGN
  benchmark).
- Wire `BankWithdrawView.submit()` to call `initiate` and `confirm`.
- Webhook receiver + signature check.
- Cap at ₦50,000 / user / day. Hidden behind a feature flag for ~20 internal
  testers.
- Treasury runs **Option A** with a 2M NGN float, manually rebalanced.

### Phase 3 — Talise prod gate (1–2 weeks)

- KYC integration (Sumsub) gating `initiate`.
- OFAC + sanctions check on bank acct holder name.
- Automated FX feed (Yellow Card price API as primary, Maplerad as fallback).
- Treasury auto-rebalance via Yellow Card OTC.
- Monitoring dashboard: pending payouts, settlement latency p50/p95,
  failure rate, float burndown.
- Begin Paga BD conversation in parallel for Option B migration when
  contractually available.

---

## Backup providers

In rank order of "could ship this week":

1. **Yellow Card Payments API** — `docs.yellowcard.engineering`. Public docs,
   stablecoin-in / NGN-out, 20+ African countries, Visa partnership for rails.
   The strongest Plan B and arguably the strongest Plan A for non-Nigeria
   corridors.
2. **Korapay** — Nigerian payout API, well-documented, NGN payouts to bank
   accounts. Less stablecoin-native than Yellow Card but a clean payout rail.
3. **Maplerad** — Pan-African (Nigeria, Ghana, Kenya, USD virtual cards). Has a
   developer API with business onboarding required.
4. **Onafriq (ex-MFS Africa)** — broadest African reach (40+ countries, mobile
   money networks), but gated behind BD. Use when expanding beyond banking
   rails into MoMo.
5. **Fonbnk** — primarily cash-in / airtime ↔ crypto, useful for the inverse
   flow more than NGN bank payouts. Keep in pocket.

The `provider` column on `offramp_payouts` plus the `/api/offramp/bank/*`
interface is deliberately provider-agnostic: swapping Paga for Yellow Card is a
service-layer change, not a contract change for iOS or DB.

---

## Sources

- Sui blog: USDsui announcement (Bridge-issued, May 2026) —
  https://blog.sui.io/sui-unveils-usdsui-native-stablecoin/
- Cryptonomist: Paga–Sui partnership ($1.5B/month context) —
  https://en.cryptonomist.ch/2026/05/08/paga-sui-partnership/
- Nairametrics: Paga bets on stablecoins with Sui —
  https://nairametrics.com/2026/05/07/paga-bets-on-stablecoins-to-break-africas-payment-barriers-with-sui/
- Technology Times NG: Paga partners Sui to launch stablecoin payment services —
  https://technologytimes.ng/paga-partners-sui-blockchain-launch-stablecoin/
- Tekedia: Paga and Sui strategic partnership —
  https://www.tekedia.com/paga-and-sui-forge-strategic-partnership-to-advance-blockchain-powered-financial-infrastructure-in-africa/
- Paga developer docs — overview —
  https://developer-docs.paga.com/docs/overview-1
- Paga developer docs — money transfer payout —
  https://developer-docs.paga.com/docs/money-transfer-payout
- Paga developer docs — business REST API operations —
  https://developer-docs.paga.com/docs/business-rest-api-operations
- Paga developer docs — getting started / API keys —
  https://developer-docs.paga.com/docs/introduction
- Paga consumer daily limits (Freshdesk) —
  https://mypaga.freshdesk.com/support/solutions/articles/35000067843-what-are-my-daily-limits-for-transactions-on-paga-
- Yellow Card API —
  https://docs.yellowcard.engineering/
- The Africa Report: Yellow Card / Flutterwave / Onafriq on stablecoins —
  https://www.theafricareport.com/388394/yellow-card-flutterwave-onafriq-why-africas-fintech-sector-is-turning-to-stablecoins/
