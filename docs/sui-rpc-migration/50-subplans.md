---
title: "Talise — 50-Subplan Breakdown for Sui RPC Migration"
subtitle: "Each Phase × 10 sub-plans, agent-ready"
date: "2026-05-28"
toc: true
toc-depth: 2
geometry: margin=2.5cm
fontsize: 10pt
mainfont: "Helvetica Neue"
---

\newpage

# Reading guide

Each sub-plan has:

- **ID** — `<phase>.<n>` (e.g. `1.5`)
- **Title** — single-line summary
- **Scope** — what an agent should do
- **Files touched** — explicit paths so agents don't drift
- **Parallel-safe?** — `PARALLEL-SAFE` / `SEQ-WITHIN-PHASE` / `BLOCKED-BY:<id>`
- **Recommended agent count** — most are 1; complex ones get 2 with explicit work-splits
- **Estimated effort** — engineer-hours, not agent-wall-clock

**Total realistic concurrent agents: ~6–8.** Spawning all 50 simultaneously causes file conflicts and wasted context (see Appendix C in the main plan).

\newpage

# Phase 0 — Pre-work (10 sub-plans)

## 0.1 — Pull Sui protobuf files

**Scope.** Clone `github.com/MystenLabs/sui` at the tag matching `@mysten/sui ^2.16`. Copy `crates/sui-rpc-api/proto/*.proto` (and recursive imports) into the repo.

**Files touched.** New: `web/lib/sui-proto/proto/*.proto`, `ios/Talise/Network/SuiProto/proto/*.proto` (identical copies for traceability).

**Parallel-safe?** PARALLEL-SAFE.

**Agents.** 1. **Effort.** 1h.

---

## 0.2 — Vendor protobuf into iOS

**Scope.** Run protoc with `protoc-gen-grpc-swift` + `protoc-gen-swift` against the vendored .proto from 0.1. Commit generated Swift files to `ios/Talise/Network/SuiProto/Generated/`.

**Files touched.** New: `ios/Talise/Network/SuiProto/Generated/*.grpc.swift`, `*.pb.swift`.

**Parallel-safe?** BLOCKED-BY: 0.1.

**Agents.** 1. **Effort.** 2h.

---

## 0.3 — GraphQL singleton

**Scope.** Add `web/lib/sui-graphql.ts` exporting `suiGraphQL()` cached `SuiGraphQLClient`. Read network from `NEXT_PUBLIC_SUI_NETWORK`.

**Files touched.** New: `web/lib/sui-graphql.ts`.

**Parallel-safe?** PARALLEL-SAFE.

**Agents.** 1. **Effort.** 30m.

---

## 0.4 — Feature flag scaffolding

**Scope.** Add `TALISE_LEGACY_JSONRPC` env var support to `web/lib/sui.ts`. When `=0`, JSON-RPC helpers throw at call time — used per-site to verify gRPC swap.

**Files touched.** `web/lib/sui.ts`.

**Parallel-safe?** PARALLEL-SAFE (no shared editing yet).

**Agents.** 1. **Effort.** 30m.

---

## 0.5 — CI lint gate against new JSON-RPC

**Scope.** Add an ESLint rule (or grep CI step) that fails the build if a new `import.*SuiJsonRpcClient` appears in a non-allowlisted file. Allowlist shrinks to zero by Phase 5.

**Files touched.** `web/.eslintrc.cjs` (or new lint script), `web/package.json` (test script entry).

**Parallel-safe?** PARALLEL-SAFE.

**Agents.** 1. **Effort.** 1h.

---

## 0.6 — Integration test harness

**Scope.** Set up `web/__tests__/sui/` with a shared `beforeAll` that initializes both `sui()` and `suiGraphQL()` clients pointing at mainnet read-only endpoints. Adds a `vitest` config that excludes these by default (slow) and a `pnpm test:integration` runner.

**Files touched.** New: `web/__tests__/sui/harness.ts`, `web/vitest.config.ts` updates, `web/package.json`.

**Parallel-safe?** PARALLEL-SAFE.

**Agents.** 1. **Effort.** 1.5h.

---

## 0.7 — `normalizeTransactionShape()` helper stub

**Scope.** Define the contract in `web/lib/sui-shapes.ts`: a TS type that both JSON-RPC and gRPC `getTransaction` responses map into. No implementation yet — just the type signature + JSDoc explaining what callers can rely on. Phase 1 sub-plans implement.

**Files touched.** New: `web/lib/sui-shapes.ts`.

**Parallel-safe?** PARALLEL-SAFE.

**Agents.** 1. **Effort.** 30m.

---

## 0.8 — Engineering doc: migration patterns

**Scope.** Write `docs/sui-rpc-migration/patterns.md` showing the canonical migration recipes (JSON-RPC `getObject` → gRPC `core.getObject` with shape diff, etc.). Reused by every Phase 1 agent.

**Files touched.** New: `docs/sui-rpc-migration/patterns.md`.

**Parallel-safe?** PARALLEL-SAFE.

**Agents.** 1. **Effort.** 1h.

---

## 0.9 — Map private-key access patterns

**Scope.** Audit which JSON-RPC sites currently access signer / private-key flows. Document any that need extra care during migration (e.g. the Suins-operator signing path).

**Files touched.** Output: `docs/sui-rpc-migration/key-access-audit.md`.

**Parallel-safe?** PARALLEL-SAFE.

**Agents.** 1. **Effort.** 1h.

---

## 0.10 — Pull request template

**Scope.** Add a PR template `docs/sui-rpc-migration/pr-template.md` that every Phase 1+ PR follows: site migrated, response-shape diff, test added, regression run.

**Files touched.** New: `docs/sui-rpc-migration/pr-template.md`.

**Parallel-safe?** PARALLEL-SAFE.

**Agents.** 1. **Effort.** 30m.

\newpage

# Phase 1 — Backend migration (10 sub-plans)

## 1.1 — Epoch helper (`/api/sui/epoch` + `/api/auth/mobile/start`)

**Scope.** Replace two `suiJsonRpc().getLatestSuiSystemState()` calls with a single shared helper using `sui()` (gRPC). New helper: `web/lib/sui-epoch.ts`.

**Files touched.** New: `web/lib/sui-epoch.ts`. Modified: `web/app/api/sui/epoch/route.ts`, `web/app/api/auth/mobile/start/route.ts`.

**Parallel-safe?** PARALLEL-SAFE.

**Agents.** 1. **Effort.** 2h.

---

## 1.2 — `/api/pk/status` (balance + object)

**Scope.** Migrate `getBalance` → `core.listBalances` and `getObject` → `core.getObject`. Update field-access paths.

**Files touched.** `web/app/api/pk/status/route.ts`.

**Parallel-safe?** PARALLEL-SAFE.

**Agents.** 1. **Effort.** 2h.

---

## 1.3 — `normalizeTransactionShape()` implementation

**Scope.** Implement the helper stubbed in 0.7. Reads from either JSON-RPC `getTransactionBlock` or gRPC `core.getTransaction`, normalizes to a canonical TS shape that the four verifier sites read from. Unit tests against known mainnet digests.

**Files touched.** `web/lib/sui-shapes.ts`. Tests: `web/__tests__/sui/normalize-tx.test.ts`.

**Parallel-safe?** PARALLEL-SAFE. **BLOCKING for 1.4–1.7.**

**Agents.** 2 (one impl, one tests). **Effort.** 4h.

---

## 1.4 — `/api/tx/record` verifier swap

**Scope.** Replace JSON-RPC `getTransactionBlock` with `core.getTransaction` going through `normalizeTransactionShape()`.

**Files touched.** `web/app/api/tx/record/route.ts`.

**Parallel-safe?** BLOCKED-BY: 1.3.

**Agents.** 1. **Effort.** 1.5h.

---

## 1.5 — `/api/vault/record` verifier swap

**Scope.** Same recipe as 1.4 for vault-side verification.

**Files touched.** `web/app/api/vault/record/route.ts`.

**Parallel-safe?** BLOCKED-BY: 1.3.

**Agents.** 1. **Effort.** 1h.

---

## 1.6 — `/api/vault/migrate-confirm` verifier swap

**Scope.** Same recipe as 1.4 for vault migration confirmation.

**Files touched.** `web/app/api/vault/migrate-confirm/route.ts`.

**Parallel-safe?** BLOCKED-BY: 1.3.

**Agents.** 1. **Effort.** 1h.

---

## 1.7 — `/api/vault/repoint-confirm` verifier swap

**Scope.** Same recipe as 1.4 for vault repoint confirmation.

**Files touched.** `web/app/api/vault/repoint-confirm/route.ts`.

**Parallel-safe?** BLOCKED-BY: 1.3.

**Agents.** 1. **Effort.** 1h.

---

## 1.8 — `lib/activity.ts` → GraphQL

**Scope.** Replace `queryEvents` + `queryTransactionBlocks` pair with a single GraphQL query that fetches both event + transaction history with Relay cursor pagination. Caller API stays the same.

**Files touched.** `web/lib/activity.ts`. Tests: `web/__tests__/sui/activity.test.ts`.

**Parallel-safe?** PARALLEL-SAFE.

**Agents.** 2 (one for the query design + impl, one for the test against known mainnet history). **Effort.** 4h.

---

## 1.9 — `/api/cron/auto-swap-sweep` event polling → GraphQL

**Scope.** The 11 `queryEvents` / `queryObjects` calls in the cron sweeper migrate to GraphQL paginated queries. Largest single-file scope.

**Files touched.** `web/app/api/cron/auto-swap-sweep/route.ts`.

**Parallel-safe?** PARALLEL-SAFE.

**Agents.** 2 (split by section: claim-side vs sweep-side). **Effort.** 5h.

---

## 1.10 — `lib/{suins-lookup, deepbook-margin, zkclient, suins-operator, pk-bootstrap, navi-supply, vault/state}` cluster

**Scope.** Final 6 sites: each is small (1-3 lines of JSON-RPC), grouped into one PR. Each gets a swap to gRPC `core.*` methods. Most are `executeTransaction` or `listOwnedObjects` patterns.

**Files touched.** `web/lib/suins-lookup.ts`, `web/lib/deepbook-margin.ts`, `web/lib/zkclient.ts`, `web/lib/suins-operator.ts`, `web/lib/pk-bootstrap.ts`, `web/lib/navi-supply.ts`, `web/app/api/vault/state/route.ts`.

**Parallel-safe?** SEQ-WITHIN-PHASE (single PR, multiple files).

**Agents.** 2 (split: SDK-init files vs route file). **Effort.** 4h.

\newpage

# Phase 2 — Web frontend (10 sub-plans)

Phase 2 is genuinely small. The 10-sub-plan slicing below is fine-grained to fit the structure, but most slots are 15-30 min jobs.

## 2.1 — Browser-side GraphQL client setup

**Scope.** Add `web/components/lib/sui-graphql-client.ts` — separate from the server-side `lib/sui-graphql.ts` to keep browser bundle small.

**Files touched.** New: `web/components/lib/sui-graphql-client.ts`.

**Parallel-safe?** PARALLEL-SAFE.

**Agents.** 1. **Effort.** 30m.

---

## 2.2 — Query: Suins subname lookup

**Scope.** Write the GraphQL query string that the FixSubnameBanner needs (look up the user's existing subname object). Validate against testnet via GraphQL playground.

**Files touched.** `web/components/FixSubnameBanner.tsx` (query constant).

**Parallel-safe?** BLOCKED-BY: 2.1.

**Agents.** 1. **Effort.** 1h.

---

## 2.3 — FixSubnameBanner JSON-RPC → GraphQL migration

**Scope.** Replace the `SuiJsonRpcClient` + JSON-RPC call with the GraphQL query from 2.2.

**Files touched.** `web/components/FixSubnameBanner.tsx`.

**Parallel-safe?** BLOCKED-BY: 2.2.

**Agents.** 1. **Effort.** 1h.

---

## 2.4 — Loading + error states

**Scope.** Make sure the GraphQL call has parity loading + error UX with the previous JSON-RPC version.

**Files touched.** `web/components/FixSubnameBanner.tsx`.

**Parallel-safe?** BLOCKED-BY: 2.3.

**Agents.** 1. **Effort.** 30m.

---

## 2.5 — Smoke test for FixSubnameBanner

**Scope.** Playwright smoke test that mounts the banner on a known-broken-state account and verifies the GraphQL data fills in.

**Files touched.** New: `web/__tests__/components/fix-subname-banner.test.tsx`.

**Parallel-safe?** PARALLEL-SAFE.

**Agents.** 1. **Effort.** 1h.

---

## 2.6 — Type generation from GraphQL schema

**Scope.** Add a `pnpm graphql:codegen` script that pulls types from Sui's GraphQL schema and generates TS interfaces for our queries. Saves manual `as any` casts.

**Files touched.** New: `web/codegen.ts`, `web/package.json`.

**Parallel-safe?** PARALLEL-SAFE.

**Agents.** 1. **Effort.** 1.5h.

---

## 2.7 — Bundle-size audit

**Scope.** Run `pnpm build` before/after the GraphQL client adds and confirm the browser bundle didn't bloat (>10kB delta needs investigation).

**Files touched.** None (reporting only).

**Parallel-safe?** PARALLEL-SAFE.

**Agents.** 1. **Effort.** 30m.

---

## 2.8 — Caching: cache the subname lookup for 60s

**Scope.** Use the GraphQL client's built-in cache OR a small SWR wrapper to avoid re-querying on every re-mount.

**Files touched.** `web/components/FixSubnameBanner.tsx`.

**Parallel-safe?** BLOCKED-BY: 2.3.

**Agents.** 1. **Effort.** 30m.

---

## 2.9 — Telemetry: tag the GraphQL request in our analytics

**Scope.** Add a `transport: "graphql"` tag to the SubnameBanner's analytics event so we can confirm the migration in production telemetry.

**Files touched.** `web/components/FixSubnameBanner.tsx`.

**Parallel-safe?** BLOCKED-BY: 2.3.

**Agents.** 1. **Effort.** 15m.

---

## 2.10 — Delete the JSON-RPC import from the file

**Scope.** Final pass: drop the `SuiJsonRpcClient` import line. PR diff sweep for any residual references.

**Files touched.** `web/components/FixSubnameBanner.tsx`.

**Parallel-safe?** BLOCKED-BY: 2.3–2.9 all green.

**Agents.** 1. **Effort.** 10m.

\newpage

# Phase 3 — iOS gRPC SDK (10 sub-plans)

## 3.1 — Add grpc-swift SPM dependency

**Scope.** Add `grpc-swift` v2 and `swift-protobuf` to `ios/project.yml` packages section. Run `xcodegen` to regenerate `Talise.xcodeproj`.

**Files touched.** `ios/project.yml`.

**Parallel-safe?** PARALLEL-SAFE.

**Agents.** 1. **Effort.** 30m.

---

## 3.2 — Toolchain setup (protoc + plugins)

**Scope.** Write a `ios/scripts/regen-proto.sh` that downloads the correct `protoc-gen-grpc-swift` + `protoc-gen-swift` versions and runs them against `ios/Talise/Network/SuiProto/proto/*.proto`. Commit the script + the generated output.

**Files touched.** New: `ios/scripts/regen-proto.sh`, `ios/Talise/Network/SuiProto/Generated/*.swift`.

**Parallel-safe?** BLOCKED-BY: 0.1, 3.1.

**Agents.** 1. **Effort.** 3h.

---

## 3.3 — `SuiGrpcClient.swift` skeleton

**Scope.** Class skeleton with a static `shared` instance, internal state (channel, baseUrl, network), and empty method stubs for `getLatestEpoch`, `getReferenceGasPrice`, `getBalance`, `executeTransaction`.

**Files touched.** New: `ios/Talise/Network/SuiGrpcClient.swift`.

**Parallel-safe?** BLOCKED-BY: 3.2.

**Agents.** 1. **Effort.** 2h.

---

## 3.4 — `getLatestEpoch()` implementation

**Scope.** Implement using `LedgerService` from the generated bindings. Maps the proto epoch field to `UInt64`.

**Files touched.** `ios/Talise/Network/SuiGrpcClient.swift`.

**Parallel-safe?** BLOCKED-BY: 3.3.

**Agents.** 1. **Effort.** 2h.

---

## 3.5 — `getReferenceGasPrice()` implementation

**Scope.** Same pattern as 3.4 for gas price. Likely shares a single `LedgerService` query helper.

**Files touched.** `ios/Talise/Network/SuiGrpcClient.swift`.

**Parallel-safe?** BLOCKED-BY: 3.3.

**Agents.** 1. **Effort.** 1.5h.

---

## 3.6 — `getBalance(owner:coinType:)` implementation

**Scope.** Uses `StateService.listBalances`. Returns a typed `Balance` struct (Swift mirror of the gRPC response).

**Files touched.** `ios/Talise/Network/SuiGrpcClient.swift`, new `ios/Talise/Network/SuiTypes.swift` if needed.

**Parallel-safe?** BLOCKED-BY: 3.3.

**Agents.** 1. **Effort.** 2h.

---

## 3.7 — `executeTransaction(bytes:signatures:)` implementation

**Scope.** Uses `TransactionExecutionService.executeTransaction`. Returns digest + status. Future-proof for the day iOS does offline tx assembly.

**Files touched.** `ios/Talise/Network/SuiGrpcClient.swift`.

**Parallel-safe?** BLOCKED-BY: 3.3.

**Agents.** 1. **Effort.** 2.5h.

---

## 3.8 — Migrate `ZkLoginCoordinator.fetchEpochViaMainnetRPC`

**Scope.** Replace the raw `URLSession.shared.data(for: req)` JSON-RPC POST with `SuiGrpcClient.shared.getLatestEpoch()`.

**Files touched.** `ios/Talise/Auth/ZkLoginCoordinator.swift`.

**Parallel-safe?** BLOCKED-BY: 3.4.

**Agents.** 1. **Effort.** 1h.

---

## 3.9 — Unit tests for `SuiGrpcClient`

**Scope.** XCTest cases for each of the 4 methods. Round-trip a known mainnet object / address to confirm response decoding.

**Files touched.** New: `ios/TaliseTests/SuiGrpcClientTests.swift`.

**Parallel-safe?** BLOCKED-BY: 3.4–3.7.

**Agents.** 1. **Effort.** 2h.

---

## 3.10 — Performance + retry policy

**Scope.** Add a retry-with-backoff for transient gRPC errors. Add a per-request timeout. Add a one-line latency log for production observability.

**Files touched.** `ios/Talise/Network/SuiGrpcClient.swift`.

**Parallel-safe?** BLOCKED-BY: 3.4–3.7.

**Agents.** 1. **Effort.** 1.5h.

\newpage

# Phase 4 — Test matrix (10 sub-plans)

## 4.1 — `send-gasless.test.ts`

**Scope.** Integration test that builds + submits a $0.01 USDsui send on testnet via the gasless path. Verifies digest, on-chain receipt.

**Files touched.** New: `web/__tests__/sui/send-gasless.test.ts`.

**Parallel-safe?** PARALLEL-SAFE.

**Agents.** 1. **Effort.** 2h.

---

## 4.2 — `send-sponsored.test.ts`

**Scope.** Same but with round-up enabled (sponsored path). Verifies both send + supply legs.

**Files touched.** New: `web/__tests__/sui/send-sponsored.test.ts`.

**Parallel-safe?** PARALLEL-SAFE.

**Agents.** 1. **Effort.** 2h.

---

## 4.3 — `supply.test.ts`

**Scope.** Integration test for `/api/earn/supply/prepare` + sponsor-execute. Confirms NAVI position appears.

**Files touched.** New: `web/__tests__/sui/supply.test.ts`.

**Parallel-safe?** PARALLEL-SAFE.

**Agents.** 1. **Effort.** 2h.

---

## 4.4 — `withdraw.test.ts`

**Scope.** Integration test for `/api/earn/withdraw/prepare` + sponsor-execute. Verifies funds return to wallet.

**Files touched.** New: `web/__tests__/sui/withdraw.test.ts`.

**Parallel-safe?** PARALLEL-SAFE.

**Agents.** 1. **Effort.** 2h.

---

## 4.5 — `vault-state.test.ts`

**Scope.** Integration test for `/api/vault/state`. Verifies balances + supplied amount via gRPC.

**Files touched.** New: `web/__tests__/sui/vault-state.test.ts`.

**Parallel-safe?** PARALLEL-SAFE.

**Agents.** 1. **Effort.** 1.5h.

---

## 4.6 — `activity.test.ts`

**Scope.** Integration test for the GraphQL-backed `lib/activity.ts`. Pulls a known mainnet wallet's history and confirms ordering, dedup, mixed entry types.

**Files touched.** New: `web/__tests__/sui/activity.test.ts`.

**Parallel-safe?** PARALLEL-SAFE.

**Agents.** 1. **Effort.** 2h.

---

## 4.7 — `tx-record.test.ts`

**Scope.** Integration test that the verifier in `/api/tx/record` correctly accepts a known mainnet digest after the migration.

**Files touched.** New: `web/__tests__/sui/tx-record.test.ts`.

**Parallel-safe?** PARALLEL-SAFE.

**Agents.** 1. **Effort.** 1.5h.

---

## 4.8 — `ios-epoch.test`

**Scope.** Swift XCTest case that hits `SuiGrpcClient.shared.getLatestEpoch()` and asserts the response is a positive `UInt64` ≥ a known floor.

**Files touched.** New: `ios/TaliseTests/SuiEpochTests.swift`.

**Parallel-safe?** PARALLEL-SAFE.

**Agents.** 1. **Effort.** 1h.

---

## 4.9 — `prod-smoke` runner

**Scope.** Bash + curl script that walks the whole Send→Withdraw→Supply→Activity flow on production with a $0.01 test amount. Hand-run before every Phase 5 deploy.

**Files touched.** New: `scripts/prod-smoke.sh`.

**Parallel-safe?** PARALLEL-SAFE.

**Agents.** 1. **Effort.** 2h.

---

## 4.10 — CI integration

**Scope.** Wire all Phase 4 tests into GitHub Actions. Mark integration tests as `manual` (not run on every PR — too slow); run them nightly + before Phase 5 deploys.

**Files touched.** `.github/workflows/*.yml`.

**Parallel-safe?** BLOCKED-BY: 4.1–4.9.

**Agents.** 1. **Effort.** 1.5h.

\newpage

# Phase 5 — JSON-RPC removal (10 sub-plans)

Phase 5 is the cleanup pass. All blocked-by the rest of the migration being green.

## 5.1 — Delete `suiJsonRpc()` helper

**Scope.** Remove the export from `web/lib/sui.ts`.

**Files touched.** `web/lib/sui.ts`.

**Parallel-safe?** BLOCKED-BY: Phase 1, 2, 3 complete.

**Agents.** 1. **Effort.** 15m.

---

## 5.2 — Drop SuiJsonRpcClient imports in `lib/zkclient.ts`

**Scope.** Remove the import + ensure the file compiles.

**Files touched.** `web/lib/zkclient.ts`.

**Parallel-safe?** BLOCKED-BY: 1.10.

**Agents.** 1. **Effort.** 15m.

---

## 5.3 — Drop SuiJsonRpcClient imports in `lib/navi-supply.ts`

**Scope.** Same as 5.2.

**Files touched.** `web/lib/navi-supply.ts`.

**Parallel-safe?** BLOCKED-BY: 1.10.

**Agents.** 1. **Effort.** 15m.

---

## 5.4 — Drop SuiJsonRpcClient imports in components

**Scope.** Last call site after Phase 2: `FixSubnameBanner.tsx`. Remove the import line.

**Files touched.** `web/components/FixSubnameBanner.tsx`.

**Parallel-safe?** BLOCKED-BY: 2.10.

**Agents.** 1. **Effort.** 10m.

---

## 5.5 — Drop `@mysten/sui/jsonRpc` from package surface

**Scope.** Remove the package-level re-export from `web/lib/sui.ts` (if still present) and confirm `pnpm build` doesn't pull the JSON-RPC chunk anymore. Audit bundle.

**Files touched.** `web/lib/sui.ts`.

**Parallel-safe?** BLOCKED-BY: 5.1–5.4.

**Agents.** 1. **Effort.** 30m.

---

## 5.6 — Remove iOS JSON-RPC fallback

**Scope.** Delete `ZkLoginCoordinator.fetchEpochViaMainnetRPC` (now replaced by `SuiGrpcClient.shared.getLatestEpoch()` from 3.8). Drop the URLSession imports if no longer used.

**Files touched.** `ios/Talise/Auth/ZkLoginCoordinator.swift`.

**Parallel-safe?** BLOCKED-BY: 3.8.

**Agents.** 1. **Effort.** 20m.

---

## 5.7 — PR-diff `JsonRpc` sweep

**Scope.** `git grep -i jsonrpc` should return zero matches outside of (a) the lint rule from 0.5 and (b) historical commit messages. Document this in the PR.

**Files touched.** None (verification only).

**Parallel-safe?** BLOCKED-BY: 5.1–5.6.

**Agents.** 1. **Effort.** 30m.

---

## 5.8 — Strengthen the CI lint gate

**Scope.** The lint rule from 0.5 was an allowlist of files that COULD import `SuiJsonRpcClient`. Flip it to a deny-list (zero files allowed). CI fails any new JSON-RPC import.

**Files touched.** `web/.eslintrc.cjs` or wherever 0.5 placed the rule.

**Parallel-safe?** BLOCKED-BY: 5.7.

**Agents.** 1. **Effort.** 30m.

---

## 5.9 — Update architectural docs

**Scope.** Update `CLAUDE.md` and `docs/architecture/` (if present) to state the gRPC-primary stance. Drop any "JSON-RPC fallback" language.

**Files touched.** `CLAUDE.md`, `docs/architecture/*.md`.

**Parallel-safe?** PARALLEL-SAFE.

**Agents.** 1. **Effort.** 30m.

---

## 5.10 — Final regression run

**Scope.** Trigger `prod-smoke.sh` (4.9) end-to-end. If green, ship Phase 5. Tag the release.

**Files touched.** None (run only).

**Parallel-safe?** BLOCKED-BY: 5.1–5.9.

**Agents.** 1. **Effort.** 30m + bake time.

\newpage

# Total + concurrency table

| Phase | Sub-plans | Total effort (h) | Max concurrent agents |
|---|---|---|---|
| 0. Pre-work | 10 | ~10 | 4 |
| 1. Backend | 10 | ~28 | 4 (limited by 1.3 blocking) |
| 2. Web frontend | 10 | ~7 | 2 |
| 3. iOS SDK | 10 | ~20 | 2 (limited by sequential 3.2 → 3.3) |
| 4. Test matrix | 10 | ~16 | 6 |
| 5. JSON-RPC removal | 10 | ~5 | 2 |
| **Total** | **50** | **~86 h ≈ 11 engineer-days** | **~6–8 realistic** |

Note: the 11-day total above is sub-plan-level. The 7.5-day plan-level estimate assumes parallelism within each phase. Both numbers are the same project, sliced differently.

---

# Recommended pilot cohort (start here)

If you want to kick off agent work tonight, the most independent + lowest-conflict sub-plans:

1. **0.1** — Pull protobuf
2. **0.3** — GraphQL singleton (`lib/sui-graphql.ts`)
3. **0.5** — CI lint gate
4. **0.6** — Integration test harness
5. **0.8** — Engineering doc: migration patterns
6. **0.10** — PR template

Six agents, all writing new files (no contention), all completable in 1–2 hours each. After this cohort lands, Phase 1 can start with most of its prerequisites in place.
