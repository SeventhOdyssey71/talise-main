# Sui mainnet gRPC endpoints — research + fallback strategy

**Date:** 2026-05-27
**Trigger:** today's `fullnode.mainnet.sui.io:443` outage (503 `no_healthy_upstream`)
took down the iOS gRPC test run and 10/43 web integration tests. We need a
multi-provider fallback so a single Mysten Labs node failure doesn't take the
whole app offline.

This document is purely research + plan. The wrapper code lives in
`web/lib/sui-endpoints.ts` and `ios/Talise/Network/SuiEndpoints.swift`. It is
**not** wired into the existing `sui()` / `SuiGrpcClient.shared` callers yet —
that substitution is the follow-up cohort.

---

## 1. Findings

JSON-RPC is being permanently deactivated on **July 31, 2026** ([Sui blog](https://blog.sui.io/graphql-archival-store-sui-data-stack/)), so the
provider universe we care about is whoever supports **gRPC** today. Of the
~12 Sui mainnet public RPC providers, only a subset have gRPC live:

| # | Provider | gRPC endpoint | Auth | Free tier? | Notes |
|---|---|---|---|---|---|
| 1 | **Mysten Labs (public)** | `https://fullnode.mainnet.sui.io:443` | none | yes, 100 req/30s rate-limited | Current default. The outage source. ([docs.sui.io](https://docs.sui.io/concepts/sui-architecture/networks)) |
| 2 | **Mysten Labs (archival)** | `https://archive.mainnet.sui.io:443` (per internal sub-plan docs) | none | yes | Higher-retention point lookups. Not in current Sui docs; treat as best-effort. ([docs.sui.io grpc-overview](https://docs.sui.io/concepts/data-access/grpc-overview)) |
| 3 | **Shinami** | `https://api.us1.shinami.com/sui/node/v1` (us1) / `https://api.apac1.shinami.com/sui/node/v1` (apac1) | `X-Api-Key` header | paid (region-scoped key) | We already use Shinami for zkLogin + gas station; `SHINAMI_API_KEY` already in `.env.local`. Verify gRPC is exposed on this URL — Shinami's docs primarily document the JSON-RPC path; gRPC parity is implied but not loudly advertised. ([Shinami docs](https://docs.shinami.com/docs/authentication-and-api-keys)) |
| 4 | **Triton One** | endpoint URL not published publicly ("GRPC beta") | proprietary header (request via dashboard) | paid only | ([docs.triton.one/chains/sui](https://docs.triton.one/chains/sui)) |
| 5 | **QuickNode** | `https://<name>.sui-mainnet.quiknode.pro:9000` | token embedded in URL path | freemium | ([quicknode.com/docs/sui/sui-grpc](https://www.quicknode.com/docs/sui/sui-grpc/overview)) |
| 6 | **Dwellir** | `api-sui-mainnet-full.n.dwellir.com:443` | `x-api-key` header | paid ($1.96 / M req) | ([dwellir.com/docs/sui/grpc-overview](https://www.dwellir.com/docs/sui/grpc-overview)) |
| 7 | **GetBlock** | endpoint URL gated to account dashboard | account token | free tier supports gRPC | ([getblock.io blog](https://getblock.io/blog/getblock-sui-grpc-support/)) |
| 8 | **BlockVision** | endpoint URL gated to dashboard | account token | freemium | gRPC service live, full RPC method set. ([docs.blockvision.org/reference/grpc-for-sui](https://docs.blockvision.org/reference/grpc-for-sui)) |
| 9 | **OnFinality** | JSON-RPC only at `https://sui.api.onfinality.io/public` | none | yes | **No gRPC** as of 2026-05. ([onfinality.io](https://onfinality.io/en/networks/sui)) |
| 10 | **Allnodes / publicnode** | JSON-RPC only at `https://sui-rpc.publicnode.com/` | none | yes | **No gRPC.** |
| 11 | **BlockPI** | JSON-RPC only at `https://sui.blockpi.network/v1/rpc/public` | none | yes | **No gRPC.** |
| 12 | **Chainstack / 1RPC / Tatum / Pocket / OMNIA / Nodeinfra** | JSON-RPC only | varies | yes | **No gRPC** in their public Sui product (as of 2026-05). |

**Provider mix for gRPC fallback:** 1 public (Mysten) + 1 archival (Mysten) +
6 paid-or-keyed (Shinami, Triton, QuickNode, Dwellir, GetBlock, BlockVision).
Everything else is GraphQL-only or JSON-RPC-only and cannot serve our
`SuiGrpcClient` callers without an additional shim.

---

## 2. Auth model summary

Three flavors, all handled by the wrapper:

1. **No auth** — Mysten public + Mysten archival. Construct the client with
   just `baseUrl`.
2. **Header auth** — Shinami (`X-Api-Key`), Dwellir (`x-api-key`),
   GetBlock / BlockVision / Triton (provider-specific header, exact name
   TBD per provider docs once we enable). The wrapper passes a `meta` object
   to `SuiGrpcClient` (via the `GrpcWebOptions.meta` field — `@protobuf-ts`
   sends every key/value as gRPC metadata, which translates to HTTP headers
   over gRPC-Web).
3. **URL-embedded token** — QuickNode (the token is part of the host name).
   Wrapper just constructs the full URL from `process.env`.

All keys are read from env vars on web and from Keychain on iOS. **None are
hard-coded.** If a key env var is unset, that endpoint is skipped (the
wrapper logs and moves on).

---

## 3. Fallback chain (current preference)

Order is biased toward (a) endpoints we already have a working key for and
(b) operational maturity. Anything paid-with-no-key is included but inert
until the env var is set.

```
1. fullnode.mainnet.sui.io:443           # Mysten, free, current default
2. archive.mainnet.sui.io:443            # Mysten, free, archival sibling
3. api.us1.shinami.com/sui/node/v1       # Shinami, key already provisioned
4. api-sui-mainnet-full.n.dwellir.com:443  # Dwellir, requires DWELLIR_API_KEY
5. <name>.sui-mainnet.quiknode.pro:9000  # QuickNode, requires QUICKNODE_SUI_URL
```

**Recommended #2 once vetted:** the Mysten *archival* node. It's the only
non-Mysten-correlated free option already in the docs and doesn't burn a paid
budget on every failover. If the archival sibling is on the same upstream
cluster (i.e. correlated failure with the primary), promote Shinami to #2 —
Shinami is the strongest candidate among providers we already have a key for,
and its zkLogin services have been our most reliable Sui vendor relationship.

---

## 4. What the wrapper does (and doesn't)

**Does:**
- Iterates the ordered endpoint list, constructing a fresh `SuiGrpcClient` per
  endpoint (the existing constructor already supports `baseUrl` + `meta`).
- Catches errors whose gRPC code is `UNAVAILABLE` (=14) or `DEADLINE_EXCEEDED`
  (=4), or whose `code` string is `"unavailable"` / `"deadline_exceeded"`
  (case-insensitive). Both forms occur because `@protobuf-ts` uses the
  string form, while `grpc-swift` uses the enum form.
- Returns the first success, surfaces the last error if all endpoints fail.
- Skips endpoints whose `requiresAuth: true` flag is set but whose env-var-
  derived key is unset.

**Doesn't (intentionally):**
- Replace `sui()` in `web/lib/sui.ts` or `SuiGrpcClient.shared` in
  `ios/Talise/Network/SuiGrpcClient.swift`. That substitution is the next
  cohort — see §5 below.
- Cache per-endpoint clients (the in-memory cache lives one level up at
  `sui()`; per-call wrapping is cheap because gRPC-Web reuses the underlying
  fetch connection pool).
- Retry the same endpoint multiple times. The existing retry-once is already
  in `SuiGrpcClient` (Swift) and the SDK has its own internal retries for the
  web side; the wrapper is a *new-endpoint* fallback layer, not a per-endpoint
  retry layer.

---

## 5. Substitution path (next cohort, not in this change)

Once the wrapper is vetted by green CI for ≥1 week we substitute it into the
caller surface in two steps:

1. **Web** — change `web/lib/sui.ts` so `sui()` returns a `Proxy`-wrapped
   client whose method calls go through `suiGrpcWithFallback`. Each method
   call becomes one fallback chain attempt. Keep the existing in-memory
   cache key, but key it on the *successful* endpoint instead of the
   default. Affects: every caller of `sui()` (currently ~30 sites in
   `web/lib/` and `web/app/api/`).

2. **iOS** — change `SuiGrpcClient.shared` from a singleton to a wrapper
   that walks `mainnetGrpcEndpoints` per call. Each endpoint gets its own
   long-lived `HTTP2ClientTransport.Posix` channel (already lazy in the
   current code), so the cost of N endpoints is N idle TCP connections —
   acceptable. Affects: every `SuiGrpcClient.shared.*` caller in the iOS
   app (currently 4 sites in `ZkLoginCoordinator`, `WalletAPI`, etc.).

Before substitution we also need to:
- Confirm each provider's gRPC endpoint actually serves the
  `sui.rpc.v2.LedgerService` / `StateService` / `TransactionExecutionService`
  protos we depend on (Shinami's docs leave this ambiguous).
- Decide on per-endpoint timeout budgets. Today the Swift client uses 8s
  per attempt; with 5 endpoints in the chain that's a worst-case 40s tail.
  The web side has no explicit timeout, so we add one with the wrapper
  (suggest 6s per attempt = 30s tail across 5 endpoints).
- Wire endpoint-level telemetry (which endpoint served which call) so we can
  retire low-performers.

---

## 6. Sources

- [Sui Docs — Networks](https://docs.sui.io/concepts/sui-architecture/networks)
- [Sui Docs — gRPC Overview](https://docs.sui.io/concepts/data-access/grpc-overview)
- [Sui Docs — Accessing Data](https://docs.sui.io/concepts/data-access/data-serving)
- [Sui Blog — GraphQL and Archival Store](https://blog.sui.io/graphql-archival-store-sui-data-stack/)
- [Shinami Docs — Auth and API Keys](https://docs.shinami.com/docs/authentication-and-api-keys)
- [Shinami Docs — Node Service overview](https://docs.shinami.com/api-docs/sui/node-service/json-rpc/overview)
- [Triton One — Sui chain page](https://docs.triton.one/chains/sui)
- [QuickNode Docs — Sui gRPC overview](https://www.quicknode.com/docs/sui/sui-grpc/overview)
- [Dwellir Docs — Sui gRPC overview](https://www.dwellir.com/docs/sui/grpc-overview)
- [GetBlock Blog — Sui gRPC support](https://getblock.io/blog/getblock-sui-grpc-support/)
- [BlockVision Docs — gRPC for Sui](https://docs.blockvision.org/reference/grpc-for-sui)
- [OnFinality — Sui Mainnet](https://onfinality.io/en/networks/sui)
- [Dwellir Blog — Best Sui RPC Providers 2026](https://www.dwellir.com/blog/best-sui-rpc-providers-2025)
- [ComparedNodes — Sui public endpoints](https://www.comparenodes.com/library/public-endpoints/sui/)
- [Chainstack — How to get a Sui RPC endpoint](https://chainstack.com/how-to-get-sui-rpc-endpoint-2026/)
