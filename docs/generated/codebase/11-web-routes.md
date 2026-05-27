# Web Routes

Every page lives under `web/app/`. Every API handler lives under `web/app/api/**/route.ts`. All API routes declare `export const runtime = "nodejs"`.

## Pages

### Marketing

- `/` (`app/page.tsx`) — Talise landing. Hero (`Send money across the globe. For free.`), `FeatureGrid`, `FinalCta`. Pre-launch state: every CTA links to `/waitlist`, not `SignInButton`. If `readSessionEntryId()` resolves, redirects to `/business` / `/home` / `/onboarding` depending on `account_type`.
- `/waitlist` (`app/waitlist/page.tsx`) — Private-beta waitlist signup. Hosts `<WaitlistForm>` (client component) which POSTs to `/api/waitlist`. Tuned to fit a 1280x800 viewport in one screen.
- `/litepaper` (`app/litepaper/page.tsx`) — Renders the project litepaper.
- `/coming-soon` (`app/coming-soon/page.tsx`) — Static placeholder used on press / app-store landings before the doors open.
- `/p/[handle]` (`app/p/[handle]/page.tsx`) — Public profile / payment page for a `@handle`. Resolves the SuiNS subname, renders an "@handle" card a sender can scan or share.

### Authed dApp

Every authed page calls `readSessionEntryId()`, redirects to `/` if missing, redirects to `/onboarding` if the user has no `account_type`, and falls into business or personal flows after that. They all render inside `<AppShell>` (mobile-style column with TopGlow + floating BottomNav, see `components/talise-app/AppShell.tsx`).

- `/home` (`app/home/page.tsx`) — Personal dashboard. Fetches `getSuiBalance`, `getUsdsuiBalance`, `getSuiUsdcPrice`, `getEarnSnapshot`, `getOwnedCoins`, SuiNS subname lookups, and `getRecentActivity` in parallel. Renders `<BalanceCard>` + `<HistoryRow>` rows. Surfaces `<FixSubnameBanner>`, `<AutoConvertBanner>`, `<NetworkBanner>`, and an onramp success toast when `?onramp=success`.
- `/business` (`app/business/page.tsx`) — Business dashboard. Same shell, swapped widgets: `<BusinessRevenueCard>`, `<PaymentLinkCard>`, `<BusinessStatsRow>`. Redirects personal-only users to `/home`.
- `/send` (`app/send/page.tsx`) — `<SendForm>` (client). Resolves recipients, prompts confirm, fires the sponsored tx via `signAndSubmit()`.
- `/receive` (`app/receive/page.tsx`) — QR + share. Shows `<UsernameCard>` (the user's `name@talise` handle) if they have one. Two children: `<ReceiveQR>` and `<ReceiveShare>`.
- `/earn` (`app/earn/page.tsx`) — Yield dashboard. `<EarnHero>` + `<EarnDashboard>` with supplied + APY + daily-yield numbers from `getEarnSnapshot`.
- `/rewards` (`app/rewards/page.tsx`) — Points + referrals. `<RewardsHero>` + `<RewardsPanel>` from `getRewardsSummary`. Pulls activity for roundup analytics.
- `/settings` (`app/settings/page.tsx`) — Profile, country, notifications, sign-out. Hosts `<SettingsForm>` and `<AddBusinessForm>`.
- `/claim` (`app/claim/page.tsx`) — Username claim flow. Lets a user mint `<name>.talise.sui`.
- `/chat` (`app/chat/page.tsx`) — Full-page Talise agent (`<ChatView>`). Replaces the older floating chat pill on /home.
- `/pay` (`app/pay/page.tsx`) — Public pay-by-handle entry. Hosts `<PayLookup>` for unauthed lookups; the business/invoice surfaces live under `/business/invoice` and `/business/payroll`.
- `/onboarding` (`app/onboarding/page.tsx`) — Hosts `<OnboardingFlow>` (client). Picks personal vs business, collects country + interests + handle.
- `/business/invoice` and `/business/payroll` — Invoice composer + bulk payroll list (`<InvoiceForm>`, `<InvoiceList>`, `<PayrollForm>`).

### Auth endpoints

- `GET /auth/callback` (`app/auth/callback/route.ts`) — Google OAuth landing. Exchanges code, resolves Shinami salt + address, upserts user, sets `talise_session` + `talise_jwt`, fires the welcome email via `after(...)`, redirects. Mobile callers (state begins with `m1.`) get bounced to `talise://auth/callback` with a bearer token.
- `POST /auth/logout` (`app/auth/logout/...`) — Clears the session cookies.

## API routes

Routes are grouped by domain. Every route reads the caller's user via `readEntryIdFromRequest()` (which accepts either the `talise_session` cookie or a mobile `Authorization: Bearer …` token) unless noted as public.

### Auth + zk

| Route | Method | Body / params | Behavior |
|---|---|---|---|
| `/api/auth/state` | POST | `{state}` | Stores HMAC-signed CSRF state in `talise_oauth_state`. Public. |
| `/api/auth/return-to` | POST | `{returnTo}` | Stores a path to redirect to after login (10 min TTL). Public. |
| `/api/auth/mobile/start` | GET | querystring `ephemeralPubKey`, `maxEpoch`, `randomness` | Mints an `m1.`-prefixed state, signs an `talise_m1_binding` cookie carrying the ephemeral triple, redirects to Google. |
| `/api/auth/mobile/exchange` | POST | `{idToken}` | iOS-native flow: takes a Google id_token already obtained client-side, resolves Shinami wallet, upserts, returns a mobile bearer. |
| `/api/auth/attest/challenge` | GET | — | Issues App Attest challenge (iOS DeviceCheck integrity). |
| `/api/auth/attest/register` | POST | App Attest attestation | Verifies + persists key id on the mobile session. |
| `/api/zk/proof` | POST | `{ephemeralPubKeyB64, maxEpoch, randomness}` | Calls `mintZkProof()` and returns the cacheable proof shape. |
| `/api/zk/sponsor` | POST | `{transactionKindB64}` | Trip 1: asks Onara for sponsor address, builds full TransactionData with the sponsor as gasOwner, returns `{bytes, digest}`. Also calls `ensurePaymentRegistry()` lazily. |
| `/api/zk/sponsor-execute` | POST | `{bytesB64, ephemeralPubKeyB64, maxEpoch, randomness, userSignature, cachedProof?, meta?}` | Trip 2: assembles the zkLogin signature, posts to Onara `/sponsor`, returns effects + `objectChanges` + optionally `freshProof`. Credits rewards via `awardForTx()`. |
| `/api/zk/warmup` | GET | — | Warms the prover route + ensures the Payment Kit registry exists. |
| `/api/sign` | POST | `{txBytesB64, ephemeralPubKeyB64, maxEpoch, randomness, userSignature}` | Non-sponsored path: assembles a zkLoginSignature for the user to broadcast themselves. |

### User + onboarding

| Route | Method | Notes |
|---|---|---|
| `/api/me` | GET | Returns the authed user row (sanitized). |
| `/api/onboarding` | POST | Body `{accountType, country?, interests?, notifyOnReceive?, ...}`. Writes via `setAccountType()`. |
| `/api/account/switch` | POST | `{to: "personal" \| "business"}`. Updates active context. |
| `/api/account/add-business` | POST | `{businessName, businessHandle, businessIndustry?}`. Adds business profile to existing user. |
| `/api/settings` | POST | Profile updates: name, country, notify_on_receive. |
| `/api/username/check` | GET | `?handle=`. Returns availability + reservation status. |
| `/api/username/claim` | POST | `{handle, ...}`. Mints `<handle>.talise.sui` via the SuiNS operator wallet. |

### Sui + balances + activity

| Route | Method | Notes |
|---|---|---|
| `/api/balances` | GET | Aggregated SUI + USDsui + non-USDsui coin balances. |
| `/api/wallet/balances` | GET | Same shape used by iOS. |
| `/api/wallet/sweep` | POST | Builds a sweep PTB (auto-convert non-USDsui coins to USDsui). |
| `/api/sui/epoch` | GET | Tiny proxy that returns the current epoch (used by `lib/zkclient.ts` during nonce generation to avoid bundling the Sui SDK on the client). |
| `/api/fx` | GET | Returns the current FX table (`lib/fx.ts`). |
| `/api/activity` | GET | `?limit=20`. Calls `getRecentActivity(address, limit, vaultId?)`. Wrapped in a 5-second per-user `memoTtl` and emits `Cache-Control: private, s-maxage=3, stale-while-revalidate=15`. |
| `/api/tx/record` | POST | Records a tx digest into local `tx_history`. |

### Send / receive / pay

| Route | Method | Notes |
|---|---|---|
| `/api/send/prepare` | POST | `{to, amount, asset}`. Wraps the transfer in a Payment Kit `processRegistryPayment` MoveCall. Returns `transactionKindB64` (optionally with a NAVI supply leg appended when round-up & save is enabled, see `getRoundupConfig()`). |
| `/api/recipient/resolve` | GET | `?q=`. Resolves a handle / SuiNS / hex address to a `{address, displayName}`. |
| `/api/contacts` | GET / POST | Lists or appends user contacts. |
| `/api/invoices` | GET / POST | Lists or creates business invoices. |
| `/api/pk/status` | GET | Returns Payment Kit registry id + readiness. |
| `/api/sweep/prepare` | POST | Builds a manual sweep PTB. |

### Earn (yield)

| Route | Method | Notes |
|---|---|---|
| `/api/earn/supply/prepare` | POST | `{venue: "deepbook" \| "navi", amount}`. Builds a sponsored supply PTB. |
| `/api/earn/withdraw/prepare` | POST | `{venue, amount}`. Withdraws principal. |
| `/api/earn/withdraw-earned/prepare` | POST | Withdraws accrued interest only. |
| `/api/yield/comparison` | GET | Snapshot of APYs across venues. |
| `/api/spot/record-bm` | POST | Records the newly-minted DeepBook BalanceManager id under the user row. |
| `/api/t2000/execute` | POST | Server-side T2000 SDK execution path (legacy non-sponsored). |

### Vault (TaliseVault + AutoSwap)

These mirror the on-chain `talise::vault` + `talise::auto_swap` Move modules; all return `transactionKindB64` for the user to sign.

`/api/vault/create`, `/api/vault/record`, `/api/vault/state`, `/api/vault/disable`, `/api/vault/pause`, `/api/vault/resume`, `/api/vault/enable-autoswap`, `/api/vault/enable-default-caps`, `/api/vault/update-bounds`, `/api/vault/migrate-bundle`, `/api/vault/migrate-cap`, `/api/vault/migrate-confirm`, `/api/vault/migration-status`, `/api/vault/repoint-confirm`, `/api/vault/upgrade-cap-v2`, `/api/vault/sweep-now`, `/api/vault/withdraw`.

The package + registry ids resolve through `vaultPackageIds()` in `lib/vault.ts`; if the env vars are missing the route returns 503 (`VaultNotDeployedError`).

### Rewards / referrals

| Route | Method | Notes |
|---|---|---|
| `/api/rewards/catalogue` | GET | Static catalog from `lib/rewards/catalogue.ts`. |
| `/api/rewards/goals` (+ `/[id]`) | GET / POST / PATCH / DELETE | Savings goals CRUD. |
| `/api/rewards/insights` | GET | Aggregated lifetime stats. |
| `/api/rewards/redeem` | POST | Spend points for a SKU. |
| `/api/rewards/roundup` | POST | Toggle round-up + set percentage. |
| `/api/referral/capture` | POST | Validates a referral code typed during onboarding; calls `attributeReferral()`. |
| `/api/referral/cookie` | POST | Sets the signed `talise_ref` cookie when a `?ref=` lands. |
| `/api/referral/summary` | GET | Inviter's invite count + recent referees. |

### Waitlist + email

| Route | Method | Notes |
|---|---|---|
| `/api/waitlist` | POST | `{email, name?, country?, reason?, source?}`. Public. Upserts on `email`, fires `sendWaitlistConfirmation()` fire-and-forget, persists the Resend message id back to the row. Returns 200 even on duplicate. |

### Onramp (Stripe Crypto)

| Route | Method | Notes |
|---|---|---|
| `/api/onramp/session` | POST | Creates a Stripe Crypto Onramp session. Stripe delivers USDC on Sui mainnet; the AutoConvertBanner sweeps USDC → USDsui after settlement. |
| `/api/onramp/webhook` | POST | Stripe-signed webhook receiver. |

### Chat (agentic)

| Route | Method | Notes |
|---|---|---|
| `/api/chat` | POST | Non-streaming chat endpoint. |
| `/api/chat/stream` | POST | Streaming SSE response. Both call the 0G Compute DeepSeek V4 OpenAI-compatible proxy (`ZG_DEEPSEEK_V4_PROVIDER_URL`). |

### Cron + ops

| Route | Method | Notes |
|---|---|---|
| `/api/cron/auto-swap-sweep` | GET | Vercel Cron / Railway scheduled job. Walks vault state and triggers Onara auto-swap sweeps where bounds are hit. Gated by `ADMIN_TOKEN`. |
| `/api/health` | GET | `dbHealth()` + Sui RPC ping. |
| `/api/debug/deepbook` | GET | Local debug surface for DeepBook reads. |

### Security model summary

- Cookie-or-bearer auth via `readEntryIdFromRequest()` in every authed route.
- CSRF on the OAuth bounce via `talise_oauth_state`.
- The user JWT + salt live server-side only (`talise_jwt` httpOnly cookie or `mobile_sessions` row); they are never exposed to the client.
- Webhooks (`/api/onramp/webhook`) verify Stripe signatures.
- Admin routes (`/api/cron/*`) require `ADMIN_TOKEN`.
- All API routes pin `runtime = "nodejs"` so node:crypto + the Sui SDK are available.
