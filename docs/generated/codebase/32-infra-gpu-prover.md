# 32. GPU zkLogin Prover

The largest infra workstream. This doc explains why we built it, what it
is, how to ship it, and how to back out at every checkpoint.

## Why GPU at all

The Sui zkLogin signing flow has one heavy step: generating a Groth16
proof against the official `zkLogin-main.zkey` (~700 MB). On Talise's
current prover (Shinami), that step is 2-4s cold and 0.8-2s warm. On the
RTX 5090 reference build of the unconfirmedlabs prover, it's ~400ms warm.
End-to-end signing latency in Talise is ~99% prover time, so cutting it
to sub-500ms is the single biggest UX lever we have.

Observed numbers:

| Backend                                | Cold p50      | Warm                              |
| -------------------------------------- | ------------- | --------------------------------- |
| Shinami (current production)           | 2,000-4,000ms | ~0ms when Talise's in-mem cache hits |
| Mysten hosted (audience-gated)         | 800-1,500ms   | ~0ms                              |
| Mysten self-host CPU                   | ~3,000ms      | 800-1,500ms                       |
| unconfirmedlabs GPU on RTX 5090        | ~14,880ms (first request, CUDA + zkey load) | ~400ms total (witness 259ms + GPU proof 142ms) |
| unconfirmedlabs GPU on L4 (projected)  | ~15s          | ~500-800ms                        |

## Why we're not on Mysten's allowlist

Mysten's mainnet hosted prover (`prover.mystenlabs.com`) whitelists
OAuth audiences. Talise's Google client ID is not on the allowlist. The
request to be added has not landed at the time of writing, which is why
Shinami is the production primary. Once allowlisted, Mysten hosted
becomes a viable second backend; until then, the choice is Shinami
(slow, rate-limited) or self-host (this doc).

## Upstream project

`unconfirmedlabs/sui-zklogin-gpu-prover` on GitHub.

- Rust/Axum HTTP service.
- Wire-compatible with Mysten's `proverServer`: same `POST /input`, same
  42-field circuit input, same Groth16 BN254 proof on the official
  `zkLogin-main.zkey`.
- Swaps RapidSNARK (CPU) for ICICLE-Snark (CUDA) on the proof core.
- Apache-2.0. Solo-maintainer risk: only one visible committer
  (`bl@sm.xyz`); no corporate sponsor. Treat as an ops-quality prototype,
  not a managed service. See `docs/security/ZKLOGIN-PROVER-COMPARISON.md` for the
  full risk write-up.

## Our Docker layering

We do NOT run the upstream image directly. We wrap it:

`infra/prover/gpu/Dockerfile.talise:30-47` layers on top of the upstream image
(tagged `sui-zklogin-icicle-cuda:upstream` after building from source on
the GPU host) and adds:

1. `tini` as PID 1: proper signal handling, reaps orphaned witness /
   proof worker processes if the Rust binary panics.
2. A Docker `HEALTHCHECK` against `/healthz` (`Dockerfile.talise:44-45`)
   with a 120s start-period to cover cold zkey load.
3. Explicit `ENTRYPOINT ["/usr/bin/tini", "--", "/workspace/bin/zklogin-prover-entrypoint"]`.

Final tag: `ghcr.io/seventhodyssey71/sui-zklogin-gpu-prover:v1`.

We deliberately do NOT run as non-root inside the container; the
upstream image needs `/workspace` and `/tmp` writable for ICICLE-Snark's
zkey copy-on-start, and the ICICLE CLI wants raw access to the GPU
device file. Confinement happens at the host (seccomp, read-only host
mount of the zkey).

## The 4-target provisioner

`infra/prover/gpu/deploy.sh` is the single entry point. Takes a
`--target=` flag (default `runpod`). One shell script, four code paths:

| Target        | Default GPU SKU      | Required env                              |
| ------------- | -------------------- | ----------------------------------------- |
| `runpod`      | NVIDIA L4 24GB       | `RUNPOD_API_KEY`                          |
| `lambda-labs` | `gpu_1x_a10`         | `LAMBDA_LABS_API_KEY`                     |
| `aws`         | `g6.xlarge` (L4)     | AWS creds + `AWS_KEYPAIR_NAME`            |
| `fly`         | A100-40GB            | `FLY_API_TOKEN` + `FLY_FORCE=1` (gated, not recommended) |

Common env (`infra/prover/gpu/deploy.sh:50-53`):

- `DOMAIN` default `zk-prover.talise.io`
- `ADMIN_EMAIL` default `claudedummies@gmail.com` (Let's Encrypt
  expiration notices)
- `IMAGE` default `ghcr.io/seventhodyssey71/sui-zklogin-gpu-prover:v1`
- `ZK_PROVER_AUTH_TOKEN` **required**. Caddy rejects unauthenticated
  POSTs to `/input` and `/warmup`. Generate with `openssl rand -hex 32`,
  set it both on the deploy host (so Caddy gates the endpoints) and on
  Vercel (so `web/lib/zksigner.ts::callProver` attaches it as the
  outbound `Authorization: Bearer ...` header). `/healthz` stays public
  for uptime checks.

The script's anatomy:

1. Preflight (`deploy-gpu-prover.sh:67-77`): warns when `GHCR_TOKEN`
   is absent and `gh auth token` can't fall through.
2. Bootstrap heredoc (`deploy-gpu-prover.sh:91-251`): uploaded to the
   new host via SSH (or user-data on AWS). Installs Docker + NVIDIA
   Container Toolkit + Caddy, fetches `zkLogin-main.zkey` via git-lfs
   from the Sui ceremony repo, verifies Blake2b (`060beb961802...bcbcbce`),
   runs the prover container, writes a Caddyfile reverse-proxying
   `${DOMAIN}` to `127.0.0.1:8080` with auto-ACME.
3. Per-provider provisioning (`deploy-gpu-prover.sh:265-525`): each
   `deploy_*` function fails fast with explicit signup steps when its
   API key is missing.

Idempotency: re-running on the same host upgrades the image without
re-downloading the zkey.

## The Mac build problem

You cannot build the GPU image on an Apple Silicon Mac. Two root
causes: (a) the Mac is arm64 while the upstream image targets amd64,
and the upstream Dockerfile invokes the ICICLE-Snark CLI during build
to extract witness binaries (running it under QEMU emulation either
fails or produces a build that won't load CUDA on the target host);
(b) macOS dropped NVIDIA driver support in 2019, so even if cross-build
succeeded you cannot validate the result locally because the Mac has
no GPU.

Three viable paths around the wall:

- **(Recommended) GitHub Actions cross-build**. An `ubuntu-22.04`
  runner with Docker Buildx + `linux/amd64`, pushed to `ghcr.io`. Not
  yet wired up; on the roadmap.
- **Build-on-GPU-host (one-shot)**. Provision via
  `deploy-gpu-prover.sh`, SSH in, build the upstream image and the
  `Dockerfile.talise` wrapper on the GPU box itself, push to ghcr.io.
  Documented in `infra/prover/gpu/DEPLOY.md:160-178`.
- **Patch bootstrap to build inline**. Modify the bootstrap heredoc in
  `deploy-gpu-prover.sh:91-251` to `git clone` and build before
  running, skip the ghcr.io pull entirely. Loses the tini wrapper and
  HEALTHCHECK unless you also bake `Dockerfile.talise` in.

Is Mac build truly impossible? No, you can `buildx build
--platform=linux/amd64` and host the result somewhere. But you cannot
validate locally without a GPU, which is what makes this unsuitable as
the canonical path.

## Smoke test

`infra/prover/gpu/smoke.sh <URL>` is the wire-compatibility check
against `web/lib/zksigner.ts::normalizeProverResponse`. It validates:

1. `GET /healthz` returns 200 (`zk-prover-smoke.sh:46-53`).
2. `POST /warmup` returns 200/202/204 (no payload mode) OR `POST /input`
   returns a body with `proofPoints` / `issBase64Details` /
   `headerBase64`, accepting either camelCase or snake_case
   (`zk-prover-smoke.sh:135-144`).
3. Reports the round-trip in ms.

Exit 0 means "safe to flip `ZK_PROVER_PRIMARY=gpu`". Exit 1 means do not
flip; either patch `normalizeProverResponse` in
`web/lib/zksigner.ts:189-205` for the actual key names the prover
returns, or file an issue against upstream.

For a deeper test (real proof end-to-end), pipe a captured zkLogin input
JSON on stdin:

```bash
bash infra/prover/gpu/smoke.sh https://zk-prover.talise.io < real-input.json
```

## Babysit playbook

`infra/prover/gpu/BABYSIT.md` is the 48-hour rollout. Every step has
a single-env-var rollback under 3 minutes. Summary of checkpoints:

| T          | Action                                                | Single-env-var rollback |
| ---------- | ----------------------------------------------------- | ------------------------ |
| T+0        | `bash infra/prover/gpu/deploy.sh --target=runpod`    | Nothing wired yet; teardown only. |
| T+5m       | Add DNS A record `zk-prover.talise.io` -> pod IP. Trigger first ACME cert. | Delete A record. |
| T+10m      | `bash infra/prover/gpu/smoke.sh https://zk-prover.talise.io`. Must exit 0. | None on Vercel side. |
| T+15m      | Set `ZK_PROVER_GPU_URL=https://zk-prover.talise.io/input` and `ZK_PROVER_CANARY_PCT=25`. `PRIMARY` stays at `shinami`. | Set `CANARY_PCT=0`, redeploy. |
| T+1h       | First health check. `vercel logs --prod --since 1h \| grep "\[zk-prover\]"`. Pass criteria: fallback rate <1%, GPU p99 <4s. | Same as T+15m. |
| T+12h      | If clean, bump `CANARY_PCT` to `50`. | Set `CANARY_PCT=0`. |
| T+24h      | Flip `ZK_PROVER_PRIMARY=gpu`, `CANARY_PCT=0`. 100% on GPU primary, Shinami still backstops 5xx. | Set `PRIMARY=shinami`, redeploy. |
| T+48h      | (Optional) Set `ZK_PROVER_FALLBACK=none` if you want to drop Shinami entirely. | Set `FALLBACK=shinami`. |

Emergency rollback when the GPU box dies (kernel panic, RunPod outage):
`FALLBACK=shinami` is already true unless you explicitly removed it at
T+48h, so every in-flight request auto-falls-back. To stop wasting the
first 30s of every request, flip `PRIMARY` back to `shinami` and
redeploy. Details in `infra/prover/gpu/BABYSIT.md:200-218`.

## Canary architecture

The runtime toggle is already shipped in `web/lib/zksigner.ts`. The
relevant env vars (defaulted in code at lines 73-94):

- `ZK_PROVER_PRIMARY`: `"gpu" | "shinami" | "mysten"`. Default
  `"shinami"`.
- `ZK_PROVER_FALLBACK`: same set plus `"none"`. Default `"shinami"`.
- `ZK_PROVER_GPU_URL`: full URL including `/input` path. The signer
  POSTs directly here, no path appended.
- `ZK_PROVER_CANARY_PCT`: integer 0..100. When >0, a deterministic
  bucket of users gets routed to GPU regardless of PRIMARY; the rest
  fall through to PRIMARY.
- `ZK_PROVER_TIMEOUT_MS`: per-attempt timeout. Default 8000ms (generous
  enough for the GPU cold-load on first call).

The canary bucketing is FNV-1a hash of the user's `addressSeed` mod 100
(`web/lib/zksigner.ts:103-110`). Stable per-user, so once a user is in
the canary bucket they stay there across sessions.

The signing entry point is `callProverWithFallback`
(`web/lib/zksigner.ts:225-283`). It walks `[primary, fallback]` in
order, returns on the first 200, and logs a single low-cardinality line
per attempt:

```
[zk-prover] role=primary backend=gpu attempt=1 status=200 ms=412
[zk-prover] role=fallback backend=shinami attempt=2 status=200 ms=2740
```

These lines are intentionally greppable. Use them to track fallback
rate (lines with `role=fallback` divided by lines with `role=primary
backend=gpu`).

Wire format tolerance lives in `normalizeProverResponse`
(`web/lib/zksigner.ts:189-205`). Mysten and Shinami return camelCase
(`proofPoints` / `issBase64Details` / `headerBase64`); some GPU builds
return snake_case (`proof_points` / `iss_base64_details` /
`header_base64`). The normalizer accepts both.

## The flip decision

Per `docs/security/ZKLOGIN-PROVER-COMPARISON.md` Section 7, the recommendation is
to keep Shinami until ONE of these crosses:

- > 3,000 proofs/day sustained (where self-host becomes a control-plane
  requirement, not a luxury).
- Shinami / Mysten p99 starts breaching 2s with regularity.
- Compliance or data-residency requires a fully Talise-owned stack.

At today's volume (low thousands of onboards/month), the GPU box costs
~$317/month (RunPod L4) and saves perhaps 800ms off cold proof. That's
not a forced move yet. The infrastructure is built so the flip is
*reversible in 3 minutes*; treat the rollout as a feature you can ship
when you want it, not a migration you must complete.

## Open issues to settle before going production

1. `ghcr.io/seventhodyssey71/sui-zklogin-gpu-prover:v1` must exist and
   be pullable (public or with `GHCR_TOKEN`). The image is not built in
   CI today, see "The Mac build problem" above.
2. Vercel region pinning. `web/vercel.json` does NOT set `regions`. For
   GPU on AWS `us-east-1`, pin to `["iad1"]` before measuring p50 or
   the round trip will eat 100-200ms in transit.
3. The L4 vs A10G/A100 latency curve is projected, not measured. Run
   the smoke test on the chosen SKU and verify warm proof core is under
   600ms before flipping `PRIMARY=gpu`.
