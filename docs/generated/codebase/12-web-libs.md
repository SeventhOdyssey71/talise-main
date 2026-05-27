# Web Libraries

All server libraries live in `web/lib/`. They are TypeScript modules with no transpile step beyond Next's. Anything that imports `@mysten/sui`, `postgres`, `node:crypto`, or `resend` is server-only by virtue of being imported only from route handlers and RSC pages. Files that absolutely must not be bundled to the client open with `import "server-only";`.

## Core

### `lib/db.ts`

Postgres adapter that preserves the libSQL `execute({sql, args})` shape.

```ts
db().execute({ sql: "SELECT * FROM users WHERE id = ?", args: [id] })
db().batch([{sql, args}, …], "write")  // transactional
ensureSchema(): Promise<void>           // idempotent, memoized
dbHealth(): Promise<{ok, latencyMs, error?}>
```

Internals: a single `postgres()` connection pool (`max: 8`), `?` placeholders rewritten to `$1, $2, …` with quoted-string/comment skipping, `BIGINT` parsed as `number` so timestamp math works inline. `ssl` flips between `false / require / "prefer"` based on the URL's `sslmode` querystring.

Domain helpers exported from the same file: `upsertUser`, `userById`, `userByGoogleSub`, `userByBusinessHandle`, `setAccountType`, `addBusinessProfile`, `realignAddress`, `recordTx`, `userTxs`, `createInvoice`, `invoicesFor`, `invoiceBySlug`, `markInvoicePaid`, `setTaliseVaultId`, `markVaultSubnameRepointed`, `setPaymentRegistry`, `setSpotBalanceManagerId`, `ensureReferralCode`, `attributeReferral`, `userByReferralCode`, `recordRewardsEvent`, `getRewardsSummary`, `markNotified`.

### `lib/session.ts`

Cookie wrappers. All cookies are HMAC-signed via `lib/auth.ts`'s `sign()` / `verify()`.

```ts
setSessionCookie(entryId: number)           // talise_session, 1y
readSessionEntryId(): Promise<number | null>
clearSession()
setStateCookie(state), readStateCookie(), clearStateCookie()
setReferralCookie(code), readReferralCookie(), clearReferralCookie()  // 30d
setReturnTo(path), consumeReturnTo()                                  // 10m
```

### `lib/auth.ts`

OAuth + crypto primitives.

```ts
googleClientId(), googleClientSecret(), googleRedirectUri()
redirectUriFromRequest(req): string             // derives /auth/callback from req host
sign(payload): string                            // payload.b64macsha256
verify(signed): string | null                    // timing-safe
newStateToken(): string                          // 16 random bytes, base64url
buildGoogleAuthUrl(state, redirectUri?): string
exchangeCodeForTokens(code, redirectUri?): { id_token, access_token?, expires_in? }
```

### `lib/zklogin.ts`

Pure zkLogin primitives (no I/O).

```ts
generateSalt(): string                          // 16 random bytes as decimal BigInt
deriveSuiAddress(jwt, salt): string             // jwtToAddress, legacyAddress=false
decodeJwt(jwt): { sub, email, email_verified?, name?, picture?, aud, iss, exp }
```

### `lib/zksigner.ts` (server-only)

The prover routing layer. Mints + caches zk proofs and assembles the final zkLoginSignature.

```ts
setSigningCookie(jwt, salt), readSigningCookie(), clearSigningCookie()
mintZkProof({ ephemeralPubKeyB64, maxEpoch, randomness, jwt?, salt? }): CachedZkProof
assembleZkLoginSignature({ ephemeralPubKeyB64, maxEpoch, randomness, userSignature, cachedProof? }):
  { signature, proof, isFresh }
callProverWithFallback({ inputs, canaryKey })   // honours ZK_PROVER_PRIMARY/FALLBACK/CANARY_PCT
```

Backend selection is driven by env: `ZK_PROVER_PRIMARY ∈ {gpu, shinami, mysten}` (default `shinami`), `ZK_PROVER_FALLBACK` (default `shinami`), `ZK_PROVER_GPU_URL` (URL of our unconfirmedlabs GPU prover), `ZK_PROVER_CANARY_PCT` (0..100, deterministic bucket → GPU regardless of PRIMARY), `ZK_PROVER_TIMEOUT_MS` (default 8000). Every attempt logs a structured line: `[zk-prover] role=primary backend=gpu attempt=1 status=200 ms=412`.

### `lib/zkclient.ts` (client + isomorphic)

Browser-side counterpart. Provisions the ephemeral keypair, computes the nonce, persists to `localStorage` + `sessionStorage`, and drives `signAndSubmit()` (the 2-trip sponsored flow through `/api/zk/sponsor` and `/api/zk/sponsor-execute`). Also exports a kitchen-sink set of PTB builders kept for legacy DeepBook flows: `buildSuiTransfer`, `buildUsdsuiTransfer`, `buildBatchUsdsuiPayroll`, `buildPayAndInvest`, `buildCrossAssetSend`, `buildSpotLPDeposit`, `buildUsdsuiMarginSupply`. New flows hit the prepare endpoints instead.

## Sui + RPC

### `lib/sui.ts`

RPC client config.

```ts
network(): "mainnet" | "testnet"          // from NEXT_PUBLIC_SUI_NETWORK
sui(): SuiGrpcClient                      // canonical client, gRPC, singleton
suiJsonRpc(): SuiJsonRpcClient            // fallback for queries gRPC doesn't yet cover
USDSUI_TYPE, USDSUI_DECIMALS = 6
COIN_TYPES.SUI / USDC / DEEP
suiscanAccountUrl(addr), suiscanTxUrl(digest), suiscanObjectUrl(id)
getSuiBalance(address), getUsdsuiBalance(address), getUsdcBalance(address)
formatSui(mist)
```

gRPC URL is `process.env.SUI_GRPC_URL` (or `NEXT_PUBLIC_SUI_GRPC_URL`) falling back to `fullnode.{mainnet,testnet}.sui.io:443`.

### `lib/sui-graphql.ts`

Sui GraphQL helper used for batched coin metadata reads (e.g. resolving `WAL` / random meme coin symbols + decimals for the activity feed).

### `lib/coins.ts` (server-only)

`getOwnedCoins(address)` — returns deduped coin objects across types. Used by the AutoConvert banner to surface non-USDsui holdings.

### `lib/usdsui.ts`

`USDSUI_TYPE` constant + `isUsdsui(coinType)` predicate.

### `lib/perf-cache.ts`

In-memory `memoTtl(key, ttlMs, () => Promise<T>)` used by Onara status, gas price, and activity scans.

## Sui integrations

### `lib/onara/{index,client,types,errors}.ts`

HTTP client for the Onara gas-sponsor (Cloudflare Worker at `ONARA_URL`). Module-level singleton (`onara()`) so the Node TLS session is reused. Surfaces `status()`, `sponsor()`, `dryRunSponsor()` plus typed policy + response shapes.

### `lib/shinami.ts` (server-only)

JSON-RPC over `https://api.us1.shinami.com/sui/zkwallet/v1` and `…/zkprover/v1`.

```ts
shinamiEnabled(): boolean
shinamiGetWallet(jwt): { address, salt }
shinamiCreateProof({ jwt, maxEpoch, extendedEphemeralPublicKey, jwtRandomness, salt }): ProverResponse
```

Shinami returns the salt as base64 over JSON-RPC; `decodeSalt()` normalizes it to a decimal-string BigInt for `genAddressSeed`.

### `lib/deepbook.ts` + `lib/deepbook-margin.ts`

`deepbook.ts` exposes `getSuiUsdcPrice()` and read helpers used by the home + earn pages.

`deepbook-margin.ts` is the USDsui margin-pool supplier path. `LENDING_POOLS.USDSUI` is the hardcoded mainnet pool id. `fetchSupplierCapId(address)` filters owned objects by `SUPPLIER_CAP_TYPE` (anchored to the original v1 package id so type matching survives upgrades). `buildSupplyUsdsuiMargin(...)` and `fetchUsdsuiMarginApy()` round it out. Uses `@mysten/deepbook-v3`.

### `lib/navi-supply.ts` (server-only)

NAVI USDsui supply / withdraw via `@t2000/sdk`'s `NaviAdapter`. Initialised lazily (`_adapterReady`) and reused. The supply builder uses `coinWithBalance({ useGasCoin: false })` so it never touches the sponsor-owned gas coin.

```ts
appendNaviSupply(tx, senderAddress, amountUsdsui)
appendNaviWithdraw(tx, senderAddress, amountUsdsui)
```

### `lib/vault.ts`

Builders for `talise::vault` and `talise::auto_swap` PTBs.

```ts
vaultPackageIds(): VaultPackageIds   // throws VaultNotDeployedError if env missing
buildCreateVaultTx({ senderAddress }): Transaction
buildEnableAutoSwapTx({ senderAddress, vaultId, sourceType }): Transaction
buildAutoSwapSweepTx(...), buildUpdateBoundsTx(...), buildPauseTx(...),
buildMigrateBundleTx(...), buildRepointSubnameTx(...), …
```

Reads `TALISE_AUTOSWAP_PACKAGE_ID`, `TALISE_AUTOSWAP_PACKAGE_LATEST`, `TALISE_AUTOSWAP_REGISTRY_ID`, `TALISE_AUTOSWAP_REGISTRY_V2_ID`.

### `lib/payment-kit.ts` + `lib/intents/wrap-payment-kit.ts`

Talise wraps every user-facing transfer in a `processRegistryPayment` MoveCall against the global `talise` PaymentRegistry. The wrapper takes the user's USDsui via `coinWithBalance`, transfers to the receiver, and mints a `PaymentRecord<…>` whose nonce encodes a typed memo (`kind`, `venue`, `sender`, `receiver`, optional roundup). `lib/activity.ts` later parses the nonce to classify activity rows. `appendPaymentKitReceipt(tx, …)` is the entry point used by `/api/send/prepare`.

### `lib/pk-bootstrap.ts` (server-only)

`ensurePaymentRegistry()` lazily mints the registry on chain the first time it's needed, memoizes the id, persists via `setPaymentRegistry`. Called from `/api/zk/sponsor` and `/api/zk/warmup`.

### `lib/suins.ts`, `lib/suins-lookup.ts`, `lib/suins-operator.ts` (server-only)

- `suins.ts` is the recipient resolver: parses `alice`, `alice@talise`, `alice.talise.sui`, `0x…`, falls back to `alice.sui`.
- `suins-lookup.ts` does owner → subname lookups (`findTaliseSubnameForOwner`) and stale-target detection.
- `suins-operator.ts` builds the operator-signing client that mints `<name>.talise.sui` subnames. Reads `TALISE_SUINS_OPERATOR_KEY`, `TALISE_SUI_NFT_ID`, `TALISE_SUI_EXPIRY_MS`.

### `lib/handle.ts`

Pure (isomorphic) helpers: `USERNAME_RE = /^[a-z0-9_]{3,20}$/`, `RESERVED_USERNAMES`, `normalizeHandle`, `formatHandle`, `formatHandleFull`, `isHexAddress`.

### `lib/intents.ts` + `lib/intents/wrap-payment-kit.ts`

Intent inference: turns "I want to send X" into a typed action (plain send, cross-asset, supply, withdraw). Used by the chat agent.

### `lib/activity.ts` (server-only)

The on-chain activity feed. Queries `suix_queryTransactionBlocks` twice (FromAddress + ToAddress), parses `balanceChanges`, classifies each tx in this order:
1. Payment Kit `PaymentRecord` lookup (authoritative).
2. MoveCall package heuristic for pre-PK txs.
3. Plain transfer via balance delta sign.

Exports `getRecentActivity(address, limit, opts?)` returning `ActivityEntry[]`. Compound spend+save and non-USDsui coin movements are flagged on each entry. Used by `/api/activity`, `/home`, `/rewards`.

### `lib/yield.ts` (server-only)

`getEarnSnapshot(address)` → supplied USDsui, current APY, daily yield, pending interest. Reads NAVI + DeepBook margin in parallel.

### `lib/fx.ts`

Hardcoded Q2 2026 FX snapshot (NGN, KES, GHS, ZAR, USD). `usdcToLocal`, `formatLocal`, `SYMBOL`, `FX`. Pure, isomorphic. Marked TODO: replace with a live feed.

### `lib/format.ts`

Generic display helpers (`shortAddress(addr, head=6, tail=4)`, etc.).

## Email

### `lib/email.ts`

Resend client wrapper.

```ts
sendWelcomeWithAddress(to, data)
sendWelcomeEmailOnly(to, position)
sendWaitlistConfirmation({ to, name? })   // uses emails/WaitlistConfirmation.tsx
```

Without `RESEND_API_KEY` it logs and returns `{ok: true, id: "dev-noop"}` so dev flows aren't blocked.

### `lib/emails/welcome.ts`

String-template HTML for the welcome email (not React Email). Used by `sendWelcomeWithAddress` + `sendWelcomeEmailOnly`.

## Rewards subsystem

`lib/rewards/{catalogue,earn,goals,insights,redeem,roundup}.ts` plus `lib/rewards.ts` + `lib/rewards-constants.ts`. `awardForTx({userId, kind, amountUsd, venue?, roundupUsd?})` is the entry point used by `/api/zk/sponsor-execute` to credit points + bump lifetime aggregates. `getRoundupConfig(userId)` reads the user's roundup enabled flag + percentage and is consulted by `/api/send/prepare` to optionally append a NAVI supply leg to the send PTB.

## Chat agent

`lib/chat/system.ts` holds the system prompt. `lib/chat/intent.ts` parses user intent. `lib/chat/ai.ts` is the OpenAI-compatible client pointed at the 0G Compute DeepSeek V4 proxy (`ZG_DEEPSEEK_V4_PROVIDER_URL` + `ZG_DEEPSEEK_V4_API_KEY`). Optional Memwal persistent memory wires through if `MEMWAL_*` env vars are set.

## Mobile

### `lib/mobile-sessions.ts`

iOS bearer-token sessions. SHA-256 of the token is the primary key (we never store the plaintext). Each row carries the user's JWT + salt + (ephemeralPubKey, maxEpoch, randomness) so the prover can mint proofs without a cookie. 24h TTL.

```ts
issueMobileBearer(userId, { jwt, salt, ephemeralPubKeyB64?, maxEpoch?, randomness? }): string
readEntryIdFromRequest(req): Promise<number | null>   // cookie OR Bearer
isMobileRequest(req): boolean
mobileSigningContext(userId): { jwt, salt }
```

## Server-only vs isomorphic

| Marked `import "server-only";` | Isomorphic (no I/O) |
|---|---|
| activity, coins, rewards, pk-bootstrap, intents, shinami, navi-supply, suins, rewards-constants, suins-lookup, sui-graphql, yield, suins-operator, usdsui, t2000, zksigner | handle, format, fx, zklogin, usdsui (re-exports only), session-helpers (server runtime but no `server-only` marker) |

Anything not in the left column but that imports `next/headers`, `node:crypto`, or `postgres` is still effectively server-only via the dependency graph.
