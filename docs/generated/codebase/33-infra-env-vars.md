# 33. Environment Variables

Authoritative inventory. Source of truth: `web/.env.example` plus the
grep of `process.env.*` references under `web/lib/` and `web/app/api/`.
A redacted name-only snapshot lives at `.env.vercel` at the repo root.

Conventions:

- "Vercel: prod" = set on Vercel project `talise-main`, Production env.
- "Vercel: prev" = also set on Preview env (PR deploys).
- "Vercel: dev" = also set on Vercel Development (mostly for
  `vercel env pull`; engineers usually keep dev values in
  `web/.env.local` directly).
- "Local" = read from `web/.env.local`.

## Web app: required

| Name                          | Purpose                                                                | Where set            | Example shape |
| ----------------------------- | ---------------------------------------------------------------------- | -------------------- | ------------- |
| `NEXT_PUBLIC_BASE_URL`        | Public origin used for OAuth state + absolute URLs in emails.          | Vercel: prod/prev, Local | `https://talise.io` |
| `NEXT_PUBLIC_SUI_NETWORK`     | `mainnet` or `testnet`. Drives prover URL fallback in zksigner.        | Vercel: prod/prev, Local | `mainnet` |
| `GOOGLE_CLIENT_ID`            | Server-side Google OAuth client id (web).                              | Vercel: prod, Local  | `xxx.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET`        | Server-side Google OAuth client secret.                                | Vercel: prod, Local  | secret string |
| `GOOGLE_REDIRECT_URI`         | Hard fallback redirect URI used by `googleRedirectUri()` in `web/lib/auth.ts:18-22` when a request doesn't go through `redirectUriFromRequest()`. Set to the WEB host. Mobile flows derive the redirect URI from the request host at runtime. | Vercel: prod, Local | `https://talise.io/auth/callback` |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Same as `GOOGLE_CLIENT_ID`, exposed to the browser bundle.            | Vercel: prod/prev, Local | same |
| `NEXT_PUBLIC_GOOGLE_REDIRECT_URI` | Same as `GOOGLE_REDIRECT_URI`, exposed to the browser bundle.       | Vercel: prod/prev, Local | same |
| `GOOGLE_CLIENT_ID_IOS`        | Separate iOS OAuth client id. Used by `/api/auth/mobile/exchange` to validate the `aud` claim on id_tokens received from iOS. | Vercel: prod, Local | `xxx.apps.googleusercontent.com` |
| `DATABASE_URL`                | Postgres connection string. Prod uses managed Postgres via the `postgres` driver in `web/lib/db.ts`. Previously libSQL/Turso. | Vercel: prod, Local | `postgres://USER:PASS@HOST:PORT/DB` |
| `DATABASE_AUTH_TOKEN`         | Ignored under the Postgres adapter. Retained only so the legacy libSQL path can be re-enabled for local dev. | Vercel: prod (optional) | JWT (unused in Postgres mode) |
| `SESSION_SECRET`              | HMAC key for session, JWT, state, referral cookies. Minimum 16 chars.  | Vercel: prod, Local  | `openssl rand -base64 32` |
| `SHINAMI_API_KEY`             | zkLogin Wallet (salt) + zkProver. Today's production primary prover.   | Vercel: prod, Local  | `sui_mainnet_xxx` |
| `ONARA_URL`                   | Sponsor service base URL. Local: `http://localhost:8787`. Prod: Cloudflare Workers URL. | Vercel: prod, Local | `https://onara.talise.workers.dev` |
| `NEXT_PUBLIC_SPONSOR_ENABLED` | When `true`, signAndSubmit goes through Onara. Default true.           | Vercel: prod/prev, Local | `true` |
| `CRON_SECRET`                 | Bearer token Vercel attaches to cron invocations. Checked in `web/app/api/cron/auto-swap-sweep/route.ts:58`. Vercel manages this automatically; setting it explicitly only matters if you want to invoke crons manually. | Vercel: prod (auto-managed) | random |
| `TALISE_SUINS_OPERATOR_KEY`   | Bech32 Ed25519 key (`suiprivkey1...`) owning the `talise.sui` parent NFT. Mints subnames. Also doubles as PK operator unless `TALISE_PK_OPERATOR_KEY` is set. | Vercel: prod, Local | bech32 |
| `TALISE_SUI_NFT_ID`           | On-chain object id of the `talise.sui` parent NFT.                     | Vercel: prod, Local  | `0x...` |
| `TALISE_SUI_EXPIRY_MS`        | Parent NFT expiry timestamp (ms).                                       | Vercel: prod, Local  | `1985123456789` |
| `TALISE_AUTOSWAP_PACKAGE_ID`  | Original published package id of the auto_swap Move package.            | Vercel: prod, Local  | `0x...` |
| `TALISE_AUTOSWAP_PACKAGE_LATEST` | Latest upgraded package id. The cron handler uses this when querying `CapUpgradedToV2` events (see `34-infra-observability.md`). | Vercel: prod, Local | `0x...` |
| `TALISE_AUTOSWAP_REGISTRY_ID` | Shared `AutoSwapRegistry` object id (v1).                              | Vercel: prod, Local  | `0x...` |
| `TALISE_AUTOSWAP_REGISTRY_V2_ID` | Shared `AutoSwapRegistryV2` object id (v7).                         | Vercel: prod, Local  | `0x...` |
| `TALISE_USDSUI_TYPE`          | Canonical type tag for the USDsui coin, e.g. `0x...::usdsui::USDSUI`.   | Vercel: prod, Local  | type tag string |

## Web app: optional / feature-flagged

| Name                          | Purpose                                                                | Where set            | Default if unset |
| ----------------------------- | ---------------------------------------------------------------------- | -------------------- | ---------------- |
| `ZK_PROVER_URL`               | Legacy single-prover override. Read by `callProver()`. Bypasses Shinami when set. | Vercel: prod      | Falls back to Mysten testnet/mainnet by `NEXT_PUBLIC_SUI_NETWORK`. |
| `ZK_PROVER_PRIMARY`           | `gpu` / `shinami` / `mysten`. Picks the primary prover backend in `callProverWithFallback`. | Vercel: prod | `shinami` |
| `ZK_PROVER_FALLBACK`          | Same set plus `none`. Backstop on 5xx/timeout.                          | Vercel: prod         | `shinami` |
| `ZK_PROVER_GPU_URL`           | Full URL to the unconfirmedlabs GPU prover, including `/input`.         | Vercel: prod         | unset |
| `ZK_PROVER_CANARY_PCT`        | 0..100. When >0, a hash-bucketed slice of users gets GPU regardless of PRIMARY. | Vercel: prod | `0` |
| `ZK_PROVER_TIMEOUT_MS`        | Per-attempt prover timeout.                                             | Vercel: prod         | `8000` |
| `RESEND_API_KEY`              | Resend transactional email. Without it, on-receive + invoice-paid + waitlist emails no-op. | Vercel: prod, Local | unset (graceful) |
| `EMAIL_FROM`                  | `Talise <onboarding@resend.dev>` or your verified Resend domain.        | Vercel: prod, Local  | `onboarding@resend.dev` |
| `EMAIL_REPLY_TO`              | Reply-to header on outbound mail.                                       | Vercel: prod, Local  | `hello@talise.io` |
| `WAITLIST_FROM_EMAIL`         | Resend-verified `From:` for waitlist confirmation.                      | Vercel: prod         | falls back to `EMAIL_FROM` |
| `WAITLIST_BCC_EMAIL`          | Optional ops BCC for waitlist signups.                                  | Vercel: prod         | unset |
| `NEXT_PUBLIC_APP_URL`         | Origin used to build image URLs inside emails.                          | Vercel: prod, Local  | falls back to `NEXT_PUBLIC_BASE_URL` |
| `ADMIN_TOKEN`                 | 32+ char random; gates `/api/admin/*` routes.                           | Vercel: prod         | unset (admin routes disabled) |
| `TALISE_PK_OPERATOR_KEY`      | Override for the Payment Kit operator key. Falls back to `TALISE_SUINS_OPERATOR_KEY`. | Vercel: prod, Local | unset |
| `NEXT_PUBLIC_PK_RECEIPTS_ENABLED` | Kill switch for Payment Kit receipts. Default enabled.              | Vercel: prod, Local  | unset = enabled |
| `STRIPE_SECRET_KEY`           | Stripe API key for Crypto Onramp. Test mode `sk_test_*`, live `sk_live_*`. | Vercel: prod, Local | unset (onramp disabled) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Required for the embedded onramp SDK to load.                    | Vercel: prod/prev, Local | unset |
| `STRIPE_WEBHOOK_SECRET`       | Signing secret for `/api/onramp/webhook`.                               | Vercel: prod         | unset (no webhook verification) |
| `ZG_DEEPSEEK_V4_PROVIDER_URL` | 0G Compute proxy URL for DeepSeek V4 chat.                              | Vercel: prod, Local  | `https://compute-network-21.integratenetwork.work/v1/proxy` |
| `ZG_DEEPSEEK_V4_API_KEY`      | API key for the chat. Without it, chat panel renders offline message.   | Vercel: prod, Local  | unset |
| `MEMWAL_ACCOUNT_ID`           | Memwal persistent chat memory account.                                  | Vercel: prod, Local  | unset (per-session memory) |
| `MEMWAL_DELEGATE_KEY`         | Memwal delegate signing key.                                            | Vercel: prod         | unset |
| `MEMWAL_DELEGATE_PUBLIC_KEY`  | Memwal delegate public key (paired with above).                         | Vercel: prod         | unset |
| `MEMWAL_SERVER_URL`           | Memwal relayer URL.                                                     | Vercel: prod, Local  | `https://relayer.memwal.ai` |
| `SUI_RPC_URL`                 | Override for the JSON-RPC fullnode. When unset, falls back to `fullnode.mainnet.sui.io`. | Vercel: prod | unset |
| `SUI_GRAPHQL_URL`             | Override for the GraphQL fullnode.                                      | Vercel: prod         | unset |
| `SUI_GRPC_URL` / `NEXT_PUBLIC_SUI_GRPC_URL` | gRPC fullnode URLs (used by experimental clients).      | Vercel: prod         | unset |

## Cetus aggregator

`CETUS_AGGREGATOR_ENDPOINT` is NOT an env var in this codebase. The
Cetus Aggregator SDK is instantiated with `new AggregatorClient({ env:
Env.Mainnet })` (see `web/app/api/sweep/prepare/route.ts:48`), which
uses the SDK's built-in mainnet endpoint
(`https://api-sui.cetus.zone/router_v3`). If you need to override it for
testing or for a regional mirror, the SDK supports a `endpoint` option
in its constructor; pass it explicitly rather than relying on an env
var.

## GPU prover host (set ON the GPU box, not Vercel)

These are container env vars consumed by the unconfirmedlabs prover
binary inside the Docker container. Set via the `docker run -e ...`
flags in the bootstrap script
(`infra/prover/gpu/deploy.sh:193-205`):

| Name                        | Purpose                                              | Default in bootstrap |
| --------------------------- | ---------------------------------------------------- | -------------------- |
| `PROVER_BACKENDS`           | Comma-separated. `gpu,cpu` keeps a CPU backstop.     | `gpu,cpu` |
| `ICICLE_DEVICE`             | Set to `CUDA` to use the GPU.                        | `CUDA` |
| `WITNESS_WORKERS`           | Parallel witness-gen workers (CPU-bound).            | `4` |
| `GPU_PROOF_WORKERS`         | GPU proof workers. 1 per GPU.                        | `1` |
| `CPU_PROOF_WORKERS`         | CPU backstop workers.                                | `1` |
| `PROVER_REQUEST_TIMEOUT_MS` | Per-request timeout inside the prover.               | `30000` |

The bootstrap also mounts the zkey read-only at
`/keys/zkLogin-main.zkey`.

## Provisioner script env (set in the operator's shell)

Consumed by `infra/prover/gpu/deploy.sh` when running the provisioner
locally. Never persisted, never on Vercel.

| Name                     | Purpose                                                        |
| ------------------------ | -------------------------------------------------------------- |
| `RUNPOD_API_KEY`         | Required for `--target=runpod`.                                 |
| `LAMBDA_LABS_API_KEY`    | Required for `--target=lambda-labs`.                            |
| `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` + `AWS_KEYPAIR_NAME` | Required for `--target=aws`. |
| `FLY_API_TOKEN` + `FLY_FORCE=1` | Required for `--target=fly` (intentionally gated). |
| `DOMAIN`                 | Override the default `zk-prover.talise.io`.                     |
| `ADMIN_EMAIL`            | Override the Let's Encrypt notification email.                  |
| `IMAGE`                  | Override the container image tag.                               |
| `GHCR_TOKEN`             | PAT with `read:packages` for private ghcr.io images. Falls back to `gh auth token` if `gh` is logged in. |
| `GHCR_USERNAME`          | GitHub username for the ghcr.io login. Defaults to `SeventhOdyssey71`. |
| `GPU_TYPE`               | Provider-specific GPU SKU override (e.g. `NVIDIA L4`).          |

## Vercel-managed (set automatically)

Vercel injects these into the runtime; treat them as read-only:

`VERCEL`, `VERCEL_ENV`, `VERCEL_URL`, `VERCEL_TARGET_ENV`,
`VERCEL_GIT_COMMIT_SHA`, `VERCEL_GIT_COMMIT_REF`,
`VERCEL_GIT_COMMIT_MESSAGE`, `VERCEL_GIT_COMMIT_AUTHOR_LOGIN`,
`VERCEL_OIDC_TOKEN`, plus the suite of `VERCEL_GIT_*` and `TURBO_*`
fields visible in `.env.vercel`.

`NODE_ENV` is set by Vercel/Next.js: `production` in deployed builds,
`development` for `next dev`.

## Notes on rotation

- `SESSION_SECRET`: rotating invalidates all sessions and the JWT
  cookies. Plan a maintenance window.
- `SHINAMI_API_KEY`: rotate via Shinami dashboard then `vercel env rm`
  + `vercel env add`.
- `TALISE_SUINS_OPERATOR_KEY`: the wallet pays its own gas (~0.1 SUI
  reserve recommended). Rotating means moving the parent name NFT to a
  new key, which is an on-chain operation, not a config change.
- `RESEND_API_KEY`: rotate freely.
- All `STRIPE_*`: rotate via Stripe dashboard. Test vs live keys must
  not be cross-deployed.
