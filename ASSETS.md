# Talise — the asset universe

Every asset Talise supports must have (a) a way to hold it on Sui, (b) a way to earn yield on it, and (c) a way to route it through a payment. Below: the v1 lineup.

## v1 lineup (ship-by 2026-05-23)

| Asset | How held on Sui | Yield source | Payment routing | Status |
|---|---|---|---|---|
| **USDC** | Native USDC (Circle on Sui) | DeepBook Margin lending pool (~5–8% APR) | Direct transfer or DeepBook spot to other quote | ✅ Live, primary |
| **SUI** | Native | Liquid staking (e.g. afSUI, haSUI) or DeepBook spot LP | DeepBook spot SUI/USDC | ✅ Live |
| **BTC** | Wormhole-wrapped or LBTC | DeepBook spot LP fee yield | DeepBook spot BTC/USDC | ✅ Live |
| **ETH** | Wormhole-wrapped | DeepBook spot LP fee yield | DeepBook spot ETH/USDC | ✅ Live |
| **XAUM (Matrixdock Gold)** | Native Sui (multi-chain RWA) | Hold for spot price exposure (no native yield) | DeepBook spot XAUM/USDC if pool live; else Wormhole bridge route | ⚠ Verify XAUM/USDC DeepBook pool exists; fallback to direct holding |
| **Silver / extra commodities** | Bluefin perpetual long XAG/USD if listed | Funding rate (variable, sometimes negative) | Close perp position → USDC → send | ⚠ Pending Bluefin listing; v1 ship as "coming soon" UI |

## v2 / nice-to-have

- **DEEP** — DeepBook native token, governance + fee discount
- **stSUI / liquid staking derivatives** — already-yielding SUI proxies
- **Tokenized treasuries** — Ondo USDY equivalent on Sui if available
- **Bluefin perps** — leveraged exposure as a "Pro" tier

## The asset card pattern

Every asset in Talise renders as a card with the same five fields:

```
+--------------------------------------+
| Gold (XAUM)                          |
| 0.0421 oz · $87.13 USD               |
| Earning via: spot price exposure     |
| 24h: +1.2%                           |
| [Buy] [Send] [Sell]                  |
+--------------------------------------+
```

Buy = DeepBook spot USDC → asset
Send = atomic withdraw + transfer (cross-asset routes via DeepBook)
Sell = DeepBook spot asset → USDC → supply to Margin lending

## Why gold/silver matter for this hackathon

1. **Q1 2026 narrative.** Tokenized gold did $90.7B in trading volume in one quarter. Silver perps are up 400%+. This is the timeliest possible asset to launch.
2. **Mainstream legibility.** Judges who aren't crypto-native immediately understand "save in gold." That's the demographic Talise targets.
3. **Composability flex.** "Send me $50 in gold" via PTB (USDC → XAUM spot swap → transfer + receipt) is the killer demo shot.
4. **Differentiation.** No Sui wallet currently leads with multi-asset programmable savings including commodities. First-mover.

## Yield-strategy tiers (per-asset)

The user picks one global tier; each asset deploys differently within that tier.

### Conservative
- USDC → DeepBook Margin lending (~6% APR)
- SUI → liquid staking (~3.5% APR)
- BTC/ETH → idle (no yield, just spot exposure)
- XAUM → idle (spot price exposure)

### Balanced
- USDC → 80% Margin lending / 20% DeepBook spot LP USDC/USDT
- SUI → liquid staking
- BTC/ETH → DeepBook spot LP (fee yield + DEEP rewards, MTM exposure)
- XAUM → idle

### Aggressive
- USDC → 50% Margin lending / 30% Spot LP / 20% Predict PLP
- SUI → liquid staking + Predict PLP slice
- BTC/ETH → DeepBook spot LP (full)
- XAUM → idle (no perp leverage in v1 — too risky for hackathon)

The router (`talise::yield_router`) handles transitions atomically when the user changes tiers.

## Open questions before submission

1. ❓ Is XAUM live on Sui mainnet with a DeepBook pool? → check on 2026-05-18
2. ❓ Are Bluefin XAG perps live? → check on 2026-05-18
3. ❓ DeepBook Margin lending — does the testnet deployment include all needed quote markets? → verify
4. ❓ Wormhole bridge fees on small amounts (relevant for cross-chain XAUT/PAXG path)? → benchmark
