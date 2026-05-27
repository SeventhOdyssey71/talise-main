# Security fixes (2026-05-27)

Implements P0/P1 items from
[`codebase-audit.md`](./codebase-audit.md). Scope: P0-1, P0-2 (docs
only), P0-3, P1-3, P1-5, P1-6. P1-1 (zkLogin legacy archive) is
explicitly out of scope; owned by a separate agent doing repo cleanup.

## P0-1: Narrow Onara sponsor policy

Status: **shipped**.

- Replaced `targets: ["*"]` in `onara/api/policies/talise.json` with
  module-scoped patterns
  (`__TALISE_PACKAGE_ID__::{send,vault,auto_swap,receipt}::*`).
- Removed `Publish` from `allowedCommandKinds`. Now: `SplitCoins`,
  `MergeCoins`, `TransferObjects`, `MoveCall`.
- Lowered `gasBudgetMax` from `100_000_000` to `20_000_000` MIST
  (~0.02 SUI). Justification in
  `onara/api/policies/index.ts` header comment.
- Added per-request policy resolution
  (`resolveSponsorPolicies(packageId)` in
  `onara/api/policies/index.ts`) so the canonical Move package id is
  substituted from the `TALISE_PACKAGE_ID` Worker binding. Sponsor
  refuses to sign if the binding is unset (safer than wildcard
  fallback).
- Added a per-binding policy cache in `onara/api/src/app.ts`.
- Added negative + positive tests in
  `onara/api/tests/talisePolicy.test.ts`.

Files touched:

- `onara/api/policies/talise.json`
- `onara/api/policies/index.ts`
- `onara/api/src/app.ts`
- `onara/api/wrangler.jsonc`
- `onara/api/tests/talisePolicy.test.ts` (new)

Verification:

- `bun test` from `onara/api/` -> 59 pass / 0 fail (10 new in the
  Talise guardrail file).
- `bunx tsc --noEmit` from `onara/api/` -> clean.

## P0-2: Sponsor mnemonic rotation runbook

Status: **shipped** (docs only, per scope).

- Created `onara/api/SECRETS-ROTATION.md` covering: fresh-key
  generation, `wrangler secret put`, old-key drain, local `.dev.vars`
  scrub (testnet only), shell/backup leak audit, monitoring re-point.
- Added a one-liner pointer in `onara/api/README.md` linking to the
  runbook.
- Did not touch `onara/api/.dev.vars` (out of scope).

Files touched:

- `onara/api/SECRETS-ROTATION.md` (new)
- `onara/api/README.md`

## P0-3: iOS biometric gate

Status: **shipped**.

- Created `ios/Talise/Auth/BiometricGate.swift` with a single entry
  point `requireUserPresence(reason:)`. Uses
  `LAContext.evaluatePolicy(.deviceOwnerAuthentication, ...)` so it
  falls back to passcode automatically when biometrics fail or are
  unavailable. Typed `GateError` for cancel / unavailable / failed.
  No debug bypass.
- Wrapped all four fund-moving sites called out by the audit:
  - `ios/Talise/Features/Send/SendFlowView.swift:98` (send).
  - `ios/Talise/Features/Earn/EarnView.swift:408` (supply).
  - `ios/Talise/Features/Earn/EarnView.swift:746` (withdraw).
  - `ios/Talise/Features/Home/VaultWithdrawSheet.swift:240`
    (vault withdraw).
- Each `reason` string includes the dollar amount + counterparty /
  venue / vault, so the system sheet shows what the user is signing.
- Registered the new file in `ios/Talise.xcodeproj/project.pbxproj`
  (PBXBuildFile + PBXFileReference + Auth group + Sources phase).

Files touched:

- `ios/Talise/Auth/BiometricGate.swift` (new)
- `ios/Talise/Features/Send/SendFlowView.swift`
- `ios/Talise/Features/Earn/EarnView.swift`
- `ios/Talise/Features/Home/VaultWithdrawSheet.swift`
- `ios/Talise.xcodeproj/project.pbxproj`

Verification:

- `xcrun swiftc -parse ios/Talise/Auth/BiometricGate.swift` -> clean.
- `xcodebuild -list -project ios/Talise.xcodeproj` -> still parses,
  scheme `Talise` listed.
- Full Xcode build not run (sandbox simulator runtimes unavailable
  in the env); the audit explicitly notes this is expected and that
  in-Xcode compile is the canonical check.

## P1-3: Invoice paid-state verification

Status: **shipped**.

- `web/app/api/tx/record/route.ts` now ignores client-submitted
  `amount` / `recipient` for invoice payments. Loads invoice
  server-side via `invoiceBySlug`, fetches the digest from chain
  with `suiJsonRpc().getTransactionBlock`, checks:
  1. effects status `success`,
  2. invoice merchant address received USDsui via
     `balanceChanges`,
  3. `merchant USDsui delta >= invoice canonical amount` (in
     u64 micro units).
  Only then calls `markInvoicePaid`. Returns 400 with reason on
  any check failure. Idempotent on already-paid invoices.
- Defensive ALTER added in `lib/db.ts::ensureSchema` for
  `paid_digest TEXT` and `paid_by_address TEXT` on `invoices`
  (the CREATE TABLE already has them on fresh DBs).

Files touched:

- `web/app/api/tx/record/route.ts`
- `web/lib/db.ts`

Verification:

- `pnpm tsc --noEmit` from `web/` -> exit 0.

## P1-5: App Attest enforcement

Status: **partial** (challenge + structural enforcement shipped, full
Apple chain verification deferred).

Shipped:

- `web/lib/app-attest.ts` (new). Stateful one-time challenges with
  5-minute TTL in `app_attest_challenges` table; atomic
  consume-on-first-use; `requireAppAttestStructural` middleware that
  fails mobile traffic missing `X-App-Attest` + `X-App-Attest-KeyId`
  on the three sensitive routes.
- `web/app/api/auth/attest/challenge/route.ts` now persists the
  nonce via `issueAttestChallenge`.
- `web/app/api/auth/attest/register/route.ts` consumes the challenge
  before persisting the attestation. Replay or expired -> 400.
- Enforcement wired into:
  - `web/app/api/zk/sponsor-execute/route.ts`,
  - `web/app/api/tx/record/route.ts`,
  - `web/app/api/onramp/session/route.ts`.
- iOS: `ZkLoginCoordinator.signIn()` now fires
  `AppAttestService.bootstrap` in a detached task immediately
  after the bearer lands in Keychain.

Deferred (documented in `web/TODO-APPATTEST.md`):

- Full Apple attestation chain verification (CBOR decode, X.509
  chain against AppleAppAttestRoot, nonce extension check, RPID
  hash, counter=0, persist credentialPublicKey).
- Per-request assertion signature + counter monotonicity check.
- Env-flag dev/sim bypass for staging.

Why deferred: per the audit's own guidance, "if a fix would take >2x
the others combined, ship the skeleton and document the gap." Full
Apple chain verification has no maintained pure-TS library and is a
focused PR on its own (chain validation + cert pinning + CBOR walk).

Files touched:

- `web/lib/app-attest.ts` (new)
- `web/TODO-APPATTEST.md` (new)
- `web/app/api/auth/attest/challenge/route.ts`
- `web/app/api/auth/attest/register/route.ts`
- `web/app/api/zk/sponsor-execute/route.ts`
- `web/app/api/tx/record/route.ts`
- `web/app/api/onramp/session/route.ts`
- `ios/Talise/Auth/ZkLoginCoordinator.swift`

Verification:

- `pnpm tsc --noEmit` from `web/` -> exit 0.

## P1-6: GPU prover endpoint authentication

Status: **shipped**.

- `web/lib/zksigner.ts::callProver` attaches
  `Authorization: Bearer ${process.env.ZK_PROVER_AUTH_TOKEN}` when
  the env var is set. Public Mysten/Shinami provers ignore unknown
  auth headers, so this is safe to send unconditionally.
- `infra/prover/gpu/deploy.sh`: Caddy block now gates `/input` and
  `/warmup` behind a Bearer match against `${ZK_PROVER_AUTH_TOKEN}`.
  `/healthz` stays public. Deploy script preflights the env var and
  fails fast if it's unset.
- `infra/prover/gpu/smoke.sh` now exercises (a) unauthenticated
  POST `/input` -> expect 401/403, (b) authenticated POST -> expect
  any non-auth status. Also pipes the bearer through the existing
  warmup + real-input checks.
- `docs/generated/codebase/32-infra-gpu-prover.md` documents
  `ZK_PROVER_AUTH_TOKEN` and the dual Vercel + GPU-host requirement.

Note: the audit referenced `scripts/deploy-gpu-prover.sh` and
`scripts/zk-prover-smoke.sh` but those were relocated under
`infra/prover/gpu/` in an earlier cleanup pass. Edits applied at the
current canonical paths.

Files touched:

- `web/lib/zksigner.ts`
- `infra/prover/gpu/deploy.sh`
- `infra/prover/gpu/smoke.sh`
- `docs/generated/codebase/32-infra-gpu-prover.md`

Verification:

- `pnpm tsc --noEmit` from `web/` -> exit 0.
- `bash -n infra/prover/gpu/deploy.sh infra/prover/gpu/smoke.sh` ->
  clean.

## Aggregated verification

| Command | Result |
| --- | --- |
| `bun test` in `onara/api/` | 59 pass / 0 fail |
| `bunx tsc --noEmit` in `onara/api/` | clean |
| `pnpm tsc --noEmit` in `web/` | exit 0 |
| `bash -n` on both GPU prover scripts | clean |
| `xcrun swiftc -parse` on `BiometricGate.swift` | clean |
| `xcodebuild -list -project ios/Talise.xcodeproj` | scheme `Talise` |

## New files created

- `onara/api/SECRETS-ROTATION.md`
- `onara/api/tests/talisePolicy.test.ts`
- `ios/Talise/Auth/BiometricGate.swift`
- `web/lib/app-attest.ts`
- `web/TODO-APPATTEST.md`
- `audits/2026-05-27-security-fixes.md` (this file)
