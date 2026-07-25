# Off-ramp (fiat-out) provider architecture, failover, and the second-corridor plan

**Status:** seam implemented, cash-out still gated CLOSED.
**Scope:** `web/lib/offramp/**`, `web/lib/linq.ts`, `web/lib/bridge/**` (off-ramp side), `web/app/api/offramp/**`.
**Date:** 2026-07-25

> Lives here rather than `docs/strategy/` because `/docs/` is gitignored in this
> repo; a copy is written to `docs/strategy/offramp-provider-failover.md` locally.

---

## 1. Where we actually were

An honest reading of the payout path before this work:

| Fact | Consequence |
| --- | --- |
| Exactly **one** real fiat-out rail exists in the world: Linq, NGN. | Any Linq incident is a **100% corridor outage**. |
| Linq's hostname was a **literal** in `lib/linq.ts`, a free-tier PaaS host. | The endpoint of a real-money rail could only be moved by a code deploy. No SLA behind it. |
| `lib/offramp/registry.ts` mapped `currency → ONE adapter`, and every non-NGN adapter was a **mock** returning `pending` forever. | The registry could not express primary/fallback, and any caller wiring it up would tell users a payout was in progress that no partner had ever heard of. |
| `FEATURE_CASHOUT` opened the rail unless the value was literally `"false"`. | The gate existed **because the provider was 500-ing without refunding**, yet an unset/misspelled/migration-lost variable silently re-opened it. |
| Nothing recorded whether the user's on-chain deposit ever landed. | After a provider failure we could not answer "did this user part with their money?" — the only question that matters for a refund. |
| Status was written by unconditional `UPDATE`, from two racing writers (webhook + poll), with no replay protection. | A replayed `processing` event could walk a **settled** payout backwards. |
| Nothing reconciled non-terminal rows. | Orders sat `initiated` forever: the $200/day cap leaked, and stranded users were invisible. |
| Bridge's off-ramp webhook was `console.log` behind a `TODO(persist)`. | The USD/EUR rail had **no terminal state anywhere** in Talise. |
| `checkDailyOfframpCap` summed `linq_offramps` only. | The Bridge USD cash-out consumed **no** daily allowance. A cap that looks enforced but is not is worse than no cap. |

What *was* genuinely production-grade: Linq webhook HMAC verification (fails closed on a missing secret), Bridge webhook RSA verification with a timestamp-skew window, the coin-type guard before revealing a deposit address, `refundAddress` on every order, the daily-cap concept, the app-allowlist guardrail on value-moving calls, and `lib/transfers.ts`' commit-point / parked-funds state machine (correct, but not yet wired to this path).

---

## 2. The seam: corridor → ordered providers

```
                 ┌───────────────────────────────────────────┐
   route  ──────►│  registry.resolvePayoutCorridor(ccy)      │
                 │    corridorProviderOrder(ccy)  [config]   │
                 │      → [primary, fallback, …]             │
                 └──────────────┬────────────────────────────┘
                                │  per candidate, in order
                    ┌───────────▼────────────┐
                    │ 1. registered?         │
                    │ 2. live (not a stub)?  │
                    │ 3. configured()?       │
                    │ 4. breaker allows?     │  ◄── shared, DB-backed
                    └───────────┬────────────┘
                                │ first usable wins
                          ┌─────▼──────┐
                          │  selected  │  else → degraded (503 + reasons)
                          └────────────┘
```

* **`config.ts`** owns routing. `OFFRAMP_PROVIDERS_<CCY>="a,b"` overrides the built-in order, so failing a corridor over (or draining it to none) is an env change, **not a deploy**.
* **`provider.ts`** owns the `PayoutProvider` contract and `submitPayout()` — idempotent submission with failover.
* **`breaker.ts`** owns health. State lives in Postgres, not per-process: serverless runs many instances, and a per-process counter means instance A notices the outage while instance B keeps stranding users.
* **`registry.ts`** is now the router. Stub corridors are registered but `live: false`, so they are *visible* in diagnostics and *unselectable* in production.

### Failover semantics

| Failure | Behaviour | Why |
| --- | --- | --- |
| Provider-side (5xx, timeout, non-JSON, 408/429) | Counts against health; try next provider in order | The rail is broken; another rail might not be |
| Request-side (4xx: bad NUBAN, over-limit) | **No failover**, release the idempotency claim, 422 | Every provider will reject it too; retrying just spams the corridor. It also must not trip the breaker, or one typo takes a corridor offline |
| Circuit OPEN | Candidate skipped, corridor degrades to the next one | Refusing before the user sends is the only failure that costs nobody money |
| All candidates unusable | 503 `CORRIDOR_DEGRADED` with per-candidate reasons | An operator should never have to guess from a 502 |

### Circuit breaker

`closed → (3 consecutive provider-side failures) → open → (120s cooldown) → half_open → (1 success) → closed`

* Exactly one instance wins the half-open probe (`UPDATE … WHERE state='open'`), so a cooldown expiry does not become a thundering herd at a rail we believe is dead.
* A failed probe **re-stamps** `opened_at`, restarting the cooldown.
* A clean 4xx counts as a *success* for health: it proves the rail is up, and without this a corridor full of typo'd account numbers could never close a half-open circuit.
* The breaker **fails open on its own errors**. If the health table is unreachable we allow the call. The money-safety guarantees do not depend on the breaker (they come from idempotency + reconciliation), so it must never become a new single point of failure.
* Tunable: `OFFRAMP_BREAKER_FAILURES`, `OFFRAMP_BREAKER_COOLDOWN_MS`, `OFFRAMP_BREAKER_PROBE_SUCCESSES`, `OFFRAMP_BREAKER_CACHE_TTL_MS`.

The breaker sits at the **transport** layer (`linqFetch`), so the live `app/api/offramp/linq/*` routes are gated without a route-by-route retrofit anyone could forget.

---

## 3. Money-safety model

Four invariants, each with a mechanism:

1. **Idempotent submission.** `Idempotency-Key` header (or `idempotencyKey` body field) → claimed atomically in `offramp_intents` via `INSERT … ON CONFLICT DO NOTHING`, and passed through as the *provider's* idempotency key. A retry after a timeout replays the original order; it cannot mint a second deposit address the client might also fund. With no client key we fall back to a ~2-minute intent fingerprint, which covers realistic retries without collapsing a deliberate repeat payment. **iOS/CLI should send an explicit key.**

2. **Fail closed on persistence.** If the provider order exists but we cannot record it, we **refuse to reveal the deposit address**. No address → no funds moved → nothing to unwind.

3. **Terminal-state reconciliation.** `POST /api/offramp/reconcile` asks the provider for the truth on every non-terminal row past the deposit window, applies it monotonically, **expires** never-funded orders (returning the user's daily allowance) and escalates **funded-but-unsettled** payouts as `stranded` + refund-owed.

4. **Monotonic status.** Terminal states are sticky, with one deliberate exception: `failed → completed` is allowed, because if the money really landed we must never keep telling the user it failed. `completed → failed` is refused.

The pivotal new fact is **funded-ness**. `POST /api/offramp/linq/deposit` records the on-chain digest of the deposit, which is what lets reconciliation distinguish *abandoned* (expire, free the cap) from *stranded* (the user is out the money, a refund is owed). Without it those two are indistinguishable — which is exactly why the Linq incident was invisible.

### Tables owned by this layer (`store.ts`, `ensureOfframpProviderSchema()`)

| Table | Purpose |
| --- | --- |
| `offramp_provider_health` | Shared circuit-breaker state, one row per provider |
| `offramp_intents` | Idempotency claims + the stored response to replay |
| `offramp_attempts` | Cross-rail attempt ledger: funded flag, terminal state, refund-owed flag |
| `offramp_provider_events` | Inbound webhook dedupe (replay protection) + audit |

---

## 4. A real second provider: the sequenced plan

**Bridge is not the answer for Nigeria.** Bridge does not pay out NGN; encoding it as an NGN fallback would be a lie that fails at the worst possible moment. Bridge *is* registered as a live provider for USD/EUR, which proves the seam takes a real second implementation and gives those corridors a genuine rail.

Nigeria's second provider is a **commercial** decision. The engineering is now ~1 file.

### Phase 0 — before signing anything (done)
- [x] Provider seam with primary/fallback ordering, config-driven.
- [x] Shared circuit breaker + `GET /api/offramp/health` operator view.
- [x] Idempotency, fail-closed persistence, reconciliation, refund queue.
- [x] Cross-rail attempt ledger so a new rail is capped and observable on day one.

### Phase 1 — commercial (weeks, not code)
Shortlist Nigerian payout partners with a **contracted endpoint and an SLA** (not a PaaS hostname). Evaluate on: NUBAN name-enquiry, per-transaction and daily limits, settlement windows, **auto-refund on failed payout** (the single most important term — the last incident's damage was entirely "no auto-refund"), webhook signing scheme, idempotency-key support and its retention window, and sandbox availability. Candidate categories: a licensed Nigerian PSP/switch directly, a pan-African payout aggregator, or a global payout network with an NGN leg.

### Phase 2 — implement (1 file + config)
1. Add the id to `ProviderId` and `LIVE_PROVIDER_IDS` in `config.ts`.
2. Write `lib/offramp/<partner>-provider.ts` implementing `PayoutProvider`: `configured()` returning a *reason*, `quote`, `initiatePayout` (honouring `idempotencyKey`), `status`. Translate the partner's HTTP errors through `providerErrorForStatus()` so 4xx/5xx are classified correctly.
3. Register it in `registerAllProviders()`.
4. Add a webhook route under `app/api/offramp/<partner>/webhook` that verifies signatures over the **raw** body, dedupes via `recordProviderEvent`, and settles through `settleAttempt`.
5. Extend `reconcile.ts` with the partner's status poll.

### Phase 3 — shadow, then promote
1. `OFFRAMP_PROVIDERS_NGN="linq"` (unchanged) while the new provider runs in sandbox.
2. Promote to fallback: `OFFRAMP_PROVIDERS_NGN="linq,<partner>"`. Linq stays primary; the breaker now has somewhere to fail over to. **This is the moment the 100% corridor outage risk ends.**
3. Once the fallback has proven itself on real volume, flip the order: `OFFRAMP_PROVIDERS_NGN="<partner>,linq"`. No deploy.

### Phase 4 — a refund path Talise controls
Today a failed Linq payout depends on **Linq's** `refundAddress` sweep — precisely what did not happen in the incident. The refund queue (`GET /api/offramp/reconcile`) currently *identifies* who is owed; paying them is manual. Wire it to a treasury compensating action (`lib/offramp-refund.ts` still holds `treasurySendUsdsui`) so a stranded payout becomes an automatic make-whole, with `lib/transfers.ts`' `refund` transition as the ledger record.

### Phase 5 — retire the last hardcoded assumptions
`OFFRAMP_MAX_USD` and the spread are still constants. Move to per-corridor, per-provider config once a second provider exists, so limits can differ by rail.

---

## 5. Configuration to set (nothing has been set for you)

**Required before the NGN rail can work at all** (it now refuses rather than falling back to a hostname baked into the code):

| Variable | Value | Notes |
| --- | --- | --- |
| `LINQ_BASE_URL` | Linq's API base URL | **NEW REQUIREMENT.** No default any more. Must be https in production. A free-tier host (`*.koyeb.app`, `*.onrender.com`, …) logs a loud warning — get a contracted endpoint. |
| `LINQ_API_KEY` | `biz_live_…` | Unchanged. |
| `LINQ_WEBHOOK_SECRET` | `whsec_…` | Now **required** for readiness: without it settlement callbacks are unverifiable and the corridor runs blind. |
| `CRON_SECRET` | random | Gates `/api/offramp/reconcile` and `/api/offramp/health`. Fails closed. |

**Leave cash-out closed.** `FEATURE_CASHOUT` now fails **closed**: the rail is open only on an explicit `true`/`1`/`yes`/`on`. Do **not** set it until Linq confirms the `nomba` provider is fixed *and* a fallback exists.

**Optional / tuning:**

| Variable | Default | Purpose |
| --- | --- | --- |
| `OFFRAMP_PROVIDERS_<CCY>` | built-in order | Comma-ordered provider ids. The failover switch. |
| `OFFRAMP_PROVIDER_DISABLED` | — | Comma list of provider ids to hard-disable during an incident. |
| `OFFRAMP_BREAKER_FAILURES` | `3` | Consecutive provider-side failures that trip the circuit. |
| `OFFRAMP_BREAKER_COOLDOWN_MS` | `120000` | How long OPEN lasts before a single probe. |
| `OFFRAMP_STRANDED_AFTER_MS` | `21600000` (6h) | Age at which a funded, unsettled payout is escalated. |
| `OFFRAMP_ALLOW_STUBS` | off | Dev only; **ignored in production** by design. |
| `BRIDGE_WEBHOOK_PUBKEY` | — | Already needed; the Bridge provider now reports itself **unconfigured** without it, because unverifiable settlement events mean unobservable payouts. |

**Recommended cron** (Vercel `vercel.json`): `POST /api/offramp/reconcile` every 10 minutes. Not required for correctness — any caller with `CRON_SECRET` works — but it is what turns "invisible stranding" into an alert.

---

## 6. Client work still owed (iOS / CLI)

1. **Send `Idempotency-Key`** on `POST /api/offramp/linq/create` and `/to-user`. Reuse the same value across retries of one user intent. Until then the server falls back to a 2-minute intent fingerprint.
2. **Call `POST /api/offramp/linq/deposit`** with `{ orderId, digest }` immediately after the sponsored deposit send lands. This is what makes a stranded user visible and refundable.
3. **Handle `503 CORRIDOR_DEGRADED`** distinctly from a generic error: show "temporarily unavailable, your balance is untouched" and do **not** retry immediately.
4. **Handle `409 DUPLICATE_IN_FLIGHT`**: an identical cash-out is already being processed; poll instead of resubmitting.
5. Read `providerReachable` from the status poll so "we can't reach the bank rail" is not rendered as "your payout is stuck".

---

## 7. Known remaining gaps (deliberately not closed here)

* **`POST /api/agent/cashout/prepare`** is a third Linq-order creation path and lives outside this workstream's file scope. It still uses a random per-attempt idempotency key and its own copy of the create sequence. It should be switched to `beginLinqOrder()` — a small change that inherits idempotency, the all-rails cap, fail-closed persistence and the ledger.
* **Refund execution is manual.** The queue identifies who is owed; Phase 4 above automates paying them.
* **`lib/transfers.ts` is not wired to this path.** The NGN rail still tracks state in `linq_offramps`. The state machine's commit-point / parked-funds semantics are the right long-term home; `LINQ_STATE_MAP` already documents the projection.
* **Bridge one-off payouts** (`bridgeProvider.initiatePayout`) need the caller to attach Bridge customer/external-account ids; the live Bridge cash-out UX is address-based and does not use that path yet.
* **Linq has no server-side quote lock.** The rate is locked only at order creation, so `/quote` is display-only. That is Linq's model, not ours to fix.
