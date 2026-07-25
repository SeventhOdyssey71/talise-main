# Fiat on-ramp (bank funding)

How a user with $0 puts real money into Talise. **Default OFF**, but off by a
single env var, not by hard-coded booleans.

## One flag, one source of truth

`web/lib/onramp/flags.ts` is the only place that answers "is funding open?".

```
ONRAMP_ENABLED=true            master switch (default false → OFF)
ONRAMP_PROVIDER=bridge|transak active adapter (default bridge)
```

It is read at **request** time, so flipping it takes effect on the next request
— no redeploy, no app release. `NEXT_PUBLIC_ONRAMP_ENABLED` is still honoured as
a legacy alias, but prefer `ONRAMP_ENABLED`: a `NEXT_PUBLIC_*` value is inlined
at build time and therefore cannot be flipped without a redeploy.

Every client reads the same verdict from `GET /api/onramp/config`:

| Client | Reader |
|---|---|
| web | `web/app/app/ramps/AddMoneyPanel.tsx` |
| iOS | `ios/Talise/Features/Ramps/OnrampConfig.swift` (`OnrampConfigStore`) |
| Android | `android/…/feature/ramps/RampsApi.kt` (`OnrampConfigStore`) |
| server | `isOnrampEnabled()` guards `/api/onramp/v2/*` |

```json
{ "enabled": false, "provider": "bridge", "configured": false,
  "closedReason": "switch_off", "funding": "bank",
  "deliverAsset": "USDC", "requiresSwapToUsdsui": true }
```

**Fail closed.** `enabled` is true only when the switch is on **and** the
selected provider has credentials. The adapters return deterministic stub data
when unkeyed; a stubbed "wire your money here" screen would be a lie that costs
a user money, so an unconfigured provider reads as OFF. `lib/onramp/bridge.ts`
additionally throws rather than returning stub data when `NODE_ENV=production`.

## The money path (Bridge, the default)

1. `POST /api/onramp/v2/session` derives a KYC profile from the **session** (the
   client never supplies PII the server already holds) and creates a Bridge
   hosted KYC + ToS link. Response: `{ kycRequired: true, kycUrl, tosUrl }`.
2. The user completes hosted KYC. Bridge owns the identity flow; no PII passes
   through Talise.
3. The client retries the route. It re-checks KYC **live** (webhooks don't reach
   localhost, and Bridge hard-rejects virtual accounts for non-active customers),
   then creates — or reuses — a **virtual account**: a persistent bank account
   number / IBAN in the user's currency. Response: `depositInstructions`.
4. The user wires fiat to it. Bridge converts and **mints USDC on Sui directly
   to the user's own address**. `BRIDGE_DEVELOPER_FEE_PERCENT` (default `1.0`)
   is Talise's take, applied by Bridge.
5. The user taps **Swap to USDsui** in the token bucket (`/api/swap/prepare`,
   stablecoin↔stablecoin so fee-free) to reach the headline balance.

### Why there is no double-credit surface

Talise **never credits a balance for an on-ramp**. Step 4 is Bridge writing
on-chain to an address Talise does not custody, and `/api/balances` reads the
chain. There is no DB credit to duplicate, so webhook retries are structurally
harmless and no client-supplied amount can inflate anything (`amountCents` is
informational — a virtual account accepts any deposit).

The webhooks that do exist are state mirrors only:

- `POST /api/onramp/v2/kyc-webhook` — RSA-verified (`BRIDGE_WEBHOOK_PUBKEY`),
  timestamp-skew checked, **rejects unverified events with 401 in production**.
  Idempotent by construction: a `COALESCE` upsert keyed on `user_id`.
- `POST /api/offramp/bridge/webhook` — verify-then-log, moves no money.

`BRIDGE_WEBHOOK_PUBKEY` must be set before enabling in production. Without it
every event is `unverified`; funding can't be mis-credited, but a forged event
**could** set a KYC verdict that the cash-out path trusts.

## Step-up KYC tiers

`lib/onramp/requirements.ts` maps amount + country → required tier
(`none | lite | standard | enhanced`) and the missing fields, exposed by
`POST /api/onramp/v2/requirements`. Persisted in `onramp_kyc` (created by
`ensureSchema()` in `lib/db.ts`; `migrations/2026-06-05-onramp-kyc.sql` is the
same DDL). **These thresholds are scaffold values and have not been
compliance-reviewed** — review per jurisdiction before real volume.

`onramp_kyc.kyc_tier` is display/compliance state. `users.kyc_tier`
(`lib/kyc.ts`) remains the authoritative send-gate.

## Client states

Both states must be honest, and the closed state must be useful.

- **web** (`app/app/ramps/AddMoneyPanel.tsx`) — loading skeleton / closed card
  that opens the receive-address sheet (the funding path that works today) plus
  a notify-me / open card that runs the real flow.
- **iOS** (`Features/Deposit/DepositFlowView.swift` → `AddMoneyCorridorFlow` →
  `BridgeOnrampView`) — the Bank transfer tile navigates only when the server
  says open; closed it names the Crypto path instead of a dead "soon".
- **Android** (`feature/deposit/DepositScreen.kt` → `CorridorPickerView` →
  `BridgeOnrampView`) — same shape.

Copy never promises "arrives as USDsui" while `requiresSwapToUsdsui` is true.

## Turning it on

1. Confirm `BRIDGE_API_KEY` + `BRIDGE_WEBHOOK_PUBKEY` are set for the
   environment, and that the Bridge webhook endpoint points at
   `/api/onramp/v2/kyc-webhook?provider=bridge`.
2. Sanity-check the rail once: `validateSuiRail(customerId)` in
   `lib/bridge/client.ts` (a `dry_run` transfer, no money moves).
3. Review `requirements.ts` thresholds with compliance.
4. End-to-end with a real identity and **$1** (see
   `web/scripts/BRIDGE-KYC-RUNBOOK.md` — `BRIDGE_API_BASE` unset means
   PRODUCTION Bridge and real money).
5. Set `ONRAMP_ENABLED=true`. No code change, no deploy.

## Providers

- **Bridge (default)** — `lib/onramp/bridge.ts` + `lib/bridge/*`. Bank funding
  via virtual accounts, USD/EUR/GBP/MXN/BRL/COP. Delivers USDC on Sui.
- **Transak (fallback)** — `lib/onramp/transak.ts`. Hosted card widget that runs
  its own KYC; also delivers USDC on Sui.
- Legacy **Stripe** crypto onramp (`/api/onramp/session`,
  `/api/onramp/hosted-session`) is a separate integration, untouched by
  `ONRAMP_ENABLED`, and gated client-side by `RampFlags.cardOnrampLive`.

NGN is **not** a Bridge rail; Nigerian payout stays on Linq.
