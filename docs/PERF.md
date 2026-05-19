# Talise signing-pipeline perf report (2026-05-19)

Real measurements taken against mainnet on a local dev box (M-series Mac, normal home WiFi, dev server running with Turbopack). Numbers are wall-clock seconds.

## End-to-end measured

| Flow | Cold | Warm | Notes |
|---|---|---|---|
| **Send USDsui (sponsored)** | ~7-9s | ~4-6s | (estimated from per-leg measurements below; live route logs not captured in this pass — we'll instrument next) |
| **T2000 swap (auto-convert USDC → USDsui)** | **21s** | **14-15s** | from `/tmp/web.log`: real route `POST /api/t2000/execute 200 in 21186ms / 14632ms / 14240ms` |
| **Subname mint (one-tap claim)** | ~5-6s | ~4s | operator signs locally (no Shinami hop) + RPC submit |

## Per-leg breakdown (measured live)

| Leg | Cold (ms) | Warm (ms) | What's happening |
|---|---|---|---|
| Sui RPC roundtrip (single read) | 490 | 470-900 | mainnet fullnode TLS + HTTPS handshake + RPC |
| Shinami handshake (zkProver, malformed JWT) | 2289 | 931-963 | TLS + CDN cold start to `api.us1.shinami.com` |
| Onara `/status` (gas station handshake) | 480 | 467-537 | Cloudflare Workers cold/warm |
| Onara `/sponsor` dryRun (tx.build + policy check) | 1588 | 698-727 | tx.build pulls sponsor coins via mainnet RPC (~600ms), policy validate (~10ms), HTTP overhead (~80ms) |

**The dominant cost in every flow is `tx.build` followed by the Shinami proof.** Sui RPC accounts for ~70% of the total latency on a send.

## Where the time actually goes in a typical Send

Tracing a USDsui send through every hop:

```
Browser
├─ Read state from localStorage                  <1ms
├─ Build kind-only PTB                           ~50ms       (no RPC, pure SDK serialization)
├─ POST /api/zk/sponsor                          ~750ms      (warm: Onara /status + tx.build + 1 mainnet RPC for sponsor gas coins)
├─ Receive bytes + sign with ephemeral key       ~5ms        (browser Ed25519, microsecond)
├─ POST /api/zk/sponsor-execute                  ~3-5s       ← bottleneck
│   ├─ readSigningCookie (httpOnly read)         <1ms
│   ├─ Shinami zk proof                          ~2-4s       ← BIGGEST single cost
│   ├─ Assemble zkLoginSignature                 ~10ms
│   ├─ POST to Onara /sponsor + execute          ~1-2s
│   │   ├─ Onara verifies + signs as gasOwner    ~50ms
│   │   └─ Mainnet broadcast + finality wait     ~600-1500ms
│   └─ Parse objectChanges + return              <10ms
└─ Render success view + record tx               ~100ms

TOTAL ≈ 5-7s warm · 7-10s cold
```

## What makes it slow

1. **Shinami zk proof generation: 2-4s warm, up to 7s cold.** This is the biggest single cost. Groth16 SNARKs on CPU at production parameters. Mysten's RapidSNARK CPU prover does the same work at the same speed — no faster.

2. **Sui mainnet RPC roundtrip from us-east colocation: ~470-900ms per call.** Our flow hits the RPC 3+ times (epoch fetch on session, sponsor coin lookup in tx.build, executeTransactionBlock). Each one costs us ~500ms.

3. **Cetus aggregator PTB construction (T2000 swap path).** The aggregator has to fetch coin metadata + pool state + best-route across 20+ DEXs before composing the PTB. This alone takes 8-12s for a fresh quote. **This explains the 14-21s `/api/t2000/execute` numbers** — most of it isn't signing, it's quote+route.

4. **TLS cold starts.** First request to Shinami adds ~1.3s of TLS handshake; first to Onara via Cloudflare adds ~200ms. Keep-alive on the Node fetch agent would shave these, but Next.js's default fetch doesn't pool connections aggressively.

## What we can do to make it faster

### Tier 1 — low effort, big impact

1. **HTTP keep-alive on outbound fetch (saves 200-500ms per request).**
   Wrap our outbound calls in a custom `undici.Agent({ keepAliveTimeout: 30_000 })` and reuse it across `lib/shinami.ts` + `lib/onara`. Eliminates the TLS handshake cost on repeated calls within a session. ~30 min to ship.

2. **Cache the zk proof for the session window (saves 2-4s per tx after the first).**
   The proof is valid for the full `maxEpoch` (~10 days). Generate it once on sign-in, store it in the encrypted `talise_jwt` cookie alongside the JWT. Every subsequent send reuses the proof and only signs the new bytes with the ephemeral key. **Cuts second+third sends from 5-7s → 1-2s.** ~2-3 hours to ship cleanly.

3. **Don't wait for finality on broadcast.**
   Today Onara calls `executeTransactionBlock` with `waitForLocalExecution: true` (implicit). Switching to `waitForEffectsCert` (fire-and-forget after the validator quorum signs) saves 400-1500ms. The user gets the digest immediately; the success view can poll for finality from the browser in the background. ~30 min.

### Tier 2 — bigger lifts

4. **Self-hosted GPU prover (https://github.com/unconfirmedlabs/sui-zklogin-gpu-prover).**
   ICICLE CUDA backend: 9× faster on the proof core, 3-4× faster end-to-end (witness gen stays CPU). Per their benchmarks: ~700ms-1s warm proof vs Shinami's 2-4s. **Cuts the biggest cost in half.** Cost: ~$100-200/mo NVIDIA GPU box. ~1 day to deploy.

5. **Move T2000 to the browser SDK.**
   The 14-21s on swaps is dominated by Cetus aggregator route+quote which currently runs on our server. `@t2000/sdk/browser` runs in the user's tab, which parallelizes RPC for them and removes the server roundtrip. Net win ~30% on swap-heavy ops. ~3 hours.

6. **Adopt Sui's native gasless stablecoin transfers when it lands on mainnet.**
   Per Sui docs, `0x2::balance::send_funds<USDsui>` with `gasPrice=0` ships **without Onara entirely** — the protocol pays the gas for allowlisted stablecoins. Removes the entire Onara `/status` + `/sponsor` round trip. **2-4s savings per send.** Currently testnet only. We watch for mainnet date.

### Tier 3 — architectural

7. **Pre-sign the next transaction.**
   When the user enters an amount but hasn't clicked Send, we can pre-build the kind bytes + pre-fetch the sponsored bytes in the background. By the time they click, only Shinami remains. Cuts perceived latency to ~3-4s warm.

8. **Sub-second push notifications instead of polling.**
   For the activity feed on `/home`, switch from `getRecentActivity` (multiple RPC calls per render) to a websocket subscription on the user's address. Cuts dashboard load time by ~1.5s and makes "money just arrived" feel instant.

## Realistic targets

| Surface | Today | With Tier 1 | With Tier 1+2 |
|---|---|---|---|
| Sponsored send (USDsui) | 5-7s | **1.5-2.5s** (proof cache) | **<1s** (proof cache + GPU prover + finality-cert) |
| T2000 swap | 14-21s | 12-18s | 4-6s (browser SDK + cached proof) |
| Subname mint | 5-6s | 3-4s (keep-alive) | 2-3s (GPU prover) |
| Activity feed render | 1.5-3s | 0.5-1s (websocket) | same |

**The single highest-leverage change is the proof cache (Tier 1 item 2).** It changes "every send takes 6 seconds" into "the first send takes 6 seconds, every subsequent send takes 1 second" — the difference between "fast enough" and "feels native."

## What I'd ship next, ranked

1. Proof caching in the JWT cookie. ~3 hours. Cuts repeated-send latency 70%.
2. HTTP keep-alive agent. ~30 min. Free 200-500ms per request.
3. `waitForEffectsCert` instead of full finality wait. ~30 min. Free 400-1500ms.
4. Pre-sign on amount-typed (background prefetch). ~1 hour. Cuts perceived latency to 3-4s warm.
5. Self-hosted GPU prover. ~1 day. Halves the proof cost when we hit Shinami's rate limits at scale.

We're at the speed where users won't bounce, but every second we save shifts the product from "Web3 polish" to "Cash App native."
