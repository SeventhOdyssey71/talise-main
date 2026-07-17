# Talise infra

Supporting infrastructure for the Talise wallet: gas sponsorship, self-hosted
zkLogin proving, and a reusable zkLogin web example. Each subdirectory is
independent.

## `gas-sponsorship/` — Onara gas station (production)

Talise's production gas station: a policy-based Sui transaction sponsorship
server (`api/`, Hono on Cloudflare Workers) plus a TypeScript client SDK
(`sdk/`, published as `onara` on npm). This is the real sponsor rail that pays
gas for user transactions — the web app calls it through
`web/lib/onara/` (public entry `web/lib/onara/index.ts`, client
`web/lib/onara/client.ts`, imported as `@/lib/onara`), pointed at the
`ONARA_URL` env var. It carries its own `LICENSE` and is the "onara" open
project. Deploy target is Cloudflare Workers (see `api/wrangler.jsonc`);
secrets/rotation are documented in `api/SECRETS-ROTATION.md`.

## `prover/` — self-hosted zkLogin provers

Self-hosted Sui zkLogin proof generators, used because Mysten's public mainnet
prover whitelists OAuth audiences and Talise's is not on it. Two flavours:

- **`prover/cpu/`** — a Docker Compose CPU prover stack. One-time setup pulls
  the mainnet proving key (~3.2 GB) via `download-zkey.sh`, then
  `docker compose up`; the web app points at it via `web/.env.local`. This is
  the documented self-host path.
- **`prover/gpu/`** — a GPU prover deployment (unconfirmedlabs GPU zkLogin
  prover) with a full runbook (`DEPLOY.md`, `RUNBOOK.md`, `BABYSIT.md`,
  `deploy.sh`, `smoke.sh`, `Dockerfile.talise`). Intended to run on a rented
  GPU box (RunPod L4 is the documented default) and be selected with
  `ZK_PROVER_PRIMARY=gpu`; the web code path is wired in
  `web/lib/zksigner.ts::callProverWithFallback`, with Shinami as the automatic
  fallback on any 5xx/timeout.

## `zklogin/` — reusable zkLogin web example (extraction, not production)

A distilled, runnable extraction of the zkLogin rail Talise runs in production —
a copy-paste starter, not the live service. `src/` holds the reusable core
(ephemeral keys, Shinami wallet/proof calls, Google OAuth, AES-GCM session
cookie) and `nextjs-example/` is a Next.js App Router wiring of it. It targets
Shinami's hosted mainnet prover (or Mysten's dev prover on testnet) and defaults
to testnet in its `.env.example`. See its own `README.md` for the full flow.
