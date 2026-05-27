# zkLogin Prover Comparison — Hosted CPU vs. unconfirmedlabs GPU

_Source: deep read of `https://github.com/unconfirmedlabs/sui-zklogin-gpu-prover` (commit `249c2f8`, last push 2026-05-19), benchmarked against Talise's current `web/lib/zksigner.ts` + `web/lib/shinami.ts` stack._

---

## 1. TL;DR

unconfirmedlabs ships a Rust/Axum HTTP service that is **wire-compatible** with Mysten's `proverServer` (`POST /input`, same 42-field circuit input, same Groth16 BN254 proof on the official `zkLogin-main.zkey`). The GPU path swaps RapidSNARK for ICICLE CUDA and shows a **measured 8.9× speedup on the proof core** (warm: 142ms GPU vs. 1,270ms CPU) and **~3.9× end-to-end** once witness generation and payload conversion are counted (~0.4s warm GPU vs. ~1.5s warm CPU). For Talise's current volume (a few hundred onboarding proofs/day with sub-1s warm path needs), GPU is not yet a forced move — Mysten's hosted prover already lands in 0.8–1.5s cold and ~0ms warm. **Recommended verdict: defer GPU until either (a) >3,000 proofs/day, (b) Shinami/Mysten p99 starts breaching 2s consistently, or (c) Talise wants a fully self-hosted compliance posture. In the meantime, keep Mysten hosted via `ZK_PROVER_URL` as primary and Shinami as the rate-limited fallback.**

---

## 2. The GPU prover at a glance

- **Proving system & circuit compatibility.** BN254 Groth16 on the official Sui zkLogin `zkLogin-main.zkey` (588 MB, 1,020,160 vars, 2^20 domain). Uses Mysten's witness binary (`zkLogin` + `zkLogin.dat`) verbatim. Output proof/public JSON is `snarkjs groth16 verify` clean — i.e., a drop-in replacement for `mysten/zklogin:prover-stable`. Repo explicitly states it is "not trying to replace the zkLogin protocol or circuit."
- **Hardware floor.** Tested host: NVIDIA RTX 5090 (32 GB VRAM), CUDA 12.9, driver 595.71.05, AMD Ryzen 9 9950X (16c/32t). Image targets `nvidia/cuda:12.9.1-base-ubuntu24.04` and requires NVIDIA Container Toolkit + `--gpus all`. Any modern CUDA 12.x GPU with ≥24 GB VRAM should work (e.g., A10G, L4, A100, H100), but **only the RTX 5090 has published numbers**. CPU-only image runs on any x86_64 (150 MB image).
- **License & maintainer.** Apache-2.0. Repo author: `BL <bl@sm.xyz>` (single visible committer in the shallow clone — solo or very small team). Org: `unconfirmedlabs` on GitHub. No corporate backer visible.
- **Activity.** Last commit 2026-05-19 ("Support read-only zkey mounts"). README self-describes as "an engineering prototype that has crossed the first deployment threshold" — **explicitly not yet a hardened replacement for a managed prover service**.
- **Production-readiness signal.** Publishes reproducible benchmarks (`docs/results.md`), CPU + CUDA Docker images, healthz/metrics endpoints, server-timing response headers, scheduler with CPU fallback. But: still shells out to RapidSNARK and ICICLE as **worker processes** (no library integration yet), no concurrency benchmarks (1/2/4/8/16 QPS is on the roadmap), no published prod deployment, no SLO. Treat as **ops-quality prototype, not yet a managed service**.
- **What it is _not_.** It is not a managed endpoint — there is no `unconfirmedlabs.com` API. You build the Docker image yourself and host it on a GPU box.

---

## 3. Wall-clock per proof

All warm numbers come from the repo's `docs/results.md`. Cold Docker GPU includes CUDA/JIT + zkey-load on first request.

| Vendor | Hardware | Cold proof (p50) | Warm proof | Notes |
|---|---|---|---|---|
| **Shinami hosted** (current default) | opaque hosted | 2,000–4,000 ms | ~0 ms (Talise's `perf-cache` short-circuits) | 2/min rate limit (per `web/lib/shinami.ts`). |
| **Mysten hosted** | opaque hosted | 800–1,500 ms | ~0 ms (cached) | Drop-in via `ZK_PROVER_URL`. Mainnet endpoint whitelists audiences; testnet open. |
| **Mysten self-hosted CPU** (`mysten/zklogin:prover-stable`) | c7i.4xlarge, 16 vCPU | ~3,000 ms | 800–1,500 ms | Mysten's published baseline. Not currently deployed by Talise. |
| **unconfirmedlabs CPU image** (`rapidsnark-cpu`) | c7i.4xlarge equivalent | ~1,760 ms (Docker validated) | ~1,500 ms proof + ~260 ms witness ≈ **1,760 ms** | Faster than Mysten's stock CPU image in this benchmark — RapidSNARK is already what Mysten ships. |
| **unconfirmedlabs GPU image** (`icicle-cuda`) | RTX 5090, CUDA 12.9 | **~14,880 ms** (cold Docker, first proof — pays CUDA init + zkey load) | **~400 ms** total (witness 259 ms + GPU proof 142 ms) | _Warm_ proof core alone is 142 ms (8.9× CPU). End-to-end is bottlenecked by CPU-side witness gen (~250 ms) + payload conversion (~170 ms). |
| **Race 2-3 hosted replicas** | n/a | min-of-N hosted | ~0 ms | Kills p90/p99 tail by ~200–500 ms. Cheap latency win without infra. |

**On non-RTX-5090 GPUs (no published benchmark — back-of-envelope):** the warm proof core on RTX 5090 is 142 ms. The zkLogin circuit's dominant cost is two ~2²⁰ MSMs over BN254 G1/G2. MSM throughput on ICICLE roughly scales with peak FP32 / memory-bandwidth product. Rough TFLOPS scaling vs. the 5090 (~104 TFLOPS FP32, 1.8 TB/s memory):

- **A10G** (~31 TFLOPS, 600 GB/s) → ~3.5× slower → **~500 ms warm proof core, ~750 ms end-to-end**
- **L4** (~30 TFLOPS, 300 GB/s) → ~3–4× slower (bandwidth-bound) → **~500–600 ms warm proof core, ~800 ms end-to-end**
- **A100 40GB** (~19 TFLOPS FP32 / 1.5 TB/s) → MSM is bandwidth-heavy → ~1.5× slower → **~210 ms warm proof core, ~470 ms end-to-end**
- **H100** (~67 TFLOPS, 3 TB/s) → likely ~1.3× faster than 5090 on MSM → **~110 ms warm proof core, ~360 ms end-to-end**

These numbers are unvalidated. The repo only publishes RTX 5090, and AWS does not rent RTX 5090.

---

## 4. Cost comparison (≈30k proofs/month = 1,000/day steady-state)

| Vendor | Per-proof $ | Fixed monthly | Crossover vs. Mysten hosted |
|---|---|---|---|
| Shinami hosted | depends on plan; assume bundled with gas station; rate limit 2/min → caps at ~86k/month per key | $0 marginal at current tier | n/a — Talise's current default |
| Mysten hosted | $0 (free, opaque SLO) | $0 | the floor — anything self-hosted has to beat $0 + acceptable latency |
| Mysten self-hosted CPU on c7i.4xlarge | $510/mo ÷ ~2M proofs/mo theoretical = trivial | **~$510/mo** (on-demand) or ~$330 (1yr reserved) | never crosses Mysten hosted on $; only worth it for control/compliance |
| **unconfirmedlabs GPU on g6.xlarge** (NVIDIA L4) | ~$580/mo ÷ projected throughput | **~$580/mo** | crosses Shinami when you outgrow rate-limit, not on $ |
| **unconfirmedlabs GPU on g5.xlarge** (NVIDIA A10G) | similar | **~$720/mo** | same as above |
| unconfirmedlabs GPU on H100 (p5 or rented) | high | $2,000+/mo | only justified at >50k proofs/day or sub-300ms p99 SLO |

**Throughput math at warm GPU steady-state** (single GPU worker, the repo's default `GPU_PROOF_WORKERS=1`):
- 400 ms / proof → **150 proofs/min/GPU = 216k/day theoretical**, in practice ~50–100k/day with headroom.
- At 30k proofs/month (~1k/day), one g6.xlarge is ~1% utilized. **You are paying $580/mo to keep a GPU warm for 14 minutes/day of work.**
- Break-even with Mysten hosted ($0) is never on raw $. Break-even on latency requires Mysten's p99 to consistently breach what 400 ms warm GPU offers.

---

## 5. Capabilities matrix

| Capability | Shinami | Mysten hosted | Mysten self-host CPU | unconfirmedlabs CPU | unconfirmedlabs GPU |
|---|---|---|---|---|---|
| Drop-in via `ZK_PROVER_URL` (see `web/lib/zksigner.ts:37`) | n/a (different SDK path) | yes | yes | yes | yes |
| Same proof envelope as Mysten | yes | yes (it _is_ Mysten) | yes | yes (snarkjs-verified) | yes (snarkjs-verified) |
| Horizontal scaling story | hosted, opaque | hosted, opaque | run N containers behind LB | run N containers behind LB | one GPU per replica; 1 worker per GPU; multi-GPU box ok |
| Auth / API key | API key | none (open mainnet endpoint, but audience-whitelisted) | none (you own the LB) | none (you own the LB) | none (you own the LB) |
| Failure mode if container crashes mid-proof | client retry | client retry | request lost; client retry | request lost; built-in CPU fallback if both backends configured | request lost; falls back to CPU worker if `PROVER_BACKENDS=gpu,cpu` |
| Cold-start time on fresh container | n/a | n/a | ~3s first proof | ~2s first proof | **~15s first proof** (CUDA init + zkey load into VRAM) |
| Cost transparency | opaque | free | linear (EC2) | linear (EC2) | linear (EC2 GPU instance) |

---

## 6. Risks & open questions

1. **Solo-maintainer risk.** Only one visible committer (`bl@sm.xyz`). No corporate sponsor named. Mysten Labs's awareness of / endorsement of the project is unstated. If `bl` stops maintaining the repo, Talise inherits the burden of tracking circuit upgrades.
2. **Circuit-version drift.** The proving key is the official Sui ceremony zkey (good — chain-of-trust preserved). But the witness generator is extracted from `mysten/zklogin:prover-stable`. If Mysten ships a new zkLogin circuit version, `unconfirmedlabs` has to (a) update the witness binary extraction step, and (b) revalidate ICICLE-Snark against the new R1CS. There is no automated CI that confirms this.
3. **Prototype caveats called out by the repo itself.** README literally says "not yet a hardened replacement for a managed prover service." The current implementation **shells out to RapidSNARK and ICICLE as worker processes** — every proof spawns a child process. The roadmap promises direct library integration but it isn't here yet.
4. **No concurrency benchmarks.** All published numbers are single-request. QPS-at-N is on the roadmap but unmeasured. We don't know how the single GPU worker (`GPU_PROOF_WORKERS=1`) holds up at 5 concurrent proofs.
5. **Cold start is brutal (~15s).** First Docker request pays CUDA init + zkey load. A blue/green deploy needs a `/warmup` call before swapping traffic, or users will see one-off 15s onboarding stalls.
6. **Performance volatility on shared cloud GPUs.** Benchmarks are on a bare-metal RTX 5090 owned by the author. AWS g5/g6 instances share NVLink fabric and may exhibit higher tail latency. Untested.
7. **No RTX 5090 in major clouds.** The only published numbers come from a GPU you cannot rent at AWS/GCP/Azure scale. Rough scaling to L4/A10G/A100 puts warm proof core in the 200–500 ms range — still well under Mysten hosted's p50, but no longer the "8.9×" headline.
8. **Race-of-replicas is a cheaper latency win.** Two hosted Mysten replicas + min-of-N already trims p90/p99 by 200–500 ms with $0 marginal infra cost. That delivers most of the felt latency improvement without the GPU operational burden.

---

## 7. Recommendation

**Defer GPU. Adopt Mysten hosted via `ZK_PROVER_URL` as primary, keep Shinami as rate-limit fallback, and add a race-of-two replicas pattern before considering GPU.** At Talise's current scale (low thousands of onboards/month, single-digit proofs/min peak), the Mysten hosted prover hits 0.8–1.5s cold and ~0ms warm — already inside the perceived-instant budget once `perf-cache.ts` warms. Spending $580+/mo on a g6.xlarge to shave 400–600ms off cold proofs is a poor trade until either (a) sustained load passes ~3,000 proofs/day where a self-hosted box becomes a control plane requirement rather than a luxury, (b) Mysten's p99 starts breaching 2s with regularity (currently no signal it will), or (c) compliance/data-residency demands a fully Talise-owned proving stack. **If/when we cross any of those gates, the integration is genuinely a one-line change** (set `ZK_PROVER_URL` to the new container) since `unconfirmedlabs` is wire-compatible with Mysten's `/input`. That low integration cost is itself the reason to keep this repo bookmarked: it's the right escape hatch when we need it, not the right primary today.
