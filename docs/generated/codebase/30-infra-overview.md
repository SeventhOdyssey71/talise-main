# 30. Infrastructure Overview

Audience: infra/devops engineers operating Talise. This doc is the map. The
companion docs cover deployment (`31-`), the GPU prover (`32-`), env vars
(`33-`), and observability (`34-`).

## Hosting topology

Talise runs on a thin, opinionated stack. Four planes, each with one
canonical provider plus one explicit fallback where it matters.

| Plane             | Provider                                  | Notes |
| ----------------- | ----------------------------------------- | ----- |
| Web + API         | Vercel (project `talise-main`)            | Single Next.js app under `web/`. Serves `talise.io` (browser) and `app.talise.io` (mobile API). |
| On-chain          | Sui mainnet                                | All custody, vaults, AutoSwapCap, SuiNS subnames, payment receipts. |
| Sponsor service   | Onara (Cloudflare Workers)                 | Composes sponsored PTBs. Called by Vercel API only (never the browser). Repo: `onara/`. URL in `ONARA_URL`. |
| zkLogin prover    | Shinami (current production primary)       | `api.us1.shinami.com/sui/zkprover/v1`. Audience-open. 2/min rate limit per key. |
| zkLogin prover    | Unconfirmedlabs GPU prover (planned)       | Self-hosted on RunPod (default) / Lambda Labs / AWS. Behind Caddy + Let's Encrypt. Cuts warm latency from 2-4s to ~400ms. |
| Postgres          | Managed Postgres via the `postgres` driver in `web/lib/db.ts`. | `DATABASE_URL` is a `postgres://USER:PASS@HOST:PORT/DB` URL. `DATABASE_AUTH_TOKEN` is ignored under the Postgres adapter and kept only so the legacy libSQL path can be flipped on for local dev if needed. Previously libSQL/Turso; the `@libsql/client` dep in `web/package.json` is a leftover from that era. |
| Email             | Resend                                     | `RESEND_API_KEY`. Sends waitlist confirmation, receipt notifications, invoice-paid emails. |
| Card on-ramp      | Stripe Crypto Onramp                       | USDC on Sui mainnet, swept to USDsui by the auto-swap cron. |
| Agentic chat LLM  | 0G Compute (DeepSeek V4 proxy)             | OpenAI-compatible. Optional: chat offlines cleanly if `ZG_DEEPSEEK_V4_API_KEY` is unset. |
| Persistent memory | Memwal (Walrus + Sui)                      | Optional. Per-session chat memory. |

There is no Kubernetes, no Terraform repo, no separate "backend" service.
Every non-trivial cron, prover, and indexer runs as a Vercel function or
as a single auxiliary container (Onara on Cloudflare, GPU prover on a
GPU box).

## DNS topology

All apex DNS is on the `talise.io` zone (provider not pinned in repo;
recent docs assume Cloudflare). Caddy on the GPU box does its own ACME,
so Cloudflare proxy/CDN must be OFF (grey cloud) for `zk-prover.talise.io`.

| Hostname                  | Points at                              | Purpose |
| ------------------------- | -------------------------------------- | ------- |
| `talise.io`               | Vercel (CNAME / ALIAS)                  | Marketing site + dApp. |
| `app.talise.io`           | Vercel (same project)                   | Mobile-facing API host. Used by iOS so the redirect URI splits cleanly from web. |
| `zk-prover.talise.io`     | GPU prover box public IP (A record, proxy off) | Direct TCP to Caddy on the GPU box. Caddy reverse-proxies to `127.0.0.1:8080`. |
| `prover.talise.io`        | (planned) self-host CPU prover ALB      | Reserved for the Step 2 CPU prover; not in production. |

OAuth redirect URIs registered with Google:

- `https://talise.io/auth/callback`
- `https://app.talise.io/auth/callback`
- `http://localhost:3000/auth/callback` (dev)

The split is handled at the request layer by `redirectUriFromRequest()`
in `web/lib/auth.ts:35`: the server derives the redirect URI from the
incoming Host header, so the mobile callback never leaks to the web
client id and vice versa.

## Region strategy

Vercel project default region is multi-region (per Vercel CDN). The API
routes that matter (cron, sign, sponsor-execute) are Node functions and
should be colocated with the GPU prover. The runbook
(`infra/prover/gpu/RUNBOOK.md`) recommends pinning
`vercel.json#regions` to `["iad1"]` when the GPU box is on AWS
`us-east-1`. The current `web/vercel.json` does NOT pin a region, so
Vercel routes to whichever edge serves the user; this is fine while
Shinami is the primary prover (hosted, multi-region) and will need to
be revisited at GPU cutover.

GPU box region:

- RunPod (default): `Secure Cloud`, US-region pod when available.
- AWS path: `us-east-1` (lowest latency to Vercel `iad1`).
- Lambda Labs path: `us-east-1`.

Sui RPC: `fullnode.mainnet.sui.io` (Sui Foundation; multi-region anycast
via Cloudflare). Hardcoded in the cron handler at
`web/app/api/cron/auto-swap-sweep/route.ts:707`.

## Diagram

```
                       Browser  (talise.io)
                            │ HTTPS
                            ▼
               ┌──────────────────────────────┐
   iOS app ──▶ │   Vercel (talise-main)        │
 (app.talise.io)│  Next.js, API routes, cron   │
               └─────────┬────────┬───────────┘
                         │        │
              postgres://│        │  HTTPS
                         ▼        ▼
                 Postgres DB  ┌────────────────┐
                             │ Shinami zkProver│  (primary today)
                             │ Onara (sponsor) │
                             │ Resend (email)  │
                             │ Stripe Onramp   │
                             └────────────────┘
                                  │
                                  ▼
                          Sui mainnet RPC
                          fullnode.mainnet.sui.io

                  (Planned, behind feature flag)
                     ZK_PROVER_PRIMARY=gpu
                            │
                            ▼
            zk-prover.talise.io  (Caddy + Let's Encrypt)
                            │
                            ▼
            Docker: unconfirmedlabs/sui-zklogin-gpu-prover
            on RunPod L4 24GB (default target)
```

## What's intentionally NOT in this stack

- No Kubernetes. One Vercel project + one GPU container is the
  blast-radius unit.
- No second Postgres. A single managed Postgres serves the app via
  the `postgres` driver. (Previously libSQL/Turso; that path remains
  reachable via the `@libsql/client` leftover dep for local dev.)
- No managed Redis. The 55-minute proof cache (`web/lib/perf-cache.ts`)
  is in-memory per Vercel function instance; cold instances repay the
  prover round trip.
- No Sentry yet. Error reporting is `console.error` -> Vercel log drain.
  See `34-infra-observability.md` for what we do collect.

## Where to read next

1. `31-infra-deployment.md` for the Vercel deploy flow.
2. `32-infra-gpu-prover.md` for the GPU prover rollout playbook.
3. `33-infra-env-vars.md` for the authoritative env var list.
4. `34-infra-observability.md` for crons, logs, alerting.
