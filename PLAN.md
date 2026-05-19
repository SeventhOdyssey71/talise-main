# Talise — 6-day build plan

Today: **2026-05-17 (Sat)** · Submission: **2026-05-23 (Fri)**

## Daily breakdown

### Day 1 — Sat 2026-05-17 (today)
**Goal:** workspace + Move package skeleton + asset verification

- [x] Create `/Users/eromonseleodigie/Talise/` workspace
- [ ] Verify on Sui Mainnet/Testnet:
  - [ ] XAUM Matrixdock Gold coin type + active DeepBook pool
  - [ ] Bluefin XAG perp availability
  - [ ] DeepBook Margin lending pool object IDs (testnet first)
  - [ ] DeepBook spot pool IDs for USDC/SUI, USDC/BTC, USDC/ETH
- [ ] Initialize Move package: `move/talise/Move.toml`
- [ ] Write skeletons: `account.move`, `policy.move`, `receipt.move` (no logic, just types + entries)
- [ ] `sui move build` passes

### Day 2 — Sun 2026-05-18
**Goal:** core yield-router + send working on testnet

- [ ] `yield_router.move` — `deposit_usdc`, `withdraw_usdc`, calls into DeepBook Margin
- [ ] `send.move` — atomic withdraw + transfer + receipt
- [ ] Unit tests for both (10+ tests, all passing)
- [ ] Deploy package to testnet
- [ ] End-to-end PTB via `sui client ptb`: deposit $10, send $5, verify receipt minted
- [ ] **Screenshot the Suiscan tx with 4 Move calls** — this is the hero artifact

### Day 3 — Mon 2026-05-19
**Goal:** cross-asset send (DeepBook spot integration) + savings buckets

- [ ] `auto_convert.move` — withdraw + DeepBook spot swap + transfer + receipt
- [ ] Tests cover: USDC→SUI, USDC→BTC, slippage revert path
- [ ] `savings.move` — bucket creation + inflow routing
- [ ] `recurring.move` — schedule object + tick entry (clock-gated)
- [ ] Redeploy package
- [ ] PTB demo: cross-asset send USDC→SUI, screenshot the order-book trade in Suiscan

### Day 4 — Tue 2026-05-20
**Goal:** iOS port + rebrand

- [ ] Clone Cible app into `ios/Talise/`
- [ ] Strip prediction-market views (Markets, Tournaments, Portfolio)
- [ ] Add Home/Send/Earn/Activity tabs
- [ ] Wire `TaliseAPI` to read asset balances (USDC supply share, SUI balance, XAUM balance, etc.)
- [ ] Asset cards on Home — five cards (USDC, SUI, BTC, ETH, XAUM)
- [ ] zkLogin already works — verify on rebranded app
- [ ] First end-to-end: sign in, see balances, tap Send, submit PTB

### Day 5 — Wed 2026-05-21
**Goal:** agent layer + cross-asset send UI + savings UI

- [ ] `PTBPlanner.swift` — port intent compiler from predict-cli
- [ ] `AgentChatView` — three demo intents: "send $X to Y", "save Z% to bucket", "schedule monthly payment"
- [ ] `AgentPolicyEditor` — caps, allowlist, revoke button
- [ ] Cross-asset SendSheet — asset picker on both sender/receiver, live DeepBook quote
- [ ] Savings buckets UI — create, view, route-inflow toggle
- [ ] Bridge endpoints: `/agent/plan`, `/quote/cross-asset`

### Day 6 — Thu 2026-05-22
**Goal:** polish, demo recording, submission package

- [ ] App icon + splash screen + launch images
- [ ] Accessibility pass (Dynamic Type, VoiceOver labels)
- [ ] Performance pass (cold start under 2s, balance refresh under 1s)
- [ ] Record 90-second demo video (script: `docs/DEMO_SCRIPT.md`)
- [ ] Write `docs/PITCH.md` — 5-min deck outline
- [ ] Take Suiscan screenshots (4 hero shots: deposit, send, cross-asset send, agent-built schedule)
- [ ] Push GitHub repo public
- [ ] README polish — judges land here first

### Submission day — Fri 2026-05-23
**Goal:** submit before 23:59 PT

- [ ] Final smoke test on real testnet
- [ ] Submit to overflow.sui.io
- [ ] Tweet announcement with hero PTB screenshot
- [ ] LinkedIn post

## Daily standup format

Every morning, in `research/standup.md`, write three lines:

```
DATE
- Yesterday: [what shipped]
- Today: [what ships]
- Blockers: [what's stuck]
```

## Risk register (mitigations)

| Risk | Mitigation |
|---|---|
| XAUM not actually on Sui mainnet yet | Day 1 verify; if not, swap to Wormhole-bridged PAXG or just demo with USDC/SUI/BTC and pitch "gold support shipping next" |
| DeepBook Margin testnet liquidity dry | Pre-seed our own positions via the test DUSDC faucet (we already have 1697 DUSDC withdrawn) |
| Bluefin XAG perp not listed yet | Treat silver as "v2 ship-target." Demo gold only. |
| zkLogin Google OAuth flow breaks | Already shipped in Cible; port verbatim. Fallback: ephemeral keypair sign-in for demo. |
| Bridge endpoint downtime during demo | Run bridge locally during demo. Pre-record fallback video. |
| Move package size limit on testnet | Split into smaller modules. We're at ~1500 LOC budget which is comfortably under. |
| Suiscan UI changes between now and demo day | Capture screenshots Day 6, embed in pitch deck. Don't rely on live-link to Suiscan during pitch. |

## Definition of done

A submission is "done" when:
1. The Move package is deployed to Sui testnet with a stable address
2. The iOS app builds in Release mode with zero warnings
3. A 90-second demo video exists at `docs/demo.mp4`
4. A 5-slide pitch deck exists at `docs/pitch.pdf`
5. The GitHub repo is public with a clean README
6. Four hero Suiscan screenshots are committed
7. Overflow.sui.io submission form is filled and submitted

## What we are NOT building (cut list)

- Bluefin perp integration (v2 — too much surface for 6 days)
- Sponsored transactions (Cible bridge has it but not critical for demo)
- Mainnet deploy (testnet is fine for submission)
- Android (iOS only)
- Web app (iOS only)
- Hardware wallet support (zkLogin only)
- Multi-language (English only)
- More than the 5 v1 assets
- Tournament/social features
- Push notifications (already in Cible code but not needed for demo)
