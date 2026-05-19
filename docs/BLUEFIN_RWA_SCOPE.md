# Bluefin RWA Integration Scope

**Status:** Research only — no code written.
**Date:** 2026-05-18

## What Bluefin offers today

Bluefin Pro on Sui mainnet exposes **4 perpetual markets only**: BTC-PERP, ETH-PERP, SOL-PERP, SUI-PERP. Fees are 0.01% maker / 0.035% taker, max leverage 20x, mins are 0.001 BTC / 0.01 ETH / 0.1 SOL / 1 SUI ([Bluefin Contract Specs](https://learn.bluefin.io/bluefin/bluefin-perps-exchange/trading/contract-specs)). **There is no XAU, XAUM, XAGM, silver, or PAXG market live on Bluefin itself.** Bluefin Spot is a separate surface for crypto-to-crypto and does not list precious-metal SKUs either ([Bluefin.io](https://bluefin.io/)).

What does exist is the **Bluefin Liquidity Network (BLN) + Whitelabel** — an infra layer where partner protocols can spin up their own perp markets on Bluefin's matching engine. The announced launch partner is **Vera** (built by Bluewater, same team as Bluefin), which intends to launch RWA perpetual markets; t2000ai is the second BLN partner ([Bitget News on BLN](https://www.bitget.com/news/detail/12560605249664)). As of today (May 2026) no Vera RWA perp market is live on mainnet that we can verify. SDKs that exist: [`@firefly-exchange/library-sui`](https://www.npmjs.com/package/@firefly-exchange/library-sui), [`@bluefin-exchange/pro-sdk`](https://www.npmjs.com/package/@bluefin-exchange/pro-sdk), and [`@bluefin-exchange/bluefin7k-aggregator-sdk`](https://www.npmjs.com/package/@bluefin-exchange/bluefin7k-aggregator-sdk) — the last one is a Sui DEX aggregator (essentially a 7K fork), not Bluefin Pro itself.

**Conclusion: Bluefin does not have a buy-gold-or-silver product we can plug into today.**

## Sui-native gold/silver options

- **XAUM (Matrixdock Gold)** — live on Sui mainnet since Aug 2025. Coin type: `0x9d297676e7a4b771ab023291377b2adfaa4938fb9080b8d12430e4b108b836a9::xaum::XAUM` ([rwa.xyz](https://app.rwa.xyz/assets/XAUm)). Backed 1:1 by 99.99% LBMA gold, audited by Bureau Veritas, physical redemption via Brinks/Malca-Amit in SG/HK ([blog.sui.io](https://blog.sui.io/matrixdock-tokenized-gold/)). Active Momentum pool with ~$71M TVL ([DEX Screener](https://dexscreener.com/sui/0xc5bdc685b8006071938b5cb94103dc873c9946578d717c9b5b67fc264ff941e0)). Supported by Momentum, Cetus, Navi, AlphaLend, Nodo, Creek Finance.
- **XAGm (Matrixdock Silver)** — announced May 12, 2026 as expanding to Sui, LBMA-accredited 1:1 silver ([PR Newswire](https://www.prnewswire.com/apac/news-releases/matrixdock-expands-tokenized-silver-xagm-to-sui-enabling-institutional-grade-access-for-on-chain-finance-302769810.html)). Coin type not yet published; need to confirm liquidity on Momentum/Cetus.
- **PAXG-on-Sui** — not natively deployed. Bridged variants would route through Wormhole; not recommended for hackathon scope.

## Two integration paths

**(a) Direct Bluefin SDK.** Use `@bluefin-exchange/pro-sdk` + `@firefly-exchange/library-sui` to open a perp position on Bluefin. Problem: there is no gold/silver perp on Bluefin today — only BTC/ETH/SOL/SUI. We'd be selling "crypto perps" not "gold." Even if Vera launches an XAU-PERP on BLN before the deadline, it's a perp (funding rates, liquidations, leverage) not a savings/Earn product. Wrong primitive for an Earn tile.

**(b) Cetus/Momentum aggregator route (recommended).** Same pattern as Talise's existing USDsui-savings card. User taps "Buy Gold" → we build a PTB that swaps USDC (or USDsui) into XAUM via the Bluefin7k aggregator SDK (or 7K directly), sponsor it with Onara, sign with zkLogin. User ends up holding XAUM in their zkLogin-controlled address — actual, redeemable, vaulted gold exposure. Silver tile uses the same flow once XAGm liquidity is on-chain. Zero Bluefin perp dependency.

## Recommendation

**Ship path (b) for the hackathon.** Add two tiles to `/earn` mirroring the USDsui-savings card pattern:

- **"Buy Gold" tile** — headline price (XAUM/USDC from oracle or pool mid), 7d/30d performance, "Buy" CTA. Tap → amount sheet → confirm → PTB(USDC → XAUM via 7K/Bluefin7k) → sponsored → user balance updates.
- **"Buy Silver" tile** — identical pattern, gated behind a "Coming soon" state until we confirm XAGm pool liquidity on Momentum.
- Optional v2: stack on top of AlphaLend / Navi to show "Earn 5-15% APY on your gold" — but that's a fast-follow, not hackathon scope.

This ships in 1-2 days because we already have the zkLogin signer + Onara sponsorship + Cetus-style swap flow. No Bluefin partnership needed, no perp risk surface, no leverage UX to explain.

## What I'd need from you

1. **Confirm XAGm coin type on Sui** — Matrixdock hasn't published it yet; we may need to DM @matrixdock or wait a week. Until then, silver tile ships as "Coming soon."
2. **Decide aggregator: 7K vs Bluefin7k vs Cetus direct.** 7K has the cleanest TS SDK ([`@7kprotocol/sdk-ts`](https://www.npmjs.com/package/@7kprotocol/sdk-ts)); Bluefin7k is a fork and gives us a Bluefin co-marketing angle. No API key needed for either.
3. **Onara sponsor budget bump** — XAUM swaps will eat slightly more gas than vanilla USDC transfers (multi-hop routes). Confirm headroom.
4. **No KYC needed for the swap itself.** Matrixdock KYC only kicks in for **physical redemption** (claiming actual gold bars), which is out of scope — users can always redeem off-app via matrixdock.com if they want bars. Worth a footnote in the UI.
5. **Legal sanity check** — offering "Buy Gold" in-app may be construed as a regulated commodities offering in some jurisdictions. Recommend a geo-block / disclaimer pass before mainnet launch, even though the on-chain swap itself is non-custodial.

## Sources

- [Bluefin Contract Specs](https://learn.bluefin.io/bluefin/bluefin-perps-exchange/trading/contract-specs)
- [Bluefin homepage](https://bluefin.io/)
- [BLN + Vera + t2000ai announcement (Bitget)](https://www.bitget.com/news/detail/12560605249664)
- [Matrixdock XAUm launches on Sui](https://blog.sui.io/matrixdock-tokenized-gold/)
- [Matrixdock XAGm expands to Sui (PR Newswire, May 12 2026)](https://www.prnewswire.com/apac/news-releases/matrixdock-expands-tokenized-silver-xagm-to-sui-enabling-institutional-grade-access-for-on-chain-finance-302769810.html)
- [rwa.xyz XAUm asset page](https://app.rwa.xyz/assets/XAUm)
- [XAUM/USDC Momentum pool, DEX Screener](https://dexscreener.com/sui/0xc5bdc685b8006071938b5cb94103dc873c9946578d717c9b5b67fc264ff941e0)
- [`@bluefin-exchange/pro-sdk`](https://www.npmjs.com/package/@bluefin-exchange/pro-sdk)
- [`@bluefin-exchange/bluefin7k-aggregator-sdk`](https://www.npmjs.com/package/@bluefin-exchange/bluefin7k-aggregator-sdk)
- [`@firefly-exchange/library-sui`](https://www.npmjs.com/package/@firefly-exchange/library-sui)
- [`@7kprotocol/sdk-ts`](https://www.npmjs.com/package/@7kprotocol/sdk-ts)
