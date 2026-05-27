# Talise

Consumer cross-border payments for African diaspora corridors, settled on Sui in seconds for a fraction of legacy remittance cost.

## What it does

<!-- screenshots: drop hero gif at docs/media/hero.gif and app collage at web/public/talise-app-collage.png -->

- Sign in with Google. No seed phrase, no wallet install — zkLogin derives the Sui address.
- Send money to `name@talise`. The recipient sees Naira, Cedi, Shillings, or Rand the entire way.
- Any inbound coin (SUI, USDC, USDT) auto-converts to USDsui on receive and lands in the user's wallet.
- Operator-sponsored gas. The user pays zero in SUI to transact.
- Save / swap / borrow against USDsui via NAVI and Cetus, exposed as one verb in the app.

## The stack

```
Talise/
├── move/        Sui Move package — vault, payment-record receipt, auto-swap caps
├── web/         Next.js 15 App Router — auth, claim, send, receive, earn
├── ios/         SwiftUI client — zkLogin, App Attest, native receipts (parallel track)
├── onara/       Cloudflare Workers gas station + SDK — signs as sponsor, never as user
├── infra/       Prover deployment material (CPU compose, GPU Dockerfile, runbooks)
│   └── prover/
│       ├── cpu/   Self-hosted CPU zkLogin prover compose (alt to Shinami)
│       └── gpu/   GPU prover Dockerfile, deploy script, smoke test, runbooks
├── docs/        Product, architecture, security, ops docs + generated codebase map
├── archive/     Preserved-for-context legacy code. Nothing here should be deployed.
└── research/    Brief, competitive notes
```

### Where to find things

| If you want... | Look in... |
| --- | --- |
| Product story | `docs/product/LITEPAPER.md`, `docs/product/BUSINESS-MODEL.md` |
| How a feature works | `docs/generated/codebase/INDEX.md` |
| Security policies | `docs/security/`, `move/talise/SECURITY-V7.md`, `SECURITY.md`, `THREAT_MODEL.md` |
| Web app | `web/` |
| iOS app | `ios/` |
| Move contracts | `move/talise/` |
| Sponsor service | `onara/` |
| Prover ops | `infra/prover/` |
| Historical context | `archive/`, `docs/archive/` |

Start with `docs/generated/codebase/INDEX.md` for the 26-document code map. It is the current source of truth for how the code actually behaves; the older root-level architecture docs are kept for context but may drift from code.

## Run it locally

### Move
```bash
cd move/talise
sui move build
sui move test
```

### Web
```bash
cd web
pnpm install
cp .env.example .env.local        # fill DATABASE_URL, GOOGLE_CLIENT_ID, SHINAMI_API_KEY, SESSION_SECRET, SUI_FULLNODE_URL
pnpm dev                          # http://localhost:3000
pnpm build && pnpm start          # production mode
```

Required env: `DATABASE_URL`, `SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SHINAMI_API_KEY`, `ONARA_URL`, `SUI_FULLNODE_URL`, `TALISE_AUTOSWAP_PACKAGE_ID`, `TALISE_AUTOSWAP_PACKAGE_LATEST`, `TALISE_AUTOSWAP_REGISTRY_ID`. See `web/.env.example`.

### iOS
```bash
cd ios
brew install xcodegen
xcodegen generate
open Talise.xcodeproj           # build with Xcode 16+
```

### Onara (gas sponsor)
```bash
cd onara/api
bun install
cp .dev.vars.example .dev.vars  # set SUI_MNEMONIC for the sponsor wallet; fund the derived address
bun run dev                      # http://localhost:8787
```

## Production deploys

| Layer | Endpoint |
|-------|----------|
| Web | Vercel — `talise.app` |
| Onara gas station | Cloudflare Worker — `https://api.onara.app` |
| Sui RPC | Mainnet fullnode via Shinami |
| zkLogin prover | Shinami managed (self-host fallback in `prover/`) |

Mainnet Move package ids (autoswap v1 → v4, registry, vault types) are tabulated in [`move/talise/AUTOSWAP.md`](move/talise/AUTOSWAP.md#version-history--migration). That document is the source of truth for `TALISE_AUTOSWAP_PACKAGE_ID` (type-tag root) vs `TALISE_AUTOSWAP_PACKAGE_LATEST` (entry-call target).

## Hackathon alignment

Sui Overflow 2026 — DeFi & Payments track. Track-by-track judging breakdown, scoring rationale, and demo script are in [`HACKATHON.md`](HACKATHON.md) (companion doc).

## Architecture

```
              ┌──────────────────────────────────────────┐
              │                Mobile / Web              │
              │      zkLogin sign-in · ephemeral key     │
              └───────────────┬──────────────────────────┘
                              │ user-signed PTB (zkLogin sig)
                              │
         ┌────────────────────┴────────────────────┐
         │           Onara gas station             │
         │  (Cloudflare Worker, sponsor keypair)   │
         │  policy gate → adds gas signature       │
         └────────────────────┬────────────────────┘
                              │ fully-signed tx
                              ▼
              ┌──────────────────────────────────────────┐
              │                  Sui mainnet             │
              │                                          │
              │   TaliseVault (shared, per-user)         │
              │      ├─ receive_and_deposit<T>           │
              │      ├─ auto_swap_extract<Source> ──┐    │
              │      └─ auto_swap_deposit_to_owner  │    │
              │                                     ▼    │
              │            Cetus aggregator → USDsui     │
              │                       │                  │
              │      PaymentRecord ◄──┴── send_with_     │
              │      (durable receipt)    receipt PTB    │
              └──────────────────────────────────────────┘
```

Full system map: [`docs/generated/codebase/INDEX.md`](docs/generated/codebase/INDEX.md) (current). Auto-swap deep-dive: [`move/talise/AUTOSWAP.md`](move/talise/AUTOSWAP.md). Web internals: [`WEB_ARCHITECTURE.md`](WEB_ARCHITECTURE.md). Threat model and audit findings: [`THREAT_MODEL.md`](THREAT_MODEL.md), [`SECURITY.md`](SECURITY.md). Historical architecture notes: [`docs/archive/ARCHITECTURE.md`](docs/archive/ARCHITECTURE.md).

## License

MIT — see [LICENSE](LICENSE).
