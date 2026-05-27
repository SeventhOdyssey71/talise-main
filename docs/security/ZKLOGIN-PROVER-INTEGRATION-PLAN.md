# zkLogin Prover Integration Plan

Sister doc: `docs/security/ZKLOGIN-PROVER-COMPARISON.md` (technical / cost / risk comparison).
This doc is the **action plan** — the concrete deployment sequence for swapping Talise's zkLogin prover backend.

---

## 1. Goal

Cut zkLogin total signing time to **≤ 1000 ms p50 on the cold path** (today: 2–4 s on Shinami's hosted prover, per the timing literals in `web/lib/zksigner.ts:112` and `web/lib/zkclient.ts:32`). Two parallel tracks reach this target:

- **Engineering track** — faster prover backend (Mysten hosted → self-hosted CPU → unconfirmedlabs GPU). The work scoped in this doc.
- **UX track** — never block on the cold path. Pre-mint a proof at OAuth callback time and again opportunistically while the user is typing recipient / amount. The 55-minute proof cache (`writeCachedProof` in `web/lib/zkclient.ts:99-106`) means a single pre-warm covers the entire session. **Tracked separately — out of scope here.**

This doc is engineering-only. UX pre-warm is a separate ticket; the two should land in either order.

---

## 2. Three-step rollout

Each step ships in 1–3 days, lands value independently, and is reversible by un-setting a single env var.

### Step 1 — Drop Shinami, switch to Mysten's hosted prover

**Effort:** ~1 engineering day. **Recurring cost:** $0/month.

The shortest path to a measurable win. `web/lib/zksigner.ts:36-43` already short-circuits to `ZK_PROVER_URL` when set, so this is purely a Vercel env-var change.

Steps:
1. Confirm Talise's OAuth client id (Google) is whitelisted on Mysten's mainnet prover. Mysten requires per-audience whitelisting on `prover.mystenlabs.com`. **[VERIFY]** — submit/confirm via Mysten Discord or the zkLogin form in their docs: <https://docs.sui.io/concepts/cryptography/zklogin#run-the-proving-service-in-your-backend>. This is why we ended up on Shinami in the first place (see comment in `web/lib/shinami.ts:6-12`); confirm the whitelist is now live before flipping.
2. On Vercel (production env): set `ZK_PROVER_URL=https://prover.mystenlabs.com/v1` **[VERIFY canonical URL — Mysten has historically rotated between `prover.mystenlabs.com/v1` and a numbered version. The README at <https://github.com/MystenLabs/zklogin-prover-fe> is the source of truth.]**
3. Critically — **also unset `SHINAMI_API_KEY` on Vercel**. `web/lib/zksigner.ts:150` branches on `shinamiEnabled()` *before* falling back to `callProver()`, so Shinami still wins if the API key is present. Either remove the key, or stop checking it. (See Section 3 for the one-line code follow-up if we want a cleaner gate.)
4. Redeploy. No code change.
5. Run `pnpm node web/scripts/zk-speed-test.mjs` with a fresh `ZK_TEST_JWT` against production. Expect prover RT p50 ≈ 800–1,500 ms (vs Shinami's 2–4 s).

**Risk:** Mysten hosted publishes a global rate limit. **[VERIFY exact limit — Mysten's docs say "fair-use"; community reports cite ~10 req/s per IP and per-audience quotas. Get the number from Mysten support before relying on it for production.]** If we exceed it we get 429s and signing breaks for everyone. Mitigation: stand up Step 2 before we cross meaningful DAU.

### Step 2 — Self-host the Mysten CPU prover on AWS

**Effort:** ~2 engineering days. **Recurring cost:** ~$510/month (1× c7i.4xlarge 24/7 + ALB + data egress).

Removes Mysten's rate limit and gives us the cushion to canary the GPU image in Step 3.

Steps:
1. Pull the published prover image. The canonical image is `mysten/zklogin-prover:stable` **[VERIFY exact tag — Mysten publishes both `:stable` and pinned git-sha tags at <https://hub.docker.com/r/mysten/zklogin-prover>. Pin to a digest, not a moving tag, in production.]**
2. Download the proving key (`.zkey`) Mysten publishes. As of early 2026 it lives at `https://docs.sui.io/guides/developer/cryptography/zklogin-integration#proving-key` **[VERIFY URL + SHA-256 against Mysten's published checksum — the key file is ~2 GB and gets rotated when the circuit changes.]** Bake it into the image OR mount via EFS.
3. Provision infra:
   - 1× **c7i.4xlarge** EC2 (16 vCPU, 32 GB RAM — Mysten's recommended minimum). Use ECS Fargate if we want it managed; raw EC2 + Docker if we want predictable cost.
   - ALB in front for TLS termination + health checks.
   - Pin to **us-east-1** to colocate with our Sui RPC (assuming default Sui Foundation RPC). **[VERIFY which region our Sui RPC actually resolves to — Onara may route through a different region.]**
   - Health endpoint: `GET /ping` (Mysten image exposes this).
4. Point DNS: `prover.talise.io` → ALB.
5. On Vercel: set `ZK_PROVER_URL=https://prover.talise.io/v1` and (Section 4) `ZK_PROVER_FALLBACK_URL=https://prover.mystenlabs.com/v1`.
6. Re-run `web/scripts/zk-speed-test.mjs`. Expect prover RT p50 ≈ 800–1,500 ms — same as Mysten hosted, just on our box (the CPU work is the same Groth16 prover).
7. Add CloudWatch alarms (Section 7).

**Risk:** Mysten ships a new zkLogin circuit. We need a runbook to pull the new `.zkey` + bump the image tag. Track Mysten's `@mysten/sui` zklogin module changelogs for circuit-version bumps.

### Step 3 — Swap CPU image for unconfirmedlabs GPU prover

**Effort:** ~2–3 engineering days (most spent on CUDA drivers). **Recurring cost:** ~$580–720/month (1× g6.xlarge L4 GPU + ALB + egress).

Real cold-path latency win. Back-of-envelope target: ~100–300 ms prover RT (vs ~1 s on CPU). Confirm with the speed-test harness.

Steps:
1. Pick the instance:
   - **AWS g6.xlarge** (Nvidia L4, 24 GB VRAM) — ~$0.80/hr on-demand, $580/month.
   - **AWS g5.xlarge** (Nvidia A10G, 24 GB VRAM) — ~$1.00/hr on-demand, $720/month. Slightly faster, older silicon.
   - Recommend g6.xlarge for the L4's better cost/perf at zkLogin's circuit size. **[VERIFY against unconfirmedlabs' README benchmarks at <https://github.com/unconfirmedlabs/sui-zklogin-gpu-prover>.]**
2. Pull / build the GPU image:
   - Repo: <https://github.com/unconfirmedlabs/sui-zklogin-gpu-prover>
   - **[VERIFY they publish a Dockerfile and a pre-built image. If not, build it ourselves from their repo. Pin to a git SHA, never `main`.]**
3. CUDA / driver checklist (this is THE failure mode of GPU deploys):
   - AMI: **AWS Deep Learning AMI GPU PyTorch 2.x (Ubuntu 22.04)** — comes with `nvidia-driver-535` + CUDA 12.1 pre-installed. **[VERIFY unconfirmedlabs targets CUDA 12.x — if they pin to 11.x, downgrade.]**
   - NVIDIA Container Toolkit: install `nvidia-container-toolkit` ≥ 1.14, restart Docker, confirm `docker run --rm --gpus all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi` works.
   - Docker runtime: edit `/etc/docker/daemon.json` to set `"default-runtime": "nvidia"`.
   - Run the prover container with `--gpus all`.
   - Burn-in smoke test: hit `/ping` and one real proof from the speed-test harness before flipping DNS.
4. Validate proving-key + circuit compatibility:
   - The unconfirmedlabs prover MUST be built against the SAME `.zkey` Mysten currently ships. If Mysten ships a `circuit-v2`, the GPU repo must rebuild against it.
   - **[VERIFY: check unconfirmedlabs' latest commit date vs Mysten's latest circuit release. If unconfirmedlabs' last commit is older than the latest Mysten circuit version, FLAG and either (a) wait for upstream to catch up, (b) submit a PR, or (c) defer Step 3.]**
   - Concretely: compare the `.zkey` SHA-256 in unconfirmedlabs' repo with the one in `https://docs.sui.io/guides/developer/cryptography/zklogin-integration`.
5. Cutover via canary (Section 5): start at 5%, watch error rate for 24 h, ramp to 100% over 3 days.
6. Run `web/scripts/zk-speed-test.mjs` against the GPU endpoint. Expect prover RT p50 ≈ 100–300 ms.

**Risk:** GPU instance crashes harder than CPU. Auto-cutover to `ZK_PROVER_FALLBACK_URL` (Section 4) is what saves us.

---

## 3. Code changes per step

### Step 1 — Code changes: **none required** for the env switch.

**Optional cleanup follow-up** (recommended, 10-minute edit): `web/lib/zksigner.ts:150` short-circuits to Shinami whenever `SHINAMI_API_KEY` is present. To make the env-var swap idempotent (i.e. setting `ZK_PROVER_URL` alone is enough), invert the priority so `ZK_PROVER_URL` wins over Shinami:

```ts
// web/lib/zksigner.ts around line 150
const useShinami = shinamiEnabled() && !process.env.ZK_PROVER_URL;
const raw = useShinami
  ? await shinamiCreateProof({ ... })
  : await callProver({ ... });
```

That single edit lets Ops flip back to Shinami in a rollback by clearing `ZK_PROVER_URL` — without touching `SHINAMI_API_KEY`.

### Step 2 — Code changes: **none required**.

Pure infra + env. `callProver()` already accepts arbitrary URLs.

**One follow-up to add the fallback chain** (also useful for Step 3). `callProver()` in `web/lib/zksigner.ts:95-106` only hits one URL. To add automatic retry against `ZK_PROVER_FALLBACK_URL` on 5xx / timeout:

```ts
const PROVER_URLS = (() => {
  const primary = process.env.ZK_PROVER_URL?.trim() || /* default mainnet */;
  const fallback = process.env.ZK_PROVER_FALLBACK_URL?.trim();
  return fallback ? [primary, fallback] : [primary];
})();

export async function callProver(inputs: ProverInputs): Promise<ProverResponse> {
  let lastErr: unknown;
  for (const url of PROVER_URLS) {
    try {
      const r = await fetch(url, { /* …signal: AbortSignal.timeout(5000) */ });
      if (r.ok) return (await r.json()) as ProverResponse;
      lastErr = new Error(`prover ${r.status} at ${url}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("all provers failed");
}
```

Files touched: `web/lib/zksigner.ts` only.

### Step 3 — Code changes: **possibly one envelope normalization**.

The Mysten prover returns:

```json
{ "proofPoints": { "a": [...], "b": [...], "c": [...] },
  "issBase64Details": { "value": "...", "indexMod4": 1 },
  "headerBase64": "..." }
```

The unconfirmedlabs GPU prover MAY return the same envelope (good) OR a snake_case variant like `proof_points` / `iss_base64_details` (bad). **[VERIFY by reading the repo's response schema.]**

If different, add a one-shot normalizer to `callProver()` in `web/lib/zksigner.ts:95-106`:

```ts
function normalize(raw: any): ProverResponse {
  return {
    proofPoints: raw.proofPoints ?? raw.proof_points,
    issBase64Details: raw.issBase64Details ?? raw.iss_base64_details,
    headerBase64: raw.headerBase64 ?? raw.header_base64,
  };
}
```

Single-file change. No client-side change needed (the cached proof shape in `web/lib/zkclient.ts:35-40` is unaffected — we normalize server-side before returning).

---

## 4. Env var matrix

Set on **Vercel** (web). Onara is our sponsor gas service — it does NOT directly call the prover (the flow is: Vercel API → prover → Vercel API → Onara for sponsor sig). So all prover env vars live on Vercel only.

| Env var                   | Step 1                             | Step 2                                  | Step 3                                  |
| ------------------------- | ---------------------------------- | --------------------------------------- | --------------------------------------- |
| `ZK_PROVER_URL`           | `https://prover.mystenlabs.com/v1` | `https://prover.talise.io/v1`           | `https://prover.talise.io/v1` (GPU)     |
| `ZK_PROVER_FALLBACK_URL`  | *(unset)*                          | `https://prover.mystenlabs.com/v1`      | `https://prover.mystenlabs.com/v1`      |
| `ZK_PROVER_CANARY_PCT`    | *(unset)*                          | *(unset)*                               | `5` → `25` → `100` over 3 days          |
| `SHINAMI_API_KEY`         | **unset** (or rely on the priority-flip code edit in Section 3) | unset                                   | unset                                   |
| `NEXT_PUBLIC_SUI_NETWORK` | `mainnet` (unchanged)              | `mainnet`                               | `mainnet`                               |

**Fallback strategy:** if the primary prover returns 5xx or times out (recommend 5 s timeout via `AbortSignal.timeout(5000)`), `callProver()` retries against `ZK_PROVER_FALLBACK_URL`. The fallback is Mysten hosted for Steps 2 and 3 — we keep it pinned for the first 14 days post-each-step, then re-evaluate. Implementation snippet in Section 3 above.

`ZK_PROVER_CANARY_PCT` is new — see Section 5 for the canary mechanism (small code addition to `callProver` that picks primary vs fallback based on a hash of the requester's address modulo 100).

---

## 5. Validation per step

Identical validation harness for every step. We have it already.

**Mechanical validation:**
```bash
cd web && pnpm node scripts/zk-speed-test.mjs   # local-only legs
ZK_TEST_JWT=<fresh Google JWT> pnpm node scripts/zk-speed-test.mjs   # full prover RT
```

Capture and paste the prover-RT row into a results table in this doc after each step. Target:

| Step | Expected prover RT p50 | Notes                              |
| ---- | ---------------------- | ---------------------------------- |
| 0 (Shinami today) | 2–4 s              | Per zksigner.ts:112 / zkclient.ts:32 comments |
| 1 (Mysten hosted) | 800–1500 ms        | Audience whitelist required        |
| 2 (Self-host CPU) | 800–1500 ms        | Same proving binary, no rate limit |
| 3 (GPU)           | 100–300 ms         | Real cold-path win                 |

**Sentinel test (manual, per step):**
1. Sign out, clear `localStorage` (kills the cached proof), close the tab.
2. Open the app, sign in with Google.
3. Click Send, fill in recipient + amount, hit Send.
4. Measure wall-clock from OAuth callback redirect → tx receipt visible. Target after Step 3: < 2 s end-to-end (was ~5–7 s).

**Production canary plan (Step 3 only):**
- Implement `ZK_PROVER_CANARY_PCT`. In `callProver()`, hash the user's sender address with FNV-1a, take mod 100; if the bucket is < `ZK_PROVER_CANARY_PCT`, route to GPU; else route to the CPU baseline. Hash-based so any individual user gets a stable experience.
- Day 0: `ZK_PROVER_CANARY_PCT=5`. Watch Vercel logs for prover errors + latency p90. Compare against the 95% control group.
- Day 1: if error rate < 0.5% and p50 confirms expected speedup, bump to `25`.
- Day 3: bump to `100`. Keep CPU live for 14 more days as the fallback target.

---

## 6. Rollback plan

Every step is a single env var flip away from the previous state.

| Step | Rollback action                                                       | Time to safe |
| ---- | --------------------------------------------------------------------- | ------------ |
| 1    | Re-set `SHINAMI_API_KEY` on Vercel, unset `ZK_PROVER_URL`, redeploy.  | ~3 minutes (Vercel redeploy)  |
| 2    | Set `ZK_PROVER_URL=https://prover.mystenlabs.com/v1` (Step 1 state). Leave the AWS box up for forensics. | ~3 minutes  |
| 3    | Set `ZK_PROVER_CANARY_PCT=0`, OR point `ZK_PROVER_URL` back at the CPU box. | ~3 minutes  |

The fallback URL stays default for the first 14 days post-each-step — so even if the primary fails and we haven't pushed an env change, traffic auto-survives.

---

## 7. Monitoring + alerts

Add before Step 2 (single-host blast radius means we need eyes on it). Add definitely before Step 3.

**Metrics to collect:**
- **Prover RT histogram** — instrument `callProver()` with a `console.log("[zkprover]", url, ms, status)` line that Vercel's log drain ships to DataDog (or our existing log destination). p50 / p90 / p99 broken down by URL.
- **Error-rate counter** — `console.log("[zkprover-err]", url, status, msg)`. Alert when 5-minute rolling error rate > 2% (auto-page) or > 0.5% (warning).
- **Auto-cutover trigger** — if primary error rate > 5% over a 60-s window, the fallback retry in `callProver()` already kicks in per-request. No explicit trip switch needed beyond that.

**Infra metrics (Steps 2 + 3):**
- CloudWatch: CPU% (CPU prover) or GPUUtilization (GPU prover), memory, ALB 5xx count, target health.
- AWS billing alarm at $750/month (catches the case where we accidentally provision a g5.12xlarge instead of a g6.xlarge).

**Daily cost check:**
- AWS Cost Explorer daily budget: $25/day for Step 2, $30/day for Step 3. Slack alert on overrun.

---

## 8. Open questions (verify before pulling the trigger)

1. **Does Mysten publish proving-key version compatibility for the hosted prover?** When Mysten rotates the circuit, does the hosted endpoint accept BOTH old + new clients during a transition window, or is it a hard cutover? Implications for Step 2 (we control our binary upgrade cadence). **[ASK Mysten team via Discord.]**
2. **Does unconfirmedlabs' GPU prover support `circuit-v2` if/when Mysten ships it?** The repo's last commit date + open PR list tells us if upstream is actively maintained. If their last commit > 6 months old, treat Step 3 as a fork-and-maintain commitment, not an integration.
3. **Licensing of the GPU prover.** **[VERIFY: check unconfirmedlabs/sui-zklogin-gpu-prover's LICENSE file — MIT/Apache is a green light, GPL/AGPL would require legal review since we're modifying + hosting it.]**
4. **Cost per proof at our scale.** At ~1 proof/user/55-min-session, 10k DAU = ~100k proofs/day. Cost per proof on Step 3 GPU = $30/day ÷ 100k = $0.0003/proof — basically free. At 100k DAU we'd want a second GPU box (load + fault tolerance), bringing it to $60/day ÷ 1M = same per-proof. Sanity-check this against unconfirmedlabs' published throughput numbers.
5. **Has Mysten's audience whitelist moved?** The whole reason we're on Shinami today is that our Google client id wasn't whitelisted in 2024. Re-test before Step 1 — it may just work now, in which case Step 1 is a 30-minute change.

---

## 9. Decision tree

When to stop. Step 3 is overkill for most stages of the business — don't deploy GPUs we don't need.

- **Proofs/day < 5k (≈ < 5k DAU):** stop at **Step 1**. Mysten hosted is free, ~1 s, no infra. The DAU math: each user mints ~1 proof per 55-min session (the cache covers everything after); at 5k DAU with ~1 session/day that's 5k proofs/day, well under any hosted-prover quota.
- **Proofs/day 5k–50k (≈ 5k–50k DAU):** move to **Step 2** (self-hosted CPU). Removes the rate limit, gives us latency control, and is the prerequisite for Step 3 anyway.
- **Proofs/day > 50k OR cold-path UX is critical** (e.g. payments at point-of-sale where 2 s feels broken): move to **Step 3** (GPU). The cost crossover with Step 2 is essentially zero at this scale — GPU is ~$70/month more for an order-of-magnitude latency improvement.
- **Important caveat:** the 55-min `writeCachedProof` cache in `web/lib/zkclient.ts:99-106` means a user makes < 50 proofs/month even with heavy use. So proofs/day ≈ DAU. Talise's Step 3 threshold maps to ~50k DAU.

The UX pre-warm work (out of scope here, but worth flagging) actually REDUCES the proofs-per-DAU number — pre-warming at OAuth callback means 1 proof per session, period. Build pre-warm before scaling, not after.
