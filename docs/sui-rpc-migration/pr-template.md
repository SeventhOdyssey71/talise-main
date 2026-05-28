# Sui RPC Migration — PR Template

> Use this template for every PR landing a JSON-RPC → gRPC (or GraphQL) migration sub-plan.
> Keep it terse. Tick boxes. Delete sections that don't apply with a note saying *why*.

---

## 1. Sub-plan ID

- [ ] Closes sub-plan **`<phase>.<n>`** — `<one-line title from 50-subplans.md>`
  - e.g. *Closes sub-plan 1.4 (`/api/tx/record` verifier swap)*
- [ ] Linked to migration-plan.md phase: **Phase `<0|1|2|3|4|5>`**

## 2. What changed

- **Site(s) migrated:** `<file:line>` (+ any helper modules)
- **Old method:** `<jsonRpc method name>` via `SuiJsonRpcClient`
- **New method:** `<grpc method>` via `sui()` *or* `<graphql query>` via `suiGraphQL()`
- **Transport rationale:** point-read / paginated history / execution → gRPC vs GraphQL choice matches Appendix A of the migration plan.

## 3. Response-shape diff

List every field the caller reads whose path/name changed. If none, write "no shape diff — drop-in replacement" and explain why.

| Reader uses | Old (JSON-RPC) | New (gRPC/GraphQL) |
|---|---|---|
| sender address | `transaction.data.sender` | `transaction.sender` |
| status | `effects.status.status === "success"` | `effects.status === "SUCCESS"` |
| ... | ... | ... |

- [ ] All readers updated (no callers left reading the old path)
- [ ] If a `normalize*Shape()` helper was introduced, link to it: `<path>`

## 4. Backward compatibility

- [ ] **No** — feature-flag flip (`TALISE_LEGACY_JSONRPC=0` for this site) kills the old path in the same PR.
- [ ] *Or* — Yes, JSON-RPC remains reachable behind the flag. Justify here: `<reason>`. (Default expectation: no.)
- [ ] Flag default state after this PR: `<0 | 1>` for this site.

## 5. Test added

- [ ] Integration test added under `web/__tests__/sui/` *or* `ios/.../Tests/`: `<path>`
- [ ] Test hits real mainnet read data (read-only) — link to test run
- [ ] Test exercises the **new** transport (no JSON-RPC fallback in the test path)

## 6. Regression run (prod-smoke)

All five must be green before merge. Paste links/screens or check from the prod-smoke dashboard.

- [ ] Send (gasless)
- [ ] Send (sponsored, with round-up supply leg)
- [ ] Supply (NAVI)
- [ ] Withdraw (NAVI)
- [ ] Activity feed (mixed entries render, no missing rows)

## 7. Performance check

- [ ] No regression: p50/p95 of the migrated call ≤ pre-migration baseline.
- [ ] If regression OR improvement, paste log evidence below:

```
<paste log line(s) with before/after timing, ideally from prod or staging>
```

- [ ] Round-trip count: `<old N>` → `<new N>` (GraphQL multi-entity reads often collapse 2-3 calls into 1)

## 8. Reviewer focus

> One line. Tell the reviewer where to look hardest. Usually the **response-shape diff** in section 3 — that's where bugs hide.

`<e.g. "Verify section 3 — the verifier reads effects.status as a string now, not an object.">`

---

### Pre-merge checklist (must all be ticked)

- [ ] Sections 1–8 complete
- [ ] No new `SuiJsonRpcClient` imports outside the shrinking allowlist (CI gate 0.5 passes)
- [ ] `pnpm test:integration` green locally
- [ ] Sub-plan marked done in tracking sheet
