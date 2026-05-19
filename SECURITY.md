# Talise — security audit (2026-05-19)

Honest assessment of every attack surface in the codebase today. The bar is *"this is a real consumer payments app on mainnet."* Findings are ranked by exploitability + impact.

## ✅ What's already solid

### Authentication & session
- Session cookies are **HMAC-signed** via `lib/auth.ts::sign/verify` using `SESSION_SECRET`. Tamper-proof.
- Cookie flags: `httpOnly: true`, `sameSite: "lax"`, `secure: NODE_ENV === "production"`. ✓
- Three signed cookies in play, each with appropriate TTL:
  - `talise_state` (CSRF state for OAuth) — 5 min
  - `talise_sess` (user id) — 1 year
  - `talise_jwt` (Google id_token + Shinami salt) — 1 hour (matches JWT lifetime)
  - `talise_ref` (referral code) — 30 days
- OAuth state validated against cookie before processing callback.
- `audience` claim on the Google id_token verified against `GOOGLE_CLIENT_ID`.
- `email_verified` claim checked.
- 19 API routes inventoried. **17 authenticate via session.** Two intentional exceptions (`/api/auth/state`, `/api/auth/return-to`) are pre-auth OAuth bootstrap. Three read-only public probes (`/api/sui/epoch`, `/api/username/check`, `/api/recipient/resolve`) are fine open.

### Secret isolation
- No server-only secret leaks through `NEXT_PUBLIC_*` (only `NEXT_PUBLIC_SPONSOR_ENABLED` which is a feature flag).
- The high-value keys all live server-only in env files that `.gitignore` excludes:
  - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
  - `SHINAMI_API_KEY`
  - `TALISE_SUINS_OPERATOR_KEY`
  - `SESSION_SECRET`, `ADMIN_TOKEN`
  - `GOOGLE_CLIENT_SECRET`
- The sponsor wallet mnemonic is in `onara/api/.dev.vars` (also gitignored).
- Operator + sponsor private keys also cached in `.secrets/talise-suins-operator.txt` for recovery — that whole directory is gitignored.
- Initial commit + every subsequent commit was verified against a literal-string grep for known secret tokens before push.

### Database hygiene
- All SQL goes through libSQL's parameterized `args` array. **No string concatenation, no SQL injection vector.**
- The schema uses appropriate UNIQUE constraints (`google_sub`, `sui_address`, `business_handle`, `talise_username`, `referral_code`, `tx_history.digest`).
- Race-safe migrations: `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE` wrapped in try/catch, `CREATE UNIQUE INDEX IF NOT EXISTS`.

### zkLogin
- The Google id_token + Shinami salt never leave the server — they're stored in the `talise_jwt` httpOnly signed cookie.
- The ephemeral private key lives only in browser `localStorage` with a 55-min TTL matching the Google JWT.
- Proofs are anchored on chain via `genAddressSeed(salt, "sub", sub, aud)` — only the legitimate Google account can produce a valid zkLogin signature for a given Sui address.
- The Mysten mainnet prover is bypassed (audience whitelist) by routing through Shinami; we still get a real zkLogin proof under our user's exact address.

### Sponsored gas
- The Onara sponsor private key is held only in the Onara worker (Cloudflare-Workers process), never in the web tier.
- Onara enforces a per-PTB policy: `gasBudgetMax: 0.1 SUI`, `maxCommands: 50`, allowed command kinds, must include a MoveCall. A malicious or buggy client cannot drain the wallet in a single tx — only via repeated tx (see "Open issues" below).
- The PTBs we send always set the user as `sender` and Onara's address as `gasOwner`; a sponsored signature is only valid for that exact byte string, so it can't be replayed.

### SuiNS
- Subname mints transfer the resulting NFT to the user, not to us. **The user owns their handle.** Talise can't seize or rename it.
- `setTargetAddress` is called in the same PTB as the mint so the name resolves immediately.
- `/api/username/claim` checks both DB (none — we don't keep one) AND chain for existing user subnames before minting another. Server-enforced one-handle-per-user.

### Stripe
- `STRIPE_SECRET_KEY` server-only.
- The webhook route verifies the Stripe signature with `STRIPE_WEBHOOK_SECRET` + 300s replay window.
- The `wallet_addresses[sui]` field is locked to the authenticated user's `sui_address` (`lock_wallet_address: true`). A logged-in user can only ramp into their own address.

### Input validation (this audit's PR)
- `/api/tx/record` now validates:
  - `digest` matches Sui base58 shape (40-60 chars from the base58 alphabet)
  - `kind` is one of 10 allowed labels
  - `asset` is one of the known stable/SUI symbols
  - `recipient` and `receiptObjectId` match `0x + 64 hex`
  - `amount` is a numeric string capped at 64 chars
  - `invoiceSlug` matches `[a-z0-9_-]{1,64}`
  - `memo` is sliced to 200 chars
  Each invalid field returns 400 with a clear reason.

---

## ⚠️ Open issues, ranked

### 1. **Rate limiting is non-existent.** Real risk for production.
Every authenticated endpoint can be called in a tight loop by a logged-in user. Concrete impact:
- `/api/zk/sponsor` + `/api/zk/sponsor-execute` — could drain the sponsor wallet (0.005 SUI/tx — at scale, weeks of throughput in minutes)
- `/api/onramp/session` — could spam Stripe API (cost: API throttling)
- `/api/username/claim` — costs ~0.0067 SUI per attempt (operator wallet)
- `/api/t2000/execute` — Cetus swap fees + sponsor gas
- `/api/sign` — Shinami's 2 proofs/min/address limit is a natural backstop, but a user can still spam our route

**Fix path:** add a `rate_limits(user_id, endpoint, window_start_ms, count)` table and a small middleware that throttles per-user. Or upstream this to Cloudflare (`@upstash/ratelimit` on KV is one-file). Either way, ~30 min to ship.

### 2. **No CSRF token on state-changing routes other than OAuth.**
We rely on the session cookie's `sameSite: "lax"` and the fact that all writes are POST with JSON content-type. That blocks the simple form-submit CSRF, but doesn't protect against a future API token leak. For a v1 consumer app this is industry-standard, but if we ever issue API keys, we'll need explicit CSRF tokens or `Origin` checks.

**Fix path:** add an `Origin`/`Referer` allow-list check on every state-changing route. ~15 min.

### 3. **`ADMIN_TOKEN` is set in env but not consumed anywhere.**
Dead config. Either wire it for admin endpoints (export waitlist, refund a tx, etc.) or remove it from `.env.example` to avoid confusion.

**Fix path:** remove from env templates if we're not going to use it.

### 4. **/api/t2000/execute accepts the user's ephemeral private key in the POST body.**
The key is one-shot (55-min TTL) and transmitted over same-origin TLS, so the practical risk is low. Belt-and-suspenders fixes:
- Compute the pub key from the posted private key server-side and compare against the JWT's nonce-anchored pub key. Refuse mismatches.
- For v2, run T2000 fully in the browser via `@t2000/sdk/browser` and skip the server roundtrip entirely.

Comment is in the route already; not a critical bug, just an architecture target.

### 5. **No tx_history audit against chain.**
We record outbound txs from client POSTs (`/api/tx/record`). The chain is the truth — `lib/activity.ts` reads it directly for the home Activity feed — but the local table can drift. Not exploitable (a fake row only confuses the user who wrote it), but UI inconsistencies are likely.

**Fix path:** treat `tx_history` as a hint-cache only; render activity from `lib/activity.ts` everywhere. Already done on `/home`; still to do on receipts/invoices.

### 6. **Operator/sponsor key compromise blast radius.**
- Sponsor key compromise → attacker can drain the wallet (0.13 SUI today). Mitigate: keep balance low; top up on demand; rotate the mnemonic if leaked.
- Operator key compromise → attacker can mint subnames on behalf of users (annoyance, not theft). The talise.sui parent NFT itself is also in this wallet — attacker could transfer it elsewhere. Mitigate: ideally move the parent NFT to cold storage and only hold a SubdomainCap in the hot wallet, but SuiNS doesn't ship that pattern. Acceptable risk for v1.

### 7. **CORS is wide open.**
`/api/*` routes have no CORS headers; Next.js defaults to allowing any origin. Combined with `sameSite: lax` cookies this is mostly safe (cookies don't get sent on cross-site requests), but explicit `Access-Control-Allow-Origin` allow-listing would be cleaner.

### 8. **Receipt object IDs not verified against the on-chain object.**
`/api/tx/record` accepts a `receiptObjectId` field and stores it. A malicious caller could submit a real-looking but unrelated object id. Low-impact (only shows up in the user's own invoice list with a broken Suiscan link), but a server-side `getObject(receiptObjectId)` verification would close the gap.

### 9. **No structured audit log.**
We have `console.warn` for some failures. There's no append-only "what happened, who, when" trail. For a payments product that wants compliance/insurance one day, this is on the v2 roadmap.

### 10. **No automated test coverage.**
TypeScript catches the worst — but we have no integration tests, no e2e, no unit tests. Every fix has been verified manually + via `pnpm exec tsc --noEmit`. A test suite is on the v2 roadmap.

---

## Hardening checklist (priority order)

- [x] Gate `/api/debug/deepbook` behind `NODE_ENV !== "production"` (done in this audit)
- [x] Validate `/api/tx/record` body fields, length-cap everything (done in this audit)
- [ ] Rate-limit table + middleware on sponsor/onramp/claim/execute
- [ ] `Origin` allow-list on state-changing routes
- [ ] Verify `receiptObjectId` on chain before storing
- [ ] Remove `ADMIN_TOKEN` from `.env.example` if we're not using it
- [ ] Add explicit CORS headers to `/api/*` (allow-list our origin only)
- [ ] Move SuiNS parent NFT to cold storage (move once we deploy to a real server)
- [ ] Integration test for the full sign-in → claim → send round trip

## What the user can do to harden their own account
- Sign in / sign out flow uses `/auth/logout` which clears all server-side cookies.
- Closing all browser tabs after 55 minutes of inactivity wipes the ephemeral key (storage TTL).
- Subname NFTs are owned by the user's Sui address; transferring them anywhere else is a one-tap operation in any Sui wallet.

## Threat model summary

| Adversary | Best attack | Today's defense |
|---|---|---|
| Random internet | Try `/api/*` without auth | Session cookie required; routes 401 |
| Logged-in user, naive abuse | Loop `/api/zk/sponsor` to drain sponsor | Onara policy caps per-tx; no per-user rate limit yet |
| Logged-in user, sophisticated | Tamper with `tx_history`, fake digests | Field-level validation; chain is the truth |
| Stolen session cookie | Send money as the user | Requires browser's ephemeral key too (browser-only, 55 min TTL); if both stolen → real funds lost. Same as any web wallet. |
| Compromised sponsor key | Drain Onara wallet | Keep balance low; monitor; rotate |
| Compromised operator key | Mint malicious subnames | Limited blast radius; ops-time rotation |
| Compromised Shinami account | Generate proofs for arbitrary users? | No — Shinami's salt is derived from the JWT `sub`. Without a valid Google JWT for the target, Shinami can't proof. |

Honest take: **for a consumer payments app this is a respectable starting line.** Rate limiting + explicit Origin checks are the highest-leverage hardening to add next.
