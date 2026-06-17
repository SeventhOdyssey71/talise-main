# Talise

On Talise, a payment is a financial action. Send money and it can round up, earn, and mint an on-chain receipt — composed into a single signed transaction on Sui. One signature, no wallet, no gas token to hold. That programmable core is wrapped in a wallet that feels like a neobank: sign in with Google, hold dollars in USDsui, and pay anyone by `@handle`. Money comes in by card or bank (Transak on-ramp) and out to a real bank account (Linq off-ramp — live for Nigeria today).

> Built for the Sui DeFi & Payments problem statement: payments that are programmable financial actions, with 1,100+ accounts already created on-chain as proof.

**Live in production at [talise.io](https://talise.io).** The web wallet (`/app`) is behind an email allowlist gate — Google sign-in is open to all, but only allowlisted accounts enter; everyone else lands in a waiting room. The business workspace (`/business`) and the public claim/pay pages (`/c` cheque claim, `/i` invoice pay, `/pay`, `/u`) are live. NGN bank cash-out is **capped at $200 per withdrawal during beta** (`OFFRAMP_MAX_USD` in `web/lib/linq.ts`, enforced server-side in every Linq entry point).

## What it does

<!-- screenshots: drop hero gif at docs/media/hero.gif and app collage at web/public/talise-app-collage.png -->

**Core wallet**
- Sign in with Google. No seed phrase, no wallet install — zkLogin derives the Sui address.
- Hold a dollar balance as USDsui (the Sui Dollar, issued by Bridge, a Stripe company).
- Pay anyone by `@handle` (a SuiNS subname). Operator-sponsored gas via Onara — the user never holds SUI.

**Money in / money out**
- **On-ramp (beta).** Transak hosted widget: pay by card or bank → USDC lands on the user's Sui address → an auto-swap step converts it to USDsui. Transak runs KYC inside its widget; Talise collects no identity fields. Bridge is wired as an alternate provider (delivers USDsui directly) but Transak is the live path.
- **Off-ramp (LIVE for Nigeria).** Linq pays USDSUI out to a Nigerian (NGN) bank account. We create an order, Linq returns a deposit address it watches, the user sends exactly that USDSUI, and Linq disburses to the bank — no Talise treasury float, no on-chain verification on our side. Withdrawals are capped at $200 each during beta. Southeast Asia (Philippines first) is the next corridor target — see [`docs/strategy/sea-expansion.md`](docs/strategy/sea-expansion.md); KES / GHS remain on the African roadmap.

**Pay**
- **Scan to pay.** Point the camera at a bank placard (OCR the bank + account) or a QR code, then pay — on-chain to a `@handle` or out to that bank via the off-ramp.
- **Link a bank to your `@handle`.** A user links an NGN account (name resolved + a zkLogin consent signature stored), marks one primary, and senders can then pay them straight to their bank — the sender only ever sees a masked `Bank ••••1234`, never the full number.
- **NGN-denominated cash-out.** Quote and debit are computed off the order's locked rate so the recipient is credited an exact NGN figure.

**Grow**
- **Earn.** Idle USDsui earns yield via NAVI lending, one tap, withdrawable any time.
- **Round-ups, goals, rewards** — savings nudges and a points layer.

**Work**
- **Streaming pay** — salary streams settled fully on-chain. Recipients claim accrued value against the Sui `Clock` (`claim_accrued`); there is no cron or scheduler in the loop.
- **Money-link cheques** — claimable links backed by an on-chain escrow (the `talise_pay` package on mainnet). A worker signs the release; claims are gated by captcha, VPN detection, and geo. Recipients claim with a Google sign-in, no prior account.
- **Invoices + public pay-links** with trustless on-chain settlement, and **team payouts** — up to 50 recipients paid in one atomic PTB.

> Surface status: the iOS app and the web app both exercise the full feature set against the live production backend. Web is live at `talise.io` with the `/app` wallet behind the email allowlist gate.

## The stack

```
Talise/
├── move/        Sui Move package — send+receipt, cheque, stream, vault+auto_swap,
│                compliance, remit_escrow, batch_pay
├── web/         Next.js 15 App Router — auth, send, on-ramp, off-ramp (Linq),
│                bank linking, earn, rewards, invoices/contracts, marketing site
├── ios/         SwiftUI client — zkLogin, App Attest; Scan/Withdraw/Earn/Send/
│                Cheques/Stream/Invoices/Contracts/Profile features
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
| Web | Vercel — `talise.io` |
| Database | Supabase Postgres (us-east-1, pooled — in-region with Vercel), behind a libSQL-shaped adapter |
| Onara gas station | Cloudflare Worker — `https://api.onara.app` |
| Sui RPC | Mainnet reads over a gRPC fullnode fallback chain (2.2s per-endpoint cap); sends are gasless-first with a sponsored fallback |
| zkLogin prover | Shinami managed (self-host fallback in `infra/prover/`) |

Reads are served from display-only snapshots with bounded live reads; a schema-version gate trims cold-start from ~29s to a single `SELECT`. Snapshots are display-only and never sit in the send or limit-enforcement paths.

Mainnet Move package ids (autoswap v1 → v4, registry, vault types) are tabulated in [`move/talise/AUTOSWAP.md`](move/talise/AUTOSWAP.md#version-history--migration). That document is the source of truth for `TALISE_AUTOSWAP_PACKAGE_ID` (type-tag root) vs `TALISE_AUTOSWAP_PACKAGE_LATEST` (entry-call target).

## Hackathon alignment

Sui Overflow 2026 — DeFi & Payments track. Track-by-track judging breakdown, scoring rationale, and demo script are in [`docs/hackathon/HACKATHON.md`](docs/hackathon/HACKATHON.md) (companion doc).

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
