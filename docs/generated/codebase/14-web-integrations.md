# External Integrations

The web app talks to seven external systems plus the host platform.

## Sui RPC (mainnet by default)

`lib/sui.ts` keeps two clients alive: a `SuiGrpcClient` (canonical for reads that map onto `getBalance`, `getCoinMetadata`, `listOwnedObjects`, etc.) and a `SuiJsonRpcClient` (fallback for `queryTransactionBlocks`, `getDynamicFields`, `multiGetObjects`, `getLatestSuiSystemState`, and any path that walks the JSON shape of `objectChanges` / `effects`).

```ts
function defaultGrpcBaseUrl(net) {
  return process.env.SUI_GRPC_URL
      ?? process.env.NEXT_PUBLIC_SUI_GRPC_URL
      ?? (net === "mainnet"
            ? "https://fullnode.mainnet.sui.io:443"
            : "https://fullnode.testnet.sui.io:443");
}
```

Network is `mainnet` unless `NEXT_PUBLIC_SUI_NETWORK=testnet`. Mainnet is required for Shinami's salt service to issue stable addresses.

## Cetus aggregator

`@cetusprotocol/aggregator-sdk` is used inside `lib/intents.ts` and `lib/t2000.ts` for cross-asset routing (e.g. USDC → USDsui, SUI → USDsui). It targets the `router_v3` endpoint via the SDK's default. The web app does not pin a custom Cetus URL — it relies on the SDK default which currently resolves to Cetus's public v3 aggregator endpoint.

## NAVI

NAVI is the production yield venue. `@t2000/sdk`'s `NaviAdapter` (made public in 2.11) wraps the supply / withdraw flow. `lib/navi-supply.ts` builds sponsor-friendly PTBs against the USDsui pool (`NAVI_ASSET = "USDsui"`). The adapter is initialised once per Node worker. Withdraw mirrors supply via `addWithdrawToTx`.

## Shinami (default zkLogin prover + salt)

`lib/shinami.ts` calls two JSON-RPC services:

- `https://api.us1.shinami.com/sui/zkwallet/v1` → `shinami_zkw_getOrCreateZkLoginWallet(jwt)` returns `{ address, salt }` deterministically per `(iss, sub)`.
- `https://api.us1.shinami.com/sui/zkprover/v1` → `shinami_zkp_createZkLoginProof(...)` returns the Groth16 proof.

The salt arrives base64-encoded; `decodeSalt()` normalizes it to the decimal-string form `genAddressSeed` expects. Required for mainnet (Mysten's hosted mainnet prover whitelists OAuth audiences and Talise's is not on it).

### Prover routing + GPU canary

`lib/zksigner.ts` adds a toggleable router on top of Shinami:

```
ZK_PROVER_PRIMARY      = gpu | shinami | mysten   (default shinami)
ZK_PROVER_FALLBACK     = gpu | shinami | mysten | none   (default shinami)
ZK_PROVER_GPU_URL      = https://...              (our unconfirmedlabs GPU prover)
ZK_PROVER_CANARY_PCT   = 0..100                    (deterministic bucket → GPU)
ZK_PROVER_TIMEOUT_MS   = 8000                      (per attempt)
ZK_PROVER_URL          = legacy single-call override
```

`callProverWithFallback({ inputs, canaryKey })` tries PRIMARY first, falls back once on 5xx/timeout, and logs one structured line per attempt:

```
[zk-prover] role=primary backend=gpu attempt=1 status=200 ms=412
```

Canary bucketing uses FNV-1a 32-bit over the address seed so the bucket is stable per-user across sessions.

## Onara (gas sponsorship)

Talise gas is sponsored via Onara, a Cloudflare-Workers policy server (`github.com/unconfirmedlabs/onara`). The web tier never holds the sponsor key; it asks Onara for the sponsor address (Trip 1) and posts the user-signed TransactionData back for broadcast (Trip 2).

`lib/onara/index.ts` exposes a singleton `onara()` client. Status (`/status`) and reference gas price are memoized for 60 seconds; the sponsor address rarely changes and reference gas is epoch-scoped (~24h). `ensurePaymentRegistry()` runs in parallel on the same critical path.

## Resend (transactional email)

`lib/email.ts` wraps `resend` with three senders:

- `sendWelcomeWithAddress(to, data)` — fires after a new user finishes the OAuth callback. The email body is a plain HTML string (`lib/emails/welcome.ts`).
- `sendWelcomeEmailOnly(to, position)` — fallback used elsewhere.
- `sendWaitlistConfirmation({ to, name? })` — uses the React Email template at `emails/WaitlistConfirmation.tsx`, rendered via `@react-email/render`.

Senders must be Resend-verified. Production sends from `waitlist@talise.io` (waitlist) and `onboarding@…` (welcome). When `RESEND_API_KEY` is unset, every send no-ops and logs `[email/dev] would send …`.

## Postgres (managed, not vercel/postgres)

The DB driver is `postgres` (postgres.js), not `vercel/postgres` or `pg`. The connection URL is plain `postgres://USER:PASS@HOST:PORT/DB`. SSL mode follows the URL's `sslmode` parameter. The pool is `max: 8` with 30s idle timeout. See `lib/db.ts` for the libSQL-shaped adapter on top.

`ensureSchema()` is idempotent and runs on first query: every route that needs DB just calls it. There is no separate migration tool.

## Stripe Crypto Onramp

`/api/onramp/session` creates a Stripe Crypto Onramp session (USDC on Sui mainnet). The embedded SDK (`@stripe/crypto` + `@stripe/stripe-js`) renders the modal client-side. `/api/onramp/webhook` verifies the Stripe signature and persists session state. USDC lands first; `AutoConvertBanner` on `/home` offers a one-tap sweep into USDsui.

## 0G Compute / DeepSeek V4 (agentic chat)

`/api/chat` and `/api/chat/stream` call the 0G Compute network's DeepSeek V4 Pro proxy (`ZG_DEEPSEEK_V4_PROVIDER_URL` — OpenAI-compatible). System prompt lives in `lib/chat/system.ts`. Optional persistent memory via Memwal (`MEMWAL_*` env vars) — when set, the agent remembers across sessions; when unset, conversations are per-page-load.

## Vercel (host)

Production runs on Vercel. `next.config.ts` ships `output: "standalone"` for parity with the Railway / Docker path (also configured via `railway.toml` and `Dockerfile`). `experimental.serverActions.allowedOrigins` includes `talise.io`. There is a `vercel.json` for routing config and a `.env.vercel` template for the env panel.

## Environment variables

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_BASE_URL` | Public origin, used for OAuth + email absolute URLs. |
| `NEXT_PUBLIC_APP_URL` | Public origin embedded in emails (falls back to BASE_URL). |
| `NEXT_PUBLIC_SUI_NETWORK` | `mainnet` (default) or `testnet`. |
| `NEXT_PUBLIC_SUI_GRPC_URL` | Optional override for the public Sui gRPC endpoint. |
| `SUI_GRPC_URL` | Server-side override for the same. |
| `GOOGLE_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` | Web OAuth client. |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` / `_REDIRECT_URI` | Same values exposed to the client for the OAuth redirect. |
| `GOOGLE_CLIENT_ID_IOS` | Separate iOS OAuth client (PKCE, no secret). Used to validate `aud` on `/api/auth/mobile/exchange`. |
| `SESSION_SECRET` | HMAC key for every signed cookie. Must be ≥16 chars. |
| `DATABASE_URL` | Postgres connection string. |
| `DATABASE_AUTH_TOKEN` | Vestigial libSQL token, currently unused. |
| `SHINAMI_API_KEY` | Shinami zkWallet + zkProver. Required on mainnet. |
| `ZK_PROVER_PRIMARY` | `gpu` / `shinami` / `mysten`. Default `shinami`. |
| `ZK_PROVER_FALLBACK` | Same, plus `none`. Default `shinami`. |
| `ZK_PROVER_GPU_URL` | URL of the unconfirmedlabs GPU prover. |
| `ZK_PROVER_CANARY_PCT` | 0..100, deterministic bucket → GPU. |
| `ZK_PROVER_TIMEOUT_MS` | Per-attempt timeout, default 8000ms. |
| `ZK_PROVER_URL` | Legacy single-call override. |
| `ONARA_URL` | Onara gas-sponsor URL (Cloudflare Worker). |
| `NEXT_PUBLIC_SPONSOR_ENABLED` | `true` (default) sends every send through Onara. |
| `TALISE_SUINS_OPERATOR_KEY` | `suiprivkey1…` bech32 secret of the `talise.sui` parent owner. |
| `TALISE_SUI_NFT_ID` / `TALISE_SUI_EXPIRY_MS` | The parent NFT id + its expiry, required for subname mints. |
| `TALISE_PK_OPERATOR_KEY` | Optional override for the Payment Kit registry operator. |
| `NEXT_PUBLIC_PK_RECEIPTS_ENABLED` | Kill switch for Payment Kit receipts. |
| `TALISE_AUTOSWAP_PACKAGE_ID` / `_LATEST` | Vault + auto-swap Move package ids (original + latest). |
| `TALISE_AUTOSWAP_REGISTRY_ID` / `_V2_ID` | Registry singleton ids (v1 + v7). |
| `RESEND_API_KEY` | Resend client key. Without it, sends no-op. |
| `EMAIL_FROM`, `EMAIL_REPLY_TO` | Default sender + reply-to for welcome emails. |
| `WAITLIST_FROM_EMAIL` | Sender for waitlist confirmation. Must live on a Resend-verified domain. |
| `WAITLIST_BCC_EMAIL` | Optional ops BCC on waitlist confirmations. |
| `ADMIN_TOKEN` | Gates `/api/cron/*` and admin routes. |
| `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe Crypto Onramp. |
| `ZG_DEEPSEEK_V4_PROVIDER_URL`, `ZG_DEEPSEEK_V4_API_KEY` | Chat agent's OpenAI-compatible upstream. |
| `MEMWAL_ACCOUNT_ID`, `MEMWAL_DELEGATE_KEY`, `MEMWAL_SERVER_URL` | Optional persistent agent memory. |

Notes:
- The `.env.example` still mentions `file:./.data/talise.db` for libSQL local dev — this no longer works because the live adapter is Postgres-only. Set a real `DATABASE_URL` in dev too (a local Postgres container is the simplest path).
- `DATABASE_AUTH_TOKEN` is read-but-unused; it's kept so a future libSQL fallback can be flipped back on.
