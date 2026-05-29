# Talise Web Security Audit

_Last reviewed: 2026-05-28_
_Scope: `web/` (Next.js App Router on Vercel). iOS client and Move modules are out of scope for this pass._

## 1. Auth model

Talise web has two parallel session systems sharing one user table:

- **Web**: cookie-based session (`talise_session`, HMAC-signed, `httpOnly`,
  `sameSite=lax`). Established by the standard Google OAuth code-exchange
  flow (`/api/auth/callback`).
- **Mobile**: opaque bearer token issued by `/api/auth/mobile/exchange`.
  Money-moving routes additionally require a structural App Attest
  assertion (`requireAppAttestStructural`), proving the caller is a real
  build of the Talise iOS binary on a non-jailbroken device. The
  assertion is verified server-side against Apple's attestation chain.

Both paths converge on `readEntryIdFromRequest`, which resolves a numeric
`user.id`. Downstream routes never trust client-supplied user ids.

## 2. CRITICAL — launch-blocker

> **`TALISE_APP_ATTEST_REQUIRED=0` is currently set on Vercel production.**

This env var was flipped to `0` during the iOS simulator + TestFlight
push so internal builds without a real DeviceCheck token could still hit
`/api/zk/sponsor-execute`. While that flag is `0`, **any caller with a
stolen bearer token can move funds without proving they hold a genuine
Talise iOS binary**.

- **Owner**: platform
- **Action**: set `TALISE_APP_ATTEST_REQUIRED=1` on prod before the public
  launch lands. Verify the staging build still completes a send round-trip
  with attestation on. Revoke any leaked bearers from the same deploy.
- **Detection**: every `/api/zk/sponsor-execute` log line should show a
  non-empty assertion id once this flips. Add a smoke alert.

This is P0 #1 below.

## 3. OWASP Top 10 (2021) coverage

| #   | Category                                    | Status   | Remark                                                                                                                            |
| --- | ------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| A01 | Broken Access Control                       | Partial  | Bearer + cookie checks are consistent; needs a route-level audit for admin-only handlers (`/api/cron/*`, `/api/debug/*`).         |
| A02 | Cryptographic Failures                      | Yes      | HMAC-signed cookies, TLS-only via HSTS, zkLogin proofs never leave the server in raw form. Salt fetched from Shinami on mainnet.  |
| A03 | Injection                                   | Yes      | All DB queries use parameterized `db().execute({ sql, args })`. No string interpolation observed in the audited routes.           |
| A04 | Insecure Design                             | Partial  | Sponsor execute trusts client `meta.kind` enum but caps `amountUsd` and validates against a closed set. Reviewed and acceptable.  |
| A05 | Security Misconfiguration                   | Partial  | `TALISE_APP_ATTEST_REQUIRED=0` on prod (see Section 2). Headers now applied via `middleware.ts`. CSP still missing.               |
| A06 | Vulnerable & Outdated Components            | Partial  | No `pnpm audit` in CI. Next, Resend, Shinami SDKs pinned but not auto-bumped. Backlogged for P1.                                   |
| A07 | Identification & Authentication Failures    | Yes      | OAuth nonce is the canonical zkLogin Poseidon hash, bound to ephemeral pubkey + maxEpoch + randomness. Replay window is one epoch. |
| A08 | Software & Data Integrity Failures          | Partial  | iOS verifies App Attest, but server flag (Section 2) currently bypasses. PTBs are signed client-side; server never edits bytes.   |
| A09 | Security Logging & Monitoring               | Partial  | Structured `console.warn` at every error path; no centralized SIEM. Vercel log drains are off.                                    |
| A10 | Server-Side Request Forgery                 | Yes      | Outbound calls hit fixed allowlisted hosts (Shinami, Onara, Resend, Sui RPC). No user-controlled URL fetch in audited routes.     |

## 4. Rate-limit rollout

### Shipped in this pass (4 routes)

| Route                          | Key        | Limit            | Rationale                                                       |
| ------------------------------ | ---------- | ---------------- | --------------------------------------------------------------- |
| `/api/auth/mobile/exchange`    | IP         | 5 / 60s          | Each call mints a zkLogin proof — burns Shinami quota.          |
| `/api/auth/mobile/start`       | IP         | 10 / 60s         | Looser to tolerate restart-after-OAuth-error UX.                |
| `/api/zk/sponsor-execute`      | user id    | 30 / 3600s       | Money-moving. Throttles a compromised bearer to ≤30 txs/hour.   |
| `/api/waitlist`                | IP         | 10 / 60s         | Owned by the waitlist route author; uses the same helper.       |

Backed by `web/lib/rate-limit.ts` — single in-process Map. Upgrade path to
Upstash Redis is documented inline at the top of that file.

### Backlog — next 8 routes (P1)

1. `/api/zk/sponsor` — sponsor request before execute.
2. `/api/send/prepare` — expensive PTB build.
3. `/api/onramp/quote`
4. `/api/onramp/create-session`
5. `/api/offramp/quote`
6. `/api/username/claim` — handle squatting defense.
7. `/api/auth/callback` — web OAuth landing (CSRF-style abuse).
8. `/api/contacts/lookup` — PII enumeration vector.

Same TODO list appears at the top of `web/lib/rate-limit.ts` so it stays
in sync.

## 5. P0 hardening (top 5)

1. **Re-enable App Attest in prod.** Flip `TALISE_APP_ATTEST_REQUIRED=1`
   on Vercel production. Verify TestFlight + sim still pass with the
   testing override path (header). See Section 2.
2. **Rotate any bearer that was minted while App Attest was off.** Bump
   the `MOBILE_BEARER_SECRET` env var — invalidates all current mobile
   sessions and forces a fresh sign-in under attestation.
3. **Lock down `/api/debug/*` and `/api/cron/*`.** Require a static
   `x-talise-admin` token (already used elsewhere) and assert it on every
   handler in those trees. Today some handlers ship without the check.
4. **Add `pnpm audit --prod` to CI.** Block builds on `high`+ findings.
   We currently have no automated dependency scan.
5. **Ship the rate-limit guards on the 4 routes above (done in this
   pass).** Keeps a compromised bearer from chain-broadcasting more than
   30 sponsored txs/hour.

## 6. P1 backlog (top 5)

1. **CSP.** Land a strict Content-Security-Policy in `middleware.ts`.
   Requires per-route audit of inline scripts/styles, third-party
   iframes (onramp/offramp), and Next.js Script bootstrap hashes.
2. **Upstash Redis migration.** Replace the in-process Map in
   `rate-limit.ts` with `@upstash/redis`. Required before we cross
   multi-region serverless; in-process state diverges per lambda.
3. **Secrets rotation cadence.** Document + automate quarterly rotation
   for `SESSION_SECRET`, `MOBILE_BEARER_SECRET`, Shinami keys, Resend
   keys, and Turso DB tokens. None of these rotate today.
4. **Extend rate limits to the 8 backlog routes** (see Section 4).
5. **Structured logging + SIEM.** Forward Vercel logs to a queryable
   sink (Axiom / Datadog) and add alerts on `429`, `401` spikes,
   App Attest failures.
