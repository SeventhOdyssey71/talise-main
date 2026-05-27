# Talise Codebase Map

A 26-document explainer suite covering the entire Talise stack: Move contracts, web frontend + API, iOS app, infrastructure, and product/protocol flows. Each doc is self-contained and cross-references its siblings. Reading order is not strict; start with `40-product-overview.md` if you want the elevator pitch, `10-web-overview.md` or `20-ios-overview.md` if you want to dive into code.

Generated 2026-05-27 by five parallel mapping agents. Source code paths are cited inline with line numbers where useful.

## Contents

### Product and protocol (start here)

| Doc | Words | Summary |
| --- | --- | --- |
| [`40-product-overview.md`](./40-product-overview.md) | 1102 | What Talise is, who it is for, why Sui, competitive frame, current state (pre-launch). |
| [`41-flow-onboarding.md`](./41-flow-onboarding.md) | 831 | Waitlist as production gate, zkLogin sign-in flow, race-safe handle claim. |
| [`42-flow-send.md`](./42-flow-send.md) | 1086 | iOS Send flow, SuiNS resolution, clock-MoveCall vanilla-transfer shim, sponsor-execute, PaymentRecord receipt. |
| [`43-flow-auto-swap.md`](./43-flow-auto-swap.md) | 1247 | The accumulator story, `receive_from_accumulator<T>`, SwapTicket hot-potato, Cetus path, failure modes. |
| [`44-flow-earn-and-receive.md`](./44-flow-earn-and-receive.md) | 1038 | Receive surface, Earn with the 3-branch dust-rounding-aware projection, three withdraw routes. |
| [`45-protocol-design-decisions.md`](./45-protocol-design-decisions.md) | 1487 | Why USDsui, Cetus, Navi, zkLogin, sponsored model. Economic intent. Plain-English 4-role admin model. |

### Move contracts

| Doc | Words | Summary |
| --- | --- | --- |
| [`01-move-overview.md`](./01-move-overview.md) | 824 | Modules, shared/owned object model, RBAC at a glance, invariants, `compatible` upgrade policy. |
| [`02-move-rbac-and-caps.md`](./02-move-rbac-and-caps.md) | 1054 | Four roles (Root/Treasury/Oncall/Worker), 2-step admin rotation with 48h delay, kill switch, throttle, allowlists, `CapUpgradedToV2` event pinning. |
| [`03-move-auto-swap-flow.md`](./03-move-auto-swap-flow.md) | 944 | End-to-end @handle → USDsui at the Move layer, accumulator drain, SwapTicket, partial-failure semantics. |
| [`04-move-upgrade-history.md`](./04-move-upgrade-history.md) | 962 | v1 → v7 timeline with package ids, why OZ AccessControl was abandoned, the `vault::` vs `auto_swap::` PTB bug. |
| [`05-move-testing.md`](./05-move-testing.md) | 547 | 66 tests across files (v7=21, auto_swap=18, vault=22, receipt=2, send=3), how to run, key patterns. |

### Web

| Doc | Words | Summary |
| --- | --- | --- |
| [`10-web-overview.md`](./10-web-overview.md) | 882 | Stack (App Router + Tailwind v4 + TS), directory layout, request flow, auth model, DB shape, Node-only runtime. |
| [`11-web-routes.md`](./11-web-routes.md) | 1624 | Every page + every `app/api/**` route grouped by domain: auth/zk, balances, send, earn, vault, rewards, waitlist, onramp, chat, cron. |
| [`12-web-libs.md`](./12-web-libs.md) | 1355 | Walk-through of every `lib/` module with signatures. Server-only vs isomorphic table. |
| [`13-web-frontend-design.md`](./13-web-frontend-design.md) | 791 | `@theme` CSS tokens mirroring iOS, dark-only stance, Tailwind v4 PostCSS-only setup, glass + TopGlow recipes. |
| [`14-web-integrations.md`](./14-web-integrations.md) | 1161 | Sui RPC, Cetus aggregator, NAVI, Shinami salt/prover, GPU canary toggles, Onara sponsor, Resend, Postgres, Stripe Onramp, 0G/DeepSeek chat. Full env-var table. |

### iOS

| Doc | Words | Summary |
| --- | --- | --- |
| [`20-ios-overview.md`](./20-ios-overview.md) | 763 | Stack, directory map, app bootstrap, auth model, backend host (`app.talise.io`), dark-mode-only stance. |
| [`21-ios-auth-zklogin.md`](./21-ios-auth-zklogin.md) | 1073 | Full zkLogin pipeline including the base64URL pubkey fix and proof JSON round-trip fix. ProofCache keychain persistence. |
| [`22-ios-features.md`](./22-ios-features.md) | 1432 | Onboarding, Home (optimistic tx, receipt fixes), Send (legacy + NavigationStack), Receive, Earn (WithdrawSheet + AutoSwap), Rewards, Profile. |
| [`23-ios-design-system.md`](./23-ios-design-system.md) | 886 | Tokens, Typography, TopGlow, TaliseGlassCard recipe, primitives, animations. |
| [`24-ios-networking-and-sui.md`](./24-ios-networking-and-sui.md) | 1403 | APIClient internals, APIModels, BLAKE2b digest path, sponsored tx flow, error handling. |

### Infrastructure

| Doc | Words | Summary |
| --- | --- | --- |
| [`30-infra-overview.md`](./30-infra-overview.md) | 819 | Hosting topology, DNS, region strategy, ASCII diagram, what is intentionally out of the stack. |
| [`31-infra-deployment.md`](./31-infra-deployment.md) | 904 | Vercel project linkage, framework detection, branch → preview mapping, rollback, `vercel env` CLI. |
| [`32-infra-gpu-prover.md`](./32-infra-gpu-prover.md) | 1597 | Why GPU, upstream project, layered Dockerfile, 4-target provisioner, Mac build problem with 3 workarounds, canary architecture, flip decision. |
| [`33-infra-env-vars.md`](./33-infra-env-vars.md) | 1576 | Exhaustive env var inventory grouped by component. Rotation notes. |
| [`34-infra-observability.md`](./34-infra-observability.md) | 1056 | Logging path, cron walkthrough, `CapUpgradedToV2` type-tag gotcha, health endpoints, monitoring priorities. |

## Cross-cutting reading paths

**"I am new and want to understand the product before diving into code."**
Read in this order: `40` → `41` → `42` → `43` → `44` → `45`. About 90 minutes.

**"I am picking up the Move contracts."**
`01` → `02` → `03` → `04` → `05`. Cross-link to `43` for the product-level auto-swap narrative.

**"I am picking up the web frontend."**
`10` → `11` → `13` for pages; `12` → `14` for backend integrations.

**"I am picking up iOS."**
`20` → `21` → `22` → `24` → `23`.

**"I am on the infra rotation."**
`30` → `31` → `33` → `34`, then `32` if a GPU cutover is on the table.

**"I am here for the GPU prover cutover."**
Deployment plan lives at `/Users/eromonseleodigie/Talise/infra/prover/gpu/DEPLOYMENT-PLAN.md`. Background detail in `32-infra-gpu-prover.md`. Per-stage rollback in `infra/prover/gpu/BABYSIT.md`.

## Reconciliations and flagged inconsistencies

Where two agents disagreed, the correct answer (verified against the source code) is listed first.

### Database driver (fixed 2026-05-27)

* **Correct:** `web/lib/db.ts` is **Postgres** via the `postgres` driver. The file header comment is explicit: "The application historically used libsql; this module preserves the libsql-style API so the rest of the codebase did not need to change during the migration. Internally everything runs against Postgres."
* **Web agent (12-web-libs.md):** correctly identifies Postgres.
* **Infra agent (30/33/34):** previously described the stack as "libSQL / Turso." Patched 2026-05-27: `30-infra-overview.md`, `33-infra-env-vars.md`, and `34-infra-observability.md` now state Postgres, show the `postgres://USER:PASS@HOST:PORT/DB` shape for `DATABASE_URL`, and note that `DATABASE_AUTH_TOKEN` is ignored under the Postgres adapter. The `@libsql/client` dep in `web/package.json` remains as a leftover and is called out historically.

### Cetus aggregator endpoint

* **Correct:** Cetus SDK is instantiated with `new AggregatorClient({ env: Env.Mainnet })` at `web/app/api/sweep/prepare/route.ts:48`. The endpoint is hardcoded inside the SDK. There is no `CETUS_AGGREGATOR_ENDPOINT` env var. Earlier conversation notes that named one were wrong; the infra agent caught it.
* The earlier claim that `CETUS_AGGREGATOR_ENDPOINT` must be set to `https://api-sui.cetus.zone/router_v3` is from the period when the codebase used a custom HTTP client. That code path is gone.

### Move spec-vs-code gaps (flagged by Move agent)

* ~~`SECURITY-V7.md` proposes a 2% Move-level slippage assert in `auto_swap_deposit_to_owner_v2`. The implementation does **not** include it.~~ Resolved 2026-05-27: `SECURITY-V7.md` now states slippage is enforced off-chain by Onara with a 2% target ceiling; the on-chain code asserts only that the destination type is allowed.
* `allowed_providers` is stored on-chain but enforced off-chain only. The on-chain field is currently a hint, not a constraint. Document or change.

### CI (fixed 2026-05-27)

* ~~`.github/workflows/` does not exist at the repo root.~~ Resolved 2026-05-27: `.github/workflows/build-gpu-prover.yml` now exists per Path A §6 of the GPU prover deployment plan. The workflow is `workflow_dispatch` only until pushed to GitHub.

### Vercel region pinning

* `web/vercel.json` does not pin a region. Before flipping `ZK_PROVER_PRIMARY=gpu`, set `regions: ["iad1"]` so the Lambda location is close to the RunPod box that will live in the same region.

## Statistics

* **Files:** 26
* **Total words:** ~27,000
* **Agents:** 5 (parallel)
* **Build time:** ~10 min wall clock end to end

## Maintenance

These docs are point-in-time snapshots. They will drift as code changes. When you touch a major area:

* Move contracts → update `01-05`.
* Adding/removing a web route or lib module → update `10-14`.
* Adding/removing an iOS feature → update `20-24`.
* Changing env vars, hosts, regions, or deploy mechanics → update `30-34`.
* Changing a product flow → update the relevant `4X` doc.

When in doubt, regenerate the affected doc rather than patching. Each was written to stand alone.
