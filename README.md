# Talise

**Send money home. Instantly. Almost free.**

A consumer payments app for African corridors built on Sui — diaspora workers send money to family in seconds at a fraction of what Western Union charges. Recipients see their own currency (₦, KSh, GH₵, R) the whole way through. Sui is invisible underneath.

## How it works

| Layer | What | Tech |
|---|---|---|
| Sign-in | Google → Sui address, no seed phrase, no wallet install | zkLogin via [Shinami](https://shinami.com) |
| Gas | User pays 0. Operator-funded sponsor wallet covers every tx. | [Onara](https://github.com/unconfirmedlabs/onara) gas station |
| Money primitive | One canonical stable: **USDsui**. Any inbound coin auto-converts on receive. | Cetus aggregator (20+ DEXs) via [@t2000/sdk](https://www.npmjs.com/package/@t2000/sdk) |
| Username | `sele@talise` → user's Sui address. Subnames under `talise.sui`. | SuiNS (DB-backed today, on-chain swap ready) |
| Payment Intent | Multi-leg atomic PTBs — single signature, all-or-nothing settlement. | Sui Programmable Transaction Blocks |
| Display | Local currency primary (₦), USD secondary, USDsui invisible. | Hardcoded FX snapshot (live feed TBD) |

## Repo layout

| Folder | Contents |
|---|---|
| `web/` | Next.js 15 app — landing, dashboards, claim, send, receive, auto-convert |
| `onara/` | Vendored gas-station server (Cloudflare Workers + Hono) and SDK |
| `move/` | Sui Move package (receipt, send, atomic send-with-receipt) |
| `ios/` | Earlier SwiftUI port — currently inactive while web ships |
| `prover/` | Self-hosted zkLogin prover compose file (alternative to Shinami) |
| `docs/` | Architecture, pitch, demo, asset universe |
| `research/` | Brief, competitive notes |

## Quick start

```bash
# 1. Web app
cd web
pnpm install
cp .env.example .env.local      # fill in real values
pnpm dev                         # http://localhost:3000

# 2. Gas sponsor (separate terminal)
cd onara/api
cp .dev.vars.example .dev.vars   # fill SUI_MNEMONIC, fund the address with mainnet SUI
bun install
bun run dev                      # http://localhost:8787
```

Sign in with Google. Claim `yourname@talise` at `/claim`. Send money at `/send`.

## What's wired on mainnet

- zkLogin auth + proofs via Shinami
- Sponsored transactions via Onara
- Save/swap/borrow via [@t2000/sdk](https://www.npmjs.com/package/@t2000/sdk) → NAVI lending + Cetus aggregator
- USDsui as the canonical stable, auto-convert on receive
- Username send + claim (DB-backed; SuiNS swap path documented)

## Strategy

See [STRATEGY.md](STRATEGY.md) for the consumer wedge, market sizing, and the seven killer use cases (cross-border remittance, dollar savings, Ajo/Chama on-chain, etc.).

## Key docs

- [STRATEGY.md](STRATEGY.md) — consumer positioning + use cases
- [BRIEF.md](BRIEF.md) — Sui Overflow DeFi & Payments problem statement
- [ARCHITECTURE.md](ARCHITECTURE.md) — Move modules + system map
- [WEB_ARCHITECTURE.md](WEB_ARCHITECTURE.md) — web app structure
- [docs/PITCH.md](docs/PITCH.md) — pitch deck + 90-second pitch
- [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) — demo shot list

## License

MIT. See [LICENSE](LICENSE).
