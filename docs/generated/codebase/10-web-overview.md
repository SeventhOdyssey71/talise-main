# Web App Overview

Talise's `web/` directory is a Next.js 15 App Router project that ships three things in one tree:

1. The marketing site (`/`, `/waitlist`, `/litepaper`, `/coming-soon`).
2. The authed Talise dApp (`/home`, `/send`, `/receive`, `/earn`, `/rewards`, `/business`, `/settings`, `/claim`, `/chat`, `/pay`, `/onboarding`).
3. The HTTP API consumed by both the web frontend and the iOS app (`/app/api/**`).

## Stack

- Next.js 15 (App Router), React 19, TypeScript 5.
- Tailwind v4 (CSS-side config). `app/globals.css` opens with `@import "tailwindcss";` and declares design tokens inside a single `@theme { … }` block. There is no `tailwind.config.*`.
- PostCSS plugin: `@tailwindcss/postcss` (see `postcss.config.mjs`).
- Self-hosted Google Sans Variable via `@fontsource-variable/google-sans`, plus `next/font/google` for JetBrains Mono and Instrument Serif (italic).
- Sui SDK: `@mysten/sui` (gRPC + JSON-RPC), `@mysten/suins`, `@mysten/zklogin`, `@mysten/deepbook-v3`, `@mysten/payment-kit`, `@cetusprotocol/aggregator-sdk`, `@t2000/sdk` (NaviAdapter).
- Email: `resend` + `@react-email/render` + `@react-email/components`.
- DB: `postgres` (postgres.js). No ORM.
- Build target: `output: "standalone"` (see `next.config.ts`) for the Railway / Docker image. Vercel uses the same build.

## Top-level layout

```
web/
  app/              App Router pages, layouts, route handlers
    api/            All HTTP API routes (REST-ish JSON)
    auth/           OAuth callback + logout
    home/ send/ receive/ earn/ rewards/ business/
    settings/ claim/ chat/ pay/ onboarding/ litepaper/
    waitlist/ coming-soon/ p/[handle]/
    layout.tsx page.tsx globals.css icon.png
  components/       React components (server + client)
    talise-app/     Mobile-style shell used by the authed surface
  emails/           React Email templates (WaitlistConfirmation)
  lib/              Server libraries (db, sui, navi, vault, …)
    chat/           Chat AI + intent + system prompts
    emails/         HTML email body string builders (welcome)
    intents/        Payment Kit nonce wrappers
    onara/          Onara gas-sponsor client
    rewards/        Earn/redeem/roundup/goals/insights
  public/           Static assets (logo, hero image, etc.)
  next.config.ts postcss.config.mjs tsconfig.json
  package.json pnpm-lock.yaml
```

There is no `middleware.ts`. Route protection happens inline inside each page or route handler via `readSessionEntryId()`.

## Request flow

```
Browser
  ├─ GET /home (RSC)
  │    layout → page → readSessionEntryId() → userById() →
  │    lib/sui + lib/yield + lib/activity + lib/suins-lookup (parallel)
  │    → AppShell + BalanceCard + HistoryRow tree
  │
  ├─ POST /api/send/prepare
  │    readEntryIdFromRequest() (cookie or mobile bearer)
  │    → lib/intents/wrap-payment-kit  → lib/navi-supply (optional)
  │    → returns transactionKindB64
  │
  ├─ POST /api/zk/sponsor                  [Trip 1]
  │    lib/onara → tx.setGasOwner(sponsor) → bytes back to client
  │
  └─ POST /api/zk/sponsor-execute          [Trip 2]
       lib/zksigner.assembleZkLoginSignature →
       lib/shinami (zkProver) OR lib/zksigner GPU URL →
       lib/onara.sponsor() → broadcast → effects → rewards.awardForTx()
```

Routes never share state across requests. Server modules use singletons (`sui()`, `onara()`, `db()`, `adapter()`) so each Node worker keeps one client per dependency and reuses keep-alive sockets.

## Auth model

zkLogin over Google OAuth. The full flow:

1. Client: `triggerOauthSignIn()` (lib/zkclient.ts) generates an ephemeral Ed25519 keypair, computes a zkLogin nonce, persists the private key + randomness + maxEpoch in `localStorage`, calls `POST /api/auth/state` to mint a signed CSRF state cookie, then redirects to Google.
2. Google → `GET /auth/callback`. The route exchanges the code for an `id_token`, decodes the JWT, and (on mainnet) calls `shinamiGetWallet()` to resolve a deterministic salt + address. `upsertUser()` writes the row. `setSessionCookie(user.id)` sets `talise_session` (HMAC-signed payload containing the users-table id) and `setSigningCookie(jwt, salt)` stashes the JWT + salt server-side for later prover calls.
3. Every authenticated request reads the session entry id with `readSessionEntryId()` from `lib/session.ts` and looks the user up via `userById()`. There is no JWT in the browser. The browser holds only the ephemeral private key.

Mobile uses a parallel flow: `/api/auth/mobile/start` mints an `m1.`-prefixed state token, the same `/auth/callback` notices the prefix and issues a bearer via `lib/mobile-sessions.ts` instead of a cookie. API routes accept either via `readEntryIdFromRequest()`.

Cookies set by the stack (all HMAC-signed via `lib/auth.ts`):
- `talise_session` (1 year) — user id.
- `talise_oauth_state` (5 min) — CSRF state.
- `talise_jwt` (1 hr) — base64url JSON of `{jwt, salt}` for the prover.
- `talise_return_to` (10 min) — post-login redirect path.
- `talise_ref` (30 days) — captured referral code.
- `talise_m1_binding` (transient) — mobile (pubkey, maxEpoch, randomness) carried across the OAuth bounce.

## Database

`lib/db.ts` exposes a libSQL-shaped adapter on top of `postgres.js`:

```ts
db().execute({ sql: "SELECT * FROM users WHERE id = ?", args: [id] })
db().batch([ {sql, args}, … ], "write")
```

`?` placeholders are rewritten to `$1, $2, …` at execute time (skipping quoted strings + comments). `BIGINT` columns are returned as plain `number` (timestamps fit safely under 2^53). The connection picks SSL mode from the URL's `sslmode` query param (`disable`, `require`, or default `prefer`).

`ensureSchema()` is idempotent: every route that touches DB calls it (it memoizes the promise so cold start runs the migrations exactly once). It creates `users`, `tx_history`, `invoices`, `rewards_events`, `savings_goals`, `redemptions`, `waitlist`, plus `ALTER TABLE … ADD COLUMN IF NOT EXISTS` for every column added since v1, and widens any leftover `int4` timestamp columns to `int8`.

`DATABASE_URL` is required. `DATABASE_AUTH_TOKEN` is ignored (kept in the env template as a vestige of the libSQL era).

## Runtime modes

Every API route under `app/api/**` declares `export const runtime = "nodejs"`. There is no edge runtime usage anywhere in the codebase — the dependencies (Sui SDK, postgres.js, Shinami fetch with `AbortSignal.timeout`, node:crypto) all require Node. Most pages also pin `export const dynamic = "force-dynamic"` and `export const revalidate = 0` because they read live on-chain balances and the per-user session cookie.

`next.config.ts` sets `output: "standalone"` (reduces the runner image from ~700 MB to ~180 MB) and whitelists `images.unsplash.com` + `lh3.googleusercontent.com` for `next/image`. `experimental.serverActions.allowedOrigins` lists `localhost:3000` and `talise.io`.
