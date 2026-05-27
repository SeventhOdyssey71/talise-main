# Talise Codebase Audit

Date: 2026-05-27
Scope: `/Users/eromonseleodigie/Talise`, commit `d1e6f37`, dirty worktree present before this report.
Goal: Understand the full product/codebase, use parallel subagents, and produce a structured audit plus folder-organization plan without changing application code.

## Working Checklist

| Item | Status | Notes |
| --- | --- | --- |
| Map repository modules and docs | Verified | Root app map, `docs/codebase/`, iOS, web, Move, Onara, zkLogin, prover reviewed. |
| Run parallel subagent review | Verified | Four subagents covered iOS, web/API, Move/Onara, infra/docs. |
| Verify major build/test surfaces | Verified | Web typecheck/build, Move tests, Onara tests/typechecks, script syntax checks, Xcode project listing attempted. |
| Identify folder organization plan | Verified | Proposed target structure and staged cleanup below. |
| Avoid application code edits | Verified | Only this audit report was added. Generated build output may exist from verification. |

## Executive Summary

- Overall status: High Risk for production money movement until sponsor policy, invoice verification, iOS signing consent, and App Attest are hardened.
- Product shape: Talise is a Sui payments app for diaspora/remittance-style flows. Web is the active production surface, iOS is a native client track, Move owns vault/receipt/auto-swap rules, and Onara sponsors gas / runs executor paths.
- Top risks:
  - Onara's active policy is effectively allow-all gas sponsorship if deployed as-is.
  - iOS fund-moving calls are not gated by runtime biometric/user-presence confirmation.
  - Invoice paid-state can be marked from client-submitted metadata without on-chain verification.
  - App Attest is documented as a security boundary but is not fully wired or verified.
  - Legacy `zklogin/` bridge/reference code is stale and unsafe to treat as current.
- What is strong:
  - Move v7 has solid owner checks, hot-potato `SwapTicket`, worker role checks, pause, per-day throttles, and destination allowlists.
  - Web typechecking and production build pass.
  - Onara policy engine has meaningful test coverage and can enforce tighter policies than the current active config.
  - `docs/codebase/` is a strong generated map, with reconciliation notes already identifying some drift.

## Codebase Map

| Area | Current path | Role |
| --- | --- | --- |
| Product/docs | `README.md`, `BRIEF.md`, `STRATEGY.md`, `FLOWS.md`, `docs/`, `docs/codebase/` | Product narrative, architecture, generated codebase map, ops plans. |
| Web app/API | `web/` | Next.js 15 App Router, marketing pages, authenticated app, API routes, auth, zkLogin, Sui integrations, DB adapter. |
| iOS app | `ios/Talise/` | SwiftUI native client, zkLogin coordinator, Keychain stores, App Attest client, Send/Earn/Home/Rewards/Profile. |
| Move package | `move/talise/` | Sui Move modules: `vault`, `auto_swap`, `receipt`, `send`, tests. |
| Sponsor service | `onara/api/` | Cloudflare Worker/Hono gas sponsor and auto-swap executor. |
| Sponsor SDK | `onara/sdk/` | Client wrapper for Onara status/policies/sponsor APIs. |
| zkLogin legacy/reference | `zklogin/` | Older bridge and iOS reference code. It does not match the current app flow. |
| Prover/ops | `prover/`, `scripts/`, `docs/ZKLOGIN-*`, `docs/GPU-*` | CPU/GPU prover deployment and smoke-test material. |
| Research | `research/` | Market and standup notes. |

## Scorecard

| Area | Score | Rationale |
| --- | ---: | --- |
| Product Trust | 3/5 | Strong payment story and receipts, but invoice paid-state and risk/confirmation boundaries need hardening. |
| iOS Architecture | 3/5 | Clean app/session/network roots, but no test target, large feature files, stale docs, and missing signing gate. |
| Web/API Reliability | 3/5 | Typecheck/build pass and many typed routes, but auth/rate/verification boundaries are inconsistent. |
| Move Safety | 4/5 | 66 passing tests and strong v7 controls; slippage/provider controls remain off-chain or audit-only. |
| Onara/Sponsor Safety | 2/5 | Policy engine is strong, active Talise policy/config is too broad for production. |
| Security/Privacy | 2/5 | Keychain/session work is solid, but App Attest, rate limits, GPU prover auth, and iOS biometric consent are incomplete. |
| Testing/Release | 2/5 | Move and Onara tests pass; web has no real lint config; iOS has no tests; repo has no CI workflow. |
| Docs/Folder Hygiene | 3/5 | Generated docs are useful, but canonical docs conflict with code and legacy folders are not clearly archived. |

## Findings

### P0 Critical

#### P0-1. Active Onara sponsor policy is too broad for production

- Status: Open
- Evidence: `onara/api/policies/talise.json:4-14` sets `gasBudgetMax` to `100000000`, `targets` to `["*"]`, and allows broad command kinds including `Publish`. `onara/api/src/app.ts:47` applies public CORS and `onara/api/src/app.ts:220` exposes `POST /sponsor`. The policy validator checks sender/gas owner and MoveCall targets, but broad command kinds can still ride with any matching policy surface (`onara/api/src/policy.ts:763-860`).
- Impact: If this is deployed with a funded sponsor key, an attacker can consume sponsor gas for arbitrary transactions within the per-tx gas cap. With `Publish` allowed, the sponsor may pay for unrelated package publishing or expensive transaction shapes.
- Remediation: Replace `targets: ["*"]` with exact Talise package/module/function targets or sequence policies. Remove `Publish` from `allowedCommandKinds`. Add per-user/per-IP rate limits, origin or service-token auth between Vercel and Onara, low-balance sponsor operations, alerts, and negative tests proving arbitrary transactions are denied.
- Verification: Add policy tests that attempt non-Talise MoveCalls, `Publish`, high command count, and arbitrary package targets and expect denial.

#### P0-2. A local mainnet sponsor mnemonic exists in an ignored file

- Status: Open
- Evidence: `onara/api/.dev.vars` exists locally, is ignored by git, and contains `SUI_NETWORK=mainnet` plus a `SUI_MNEMONIC` entry. `git check-ignore -v onara/api/.dev.vars` confirms it is ignored.
- Impact: It is not committed, but any real/funded mnemonic present on a developer machine should be treated as exposed if the machine, shell history, backups, or logs are compromised. Combined with the broad sponsor policy, blast radius is higher.
- Remediation: If this key has ever held production funds, rotate it. Keep only non-production test keys in local `.dev.vars`; put production sponsor secrets only in Cloudflare secret storage; keep balances low and monitor.
- Verification: Confirm current production sponsor address after rotation and verify the old address has no active operational role or funds.

#### P0-3. iOS fund-moving actions lack a runtime biometric/user-presence gate

- Status: Open
- Evidence: iOS fund-moving handlers call `signAndSubmit` directly from UI flows such as `ios/Talise/Features/Send/SendFlowView.swift:98`, `ios/Talise/Features/Earn/EarnView.swift:408`, `ios/Talise/Features/Earn/EarnView.swift:746`, and `ios/Talise/Features/Home/VaultWithdrawSheet.swift:240`. The iOS subagent found no `LocalAuthentication`, `LAContext`, or `evaluatePolicy` usage. This conflicts with `ios/README.md:68` and `ios/PLAN.md:46` security claims.
- Impact: A live bearer plus unlocked app/device can initiate signatures without a fresh user-presence check. For a payments app, that is a trust and fraud boundary, not just UX polish.
- Remediation: Wrap every fund-moving `signAndSubmit` path behind a shared transaction confirmation service that performs `LAContext.evaluatePolicy`, displays amount/asset/network/counterparty/fees, and only then signs. Make bypasses debug-only and impossible in release builds.
- Verification: Add UI/unit tests around Send, Earn supply, Withdraw, and Vault withdraw proving cancellation prevents signing.

### P1 High

#### P1-1. Legacy `zklogin/bridge` can sponsor gas without auth if exposed

- Status: Open
- Evidence: `zklogin/bridge/server.js:57-63` sets `Access-Control-Allow-Origin: *`. `zklogin/bridge/server.js:231-275` exposes `/sponsor` with no auth, rate limit, target allowlist, or per-user budget. `zklogin/bridge/sponsor-key.example.txt:60-61` explicitly warns that the bridge has no rate limiting or fraud checks. `npm --prefix zklogin/bridge ls --depth=0` currently fails because dependencies are not installed.
- Impact: If someone deploys this bridge or treats it as current implementation, it can drain sponsor gas and bypass the modern Onara policy boundary.
- Remediation: Move `zklogin/` under an archive/reference folder or update it to match current auth/signing rules. If kept runnable, add auth, rate limits, policy enforcement, and clear README warnings that it is not production.
- Verification: Negative `/sponsor` tests should fail without auth and fail for non-Talise transaction kinds.

#### P1-2. Public Onara auto-swap route can run legacy v1 swaps with caller-chosen inputs

- Status: Open
- Evidence: `onara/api/src/autoSwap.ts:95-128` accepts caller-supplied `vaultId`, `capId`, `sourceType`, `destType`, package IDs, registry IDs, and defaults `capVersion` to `v1`. The handler signs directly with the Onara key at `onara/api/src/autoSwap.ts:484-522`. Legacy v1 validation checks admin/cap/amount, while v1 deposit-to-owner lacks the v7 destination allowlist.
- Impact: If public and reachable, an attacker can attempt legacy-cap auto-swap execution with caller-selected routing material. v7 is much safer, but the handler still preserves v1 behavior by default.
- Remediation: Require internal service auth for executor routes. Force `capVersion: "v2"` for production. Pin canonical package/registry/destination values server-side from env, not request body. Disable or isolate legacy v1 support.
- Verification: Add integration tests that public requests without internal auth fail and that v1 is rejected in production config.

#### P1-3. Invoice paid-state can be forged or underpaid

- Status: Open
- Evidence: The public merchant page accepts `amount` and `invoice` from query params (`web/app/p/[handle]/page.tsx:19-27`, `:70-77`). `/api/tx/record` validates only shapes, records the client-submitted digest, and calls `markInvoicePaid` when `invoiceSlug` is present (`web/app/api/tx/record/route.ts:73-164`). `markInvoicePaid` updates by `slug` and `status` only (`web/lib/db.ts:943-953`).
- Impact: A payer can make an invoice look paid with a valid-looking digest or wrong amount/recipient. This harms merchant trust and makes receipt/invoice state non-auditable.
- Remediation: Load invoice server-side by slug, ignore client amount for invoice payments, build the PTB from the invoice's canonical amount/merchant, and verify the digest/PaymentRecord on-chain before marking paid.
- Verification: Add an integration test where a mismatched digest/amount/recipient cannot close the invoice.

#### P1-4. Mobile exchange accepts user-submitted JWTs without signature verification and loses binding data

- Status: Open
- Evidence: `web/app/api/auth/mobile/exchange/route.ts:58-83` decodes and sanity-checks the submitted ID token, but `web/lib/zklogin.ts:27-30` says `decodeJwt` is non-verifying and only safe for JWTs exchanged by the server. The route pre-mints with `ephemeralPubKeyB64`, `maxEpoch`, and `jwtRandomness` (`route.ts:131-141`) but issues the bearer with only `jwt` and `salt` (`route.ts:146-149`). `/api/zk/sponsor-execute` rejects mobile sessions missing stored binding data (`web/app/api/zk/sponsor-execute/route.ts:119-132`).
- Impact: This alternate mobile sign-in path is both weaker than the backend-mediated OAuth path and likely to produce unusable mobile sessions for signing.
- Remediation: Prefer the `/api/auth/mobile/start` backend-mediated flow. If `/exchange` remains, verify Google JWT signatures via JWKS and store `ephemeralPubKeyB64`, `maxEpoch`, and `randomness` in `issueMobileBearer`.
- Verification: Add mobile exchange -> proof -> sponsor-execute tests, including a forged JWT rejection.

#### P1-5. App Attest is documented as enforced but is not a real security boundary yet

- Status: Open
- Evidence: Server registration explicitly skips Apple validation at `web/app/api/auth/attest/register/route.ts:46-49`. The challenge route is stateless (`web/app/api/auth/attest/challenge/route.ts:12-14`). On iOS, `AppAttestService.bootstrap` exists (`ios/Talise/Auth/AppAttestService.swift:37-54`), but the iOS subagent found no caller in `ios/Talise`. `APIClient` only attaches an assertion if one can be generated (`ios/Talise/Network/APIClient.swift:135-140`).
- Impact: Backend endpoints may appear hardware-attested in docs while accepting normal bearer traffic. This weakens abuse controls for mobile money movement.
- Remediation: Call `AppAttestService.bootstrap` after bearer issuance, persist one-time challenges server-side, verify Apple's attestation chain/RPID/counter, and enforce `X-App-Attest` on sensitive mobile routes with a controlled dev bypass.
- Verification: Add negative tests for missing, replayed, and invalid App Attest assertions.

#### P1-6. GPU prover cutover path lacks endpoint authentication

- Status: Open
- Evidence: `scripts/deploy-gpu-prover.sh:213-227` path-filters to `/healthz`, `/input`, and `/warmup`, but does not authenticate or rate-limit. `web/lib/zksigner.ts:169-174` calls the prover with only JSON headers. `docs/ZKLOGIN-GPU-PROVER-RUNBOOK.md:277-284` recommends a bearer header but says code plumbing is still needed.
- Impact: If exposed publicly, the prover can be abused for expensive proof requests or warmup traffic.
- Remediation: Add `ZK_PROVER_AUTH_TOKEN` support in `callProver`, enforce it in Caddy/sidecar/ALB auth, and add request rate limits before flipping GPU primary.
- Verification: Smoke test must prove unauthenticated `/input` returns 401/403 and authenticated requests succeed.

### P2 Medium

#### P2-1. Money and token amounts use `Double` in iOS DTOs and conversions

- Status: Open
- Evidence: `ios/Talise/Network/APIModels.swift:102-176` uses `Double` for balances, timestamps, send amounts, and roundups. `ios/Talise/Sui/SuiAddress.swift:30-45` says the app works in human-readable doubles and converts to on-chain integers with rounding.
- Impact: Binary floating point can create rounding errors in payment, fee, token precision, and display paths.
- Remediation: Use integer minor units or `Decimal` value types for money/token quantities. Keep display formatting separate from signing/build amounts.
- Verification: Unit tests for USDsui/SUI conversion, max/min amounts, rounding, and large u64 string parsing.

#### P2-2. Move slippage/provider controls are not enforced on-chain

- Status: Open
- Evidence: `move/talise/SECURITY-V7.md:103-107` describes a 2 percent Move-level slippage cap, but `move/talise/sources/vault.move:602-640` has no expected amount/slippage assertion. `move/talise/sources/auto_swap.move:388-392` stores `allowed_providers` but comments that Move cannot see aggregator provider fields. `docs/codebase/03-move-auto-swap-flow.md:130-137` acknowledges the source gap.
- Impact: Destination type is enforced, but price/provider quality depends on off-chain Onara/Cetus behavior.
- Remediation: Either implement enforceable expected-output checks in the PTB/Move API or update all specs to state that slippage/provider enforcement is off-chain only.
- Verification: Add Move tests for expected-output aborts if the contract gains the assertion; otherwise add Onara tests proving slippage/provider policy is enforced before signing.

#### P2-3. Web API lacks a consistent rate-limit and Origin/CSRF policy

- Status: Open
- Evidence: `SECURITY.md:71-86` already identifies no rate limiting and no explicit Origin checks. Local `rg` found no reusable rate-limit middleware. Sensitive routes include sponsorship, onramp, username claim, proof, chat, and T2000 execution.
- Impact: Authenticated abuse can drain sponsor gas, inflate provider costs, spam external APIs, or degrade service.
- Remediation: Add a central route guard for rate limits, Origin/Referer allowlist on state-changing web routes, and route-specific budgets for cost-bearing endpoints.
- Verification: Add tests or smoke scripts that exceed limits and receive 429.

#### P2-4. Web chat endpoint is cost-bearing and allows unauthenticated use

- Status: Open
- Evidence: `/api/chat` proceeds with `0x0` context when no session exists (`web/app/api/chat/route.ts:95-103`), while the `/chat` page is gated and `/api/chat/stream` reportedly returns 401 when unauthenticated.
- Impact: A public API caller can consume LLM provider capacity even if the UI route is protected.
- Remediation: Require a session for `/api/chat`, or explicitly split a public lightweight endpoint from the authenticated money-context chat.
- Verification: Unauthenticated POST to `/api/chat` returns 401.

#### P2-5. Docs/env source of truth conflicts with implementation

- Status: Open
- Evidence: `web/lib/db.ts:4-18` states Postgres and requires `postgres://` `DATABASE_URL`, while `docs/codebase/30-infra-overview.md:19` still says libSQL/Turso and `docs/codebase/INDEX.md:84-90` flags this drift. README/env docs also mix `SUI_FULLNODE_URL` and `SUI_RPC_URL`.
- Impact: New deploys or teammates can configure the wrong database or RPC variables.
- Remediation: Treat `.env.example` plus `rg process.env` as canonical. Regenerate env docs from source. Mark generated docs with a freshness date and source commit.
- Verification: Add an env audit script that fails when documented vars differ from code.

#### P2-6. iOS has no test target or privacy/localization resources

- Status: Open
- Evidence: `xcodebuild -list -project ios/Talise.xcodeproj` lists only target/scheme `Talise`. `find ios/Talise -name PrivacyInfo.xcprivacy -o -name '*.strings' -o -name '*.xcstrings'` returned no privacy manifest or localization resources.
- Impact: Critical local logic and App Store privacy declarations are not covered by repeatable checks.
- Remediation: Add `TaliseTests` and `TaliseUITests`, plus `PrivacyInfo.xcprivacy` and string catalogs before public App Store submission.
- Verification: `xcodebuild test` passes on a named simulator and privacy manifest is included in the app bundle.

#### P2-7. Lint/CI gates are missing or ineffective

- Status: Open
- Evidence: `.github/workflows/` does not exist. `pnpm run lint` fails because `next lint` is deprecated and prompts for ESLint setup rather than running non-interactively.
- Impact: Type/build checks depend on manual execution and lint does not run in CI.
- Remediation: Add CI for web typecheck/build, Move tests, Onara tests/typechecks, bridge syntax if kept, and iOS build/test once a test target exists. Migrate `web` lint to ESLint CLI.
- Verification: Pull request checks run all gates without prompts.

### P3 Low

#### P3-1. Stale architecture/planning docs conflict with current code

- Status: Open
- Evidence: `ARCHITECTURE.md:3-23` lists old Move modules such as `account`, `policy`, `yield_router`, `auto_convert`, `savings`, and `recurring`, while current source has `send`, `vault`, `receipt`, and `auto_swap`. `PLAN.md` still references dates and decisions from May 2026 that no longer describe the repo state.
- Impact: Readers may follow the wrong design and duplicate abandoned work.
- Remediation: Move stale plans to `docs/archive/` or label them as historical. Make `docs/codebase/INDEX.md` the current map until it is regenerated.
- Verification: Root README links only to current docs for active architecture.

#### P3-2. Flat web component/lib layout slows ownership

- Status: Open
- Evidence: `web/components/` mixes marketing, app shell, payments, business, earn, rewards, chat, and legacy components. `web/lib/` mixes server-only modules, client helpers, integrations, DB/session, rewards, and formatting.
- Impact: It is harder to reason about bundle boundaries, server-only imports, and feature ownership.
- Remediation: Split by domain and runtime boundary as proposed below.
- Verification: New folders have clear README or barrel ownership and `server-only` modules are not imported into client components.

#### P3-3. Large iOS feature files should be split by state/model/view

- Status: Open
- Evidence: iOS subagent flagged large mixed files such as `HomeView.swift`, `EarnView.swift`, `AutoSwapSettings.swift`, and `APIModels.swift`.
- Impact: Increased merge conflicts, lower testability, and harder state ownership review.
- Remediation: Extract view models/services and DTO groups by feature.
- Verification: Feature files have focused responsibilities and tests cover extracted logic.

#### P3-4. Next build warning for Apple association route

- Status: Open
- Evidence: `pnpm build` warns that `/.well-known/apple-app-site-association` uses `runtime = 'edge'` with `dynamic = 'force-static'`, which Next says is incompatible.
- Impact: Low immediate risk, but Universal Link behavior should be deterministic.
- Remediation: Remove either `runtime` or `force-static` based on desired hosting behavior.
- Verification: `pnpm build` runs warning-free and the AASA route returns expected JSON/content-type.

#### P3-5. Some executor code ignores configured network/RPC

- Status: Open
- Evidence: Move/Onara subagent flagged `onara/api/src/receiveAndDeposit.ts:87` as hardcoding mainnet RPC despite configured network/RPC bindings elsewhere.
- Impact: Testnet/devnet workflows can accidentally hit mainnet or fail in confusing ways.
- Remediation: Centralize RPC/client creation for all Onara route modules.
- Verification: Unit tests instantiate route helpers with testnet bindings.

## Folder Organization Plan

No folders were moved in this pass. This is the recommended structure to arrange the codebase without losing history.

### Near-Term Cleanup

| Current | Recommendation | Reason |
| --- | --- | --- |
| `zklogin/` | Move to `archive/legacy/zklogin/` or `docs/reference/zklogin-legacy/` | It contradicts current iOS/web zkLogin flow and has unsafe bridge behavior. |
| Root stale docs | Move stale plans to `docs/archive/` | Keeps current architecture discoverable. |
| `docs/codebase/` | Keep as generated docs, add freshness/commit header | It is useful but should not be treated as manually maintained source of truth. |
| `prover/` + GPU scripts | Consolidate under `infra/prover/{cpu,gpu}/` | Prover endpoints, Dockerfiles, runbooks, and smoke scripts belong together. |
| `scripts/Dockerfile.talise` | Move under `infra/prover/gpu/Dockerfile` or `prover/gpu/Dockerfile` | CI/deploy docs should build the same wrapper image. |
| `onara/api/src/*.ts` route files | Split into `src/routes/`, `src/security/`, `src/sui/`, `src/config/` | Avoid duplicated keypair/RPC/policy patterns. |

### Suggested Monorepo Shape

```text
Talise/
  apps/
    web/                  # current web/
    ios/                  # current ios/
  contracts/
    sui/talise/           # current move/talise/
  services/
    onara-api/            # current onara/api/
  packages/
    onara-sdk/            # current onara/sdk/
  infra/
    prover/
      cpu/                # current prover/
      gpu/                # GPU Dockerfile, deploy, smoke, runbooks
    vercel/
    cloudflare/
  docs/
    product/
    architecture/
    security/
    ops/
    generated/codebase/
    archive/
  research/
  scripts/                # only cross-cutting repo scripts
```

This is a staged target, not a required immediate move. The safer first step is to archive legacy/stale material and introduce clearer subfolders inside the existing `web/`, `ios/`, and `onara/` roots.

### Web Internal Structure

```text
web/
  app/
    (marketing)/
    (app)/
    api/
      auth/
      zk/
      vault/
      rewards/
      payments/
      infra/
  components/
    common/
    marketing/
    app-shell/
    payments/
    business/
    earn/
    rewards/
    chat/
  lib/
    server/
      auth/
      db/
      sui/
      integrations/
    client/
    shared/
```

Key rule: server-only modules that touch cookies, DB, secrets, signing, or provider keys should live under `lib/server/` and be blocked from client imports.

### iOS Internal Structure

```text
ios/Talise/
  App/
  Auth/
  Network/
  Sui/
  DesignSystem/
  Features/
    Home/
      Models/
      Views/
      ViewModels/
    Send/
    Earn/
    Rewards/
    Profile/
    Onboarding/
  Resources/
  TaliseTests/
  TaliseUITests/
```

Key rule: transaction signing and biometric confirmation should be centralized, not repeated in feature views.

## Verification Log

| Command | Result |
| --- | --- |
| `pnpm exec tsc --noEmit` in `web/` | Passed. |
| `pnpm build` in `web/` | Passed; warning on `/.well-known/apple-app-site-association` edge runtime plus force-static. |
| `pnpm run lint` in `web/` | Failed non-interactively because `next lint` is deprecated and prompted for ESLint setup. |
| `sui move test` in `move/talise/` | Passed after approval to access the local Move package cache; 66 tests passed, 0 failed, with implicit constant-copy warnings in tests. |
| `bun test` in `onara/api/` | Passed; 49 tests. |
| `bun test` in `onara/sdk/` | Passed; 8 tests. |
| `bunx tsc --noEmit` in `onara/api/` | Passed. |
| `bunx tsc --noEmit` in `onara/sdk/` | Passed. |
| `xcodebuild -list -project Talise.xcodeproj` in `ios/` | Succeeded and found scheme `Talise`; sandbox emitted CoreSimulator/cache permission warnings. |
| iOS simulator build | Sandboxed build failed because no simulator runtimes were available to asset tooling; iOS subagent reported escalated simulator build succeeded. |
| `bash -n scripts/deploy-gpu-prover.sh scripts/zk-prover-smoke.sh prover/download-zkey.sh` | Passed. |
| `node --check zklogin/bridge/server.js` | Passed syntax check. |
| `npm --prefix zklogin/bridge ls --depth=0` | Failed; bridge dependencies are not installed locally. |
| `git check-ignore` for local env files | Confirmed local env/secret files are ignored. |

## Next Pass Checklist

| Priority | Status | Item |
| --- | --- | --- |
| P0 | Open | Narrow Onara sponsor policy and remove `Publish`/wildcard target sponsorship. |
| P0 | Open | Rotate any real local mainnet sponsor key and move production secrets to Cloudflare only. |
| P0 | Open | Add iOS biometric/user-presence confirmation before every signing path. |
| P1 | Open | Verify invoice digests/PaymentRecord on-chain before marking invoices paid. |
| P1 | Open | Make App Attest real: bootstrap on iOS, verify server-side, enforce on sensitive routes. |
| P1 | Open | Archive or harden `zklogin/` legacy bridge/reference code. |
| P1 | Open | Force Onara auto-swap executor to authenticated v2-only production calls. |
| P2 | Open | Replace iOS money `Double` paths with fixed precision/integer units. |
| P2 | Open | Add rate limits and Origin checks for state-changing/cost-bearing web APIs. |
| P2 | Open | Add CI for web, Move, Onara, iOS, and docs/env drift. |
| P3 | Open | Move stale docs to archive and make `docs/codebase/` clearly generated. |
| P3 | Open | Split web/iOS folders by domain and runtime boundaries. |
