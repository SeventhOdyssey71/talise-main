# Onramp Provider Research — USDsui

**Date:** 2026-05-28
**Scope:** Identify partners that take USD / local fiat and deliver USDsui (`0x44f838...::usdsui::USDSUI`, a Bridge/Stripe-issued Sui-native stablecoin launched Nov 2025) to a Sui address.

**Key context.**

- **USDsui is issued by Bridge** (a Stripe company), via Bridge's *Open Issuance* platform. Source: [blog.sui.io — "Sui Unveils USDsui"](https://blog.sui.io/sui-unveils-usdsui-native-stablecoin/) and [Coindesk Nov 2025](https://www.coindesk.com/business/2025/11/12/sui-launches-native-stablecoin-usdsui-using-bridge-s-open-issuance-platform).
- **As of May 2026, no public onramp lists USDsui as a directly-buyable destination asset** in its widget/API. The realistic short-to-medium-term pattern is: **buy USDC-on-Sui (or SUI) → app auto-converts to USDsui**. This is exactly what `web/app/api/onramp/session/route.ts` already does — Stripe session with `destination_currency=usdc`, `destination_network=sui`, then the home page's `AutoConvertBanner` sweeps inbound USDC into USDsui.
- **Sui launched gasless stablecoin transfers** on mainnet on 2026-05-20 covering USDC, USDsui, FDUSD, suiUSDe, AUSD, USDB, USDY. **Users no longer need SUI for gas to receive or transfer USDsui.** Source: [blog.sui.io — gasless stablecoin transfers](https://blog.sui.io/sui-launches-gasless-stablecoin-transfers-with-support-from-fireblocks/). This is a structural protocol change, not a sponsorship — removing the single biggest first-mile UX problem for any onramp into Sui.
- **Transport alignment.** Per `docs/sui-rpc-migration/migration-plan.md`, Talise's Sui surface is gRPC-primary + GraphQL for paginated reads, with JSON-RPC removed. Onramp integrations are purely HTTP-to-third-party REST (Stripe REST, Transak widget, etc.) and do not touch the Sui RPC stack — the only Sui-side concern is the destination address (already attached to each user via zkLogin) and post-delivery indexing of the receive event, which already happens via the existing gRPC `subscribeEvents` / GraphQL paths.

---

## TL;DR shortlist (top 3 by fit)

| Provider | Why shortlisted | Trade-off |
|---|---|---|
| **Stripe Crypto Onramp** | Already wired (`web/app/api/onramp/session/route.ts`); embedded SDK keeps users on `talise.app`; USDsui is issued by Stripe's own Bridge subsidiary so first-class USDsui destination support is the highest-probability future addition; Apple/Google Pay built-in; Sui-as-destination is *implicitly* supported because Stripe internally settles USDC-on-Sui per our existing scaffold | Direct USDsui destination not yet in public docs (May 2026); USA + select EU/UK only — does not cover Talise's Africa corridor |
| **Transak** | Listed by Sui Foundation as official launch onramp partner; explicitly supports buying both SUI and USDC-on-Sui; 150+ countries including Nigeria/Ghana/Kenya; light KYC under $1k in 30 seconds; widget or API integration; 0.99-3.5% fees | Direct USDsui not listed; users would land on USDC-on-Sui, then app converts; widget UX is hosted (iframe) rather than fully embedded |
| **Yellow Card** | Best Africa coverage (20 African countries — Nigeria, Ghana, Kenya, SA, Botswana, Tanzania, etc.) via mobile money + bank + cash agents; API-first; partners with Onramper for aggregation; USDC + USDT today | Does not yet enumerate Sui chain in its public stablecoin destinations — would need to confirm Sui support directly with their B2B API team |

**Recommended starting partner:** **Stripe Crypto Onramp** (already scaffolded; the Bridge→Stripe→USDsui ownership chain makes it the leading candidate to flip a feature flag and switch destination from USDC-on-Sui to USDsui-on-Sui the moment Stripe publishes it). Add **Transak** as a second-channel for non-US users and as the *primary* path until Stripe ships USDsui-native destination. Add **Yellow Card** later, on the Africa corridor.

---

## Direct USDsui support

| Provider | Geo | Embed type | Fees | KYC | Docs |
|---|---|---|---|---|---|
| **Stripe Crypto Onramp** | US (50 states) + select EU/UK as of May 2026; rolling out | Embedded SDK (clientSecret model, native iOS/web) **OR** hosted redirect | Card ~3.9% + network; ACH ~1.5% (estimate from Stripe docs; varies by region) | KYC handled by Stripe; light tier up to ~$500/wk; full tier requires ID + selfie | [docs.stripe.com/crypto/onramp](https://docs.stripe.com/crypto/onramp) — currently lists destination networks: bitcoin, ethereum, solana, polygon, stellar, avalanche, base. **Sui not yet enumerated in public docs**, but our existing `route.ts` sends `destination_network=sui, destination_currency=usdc` to Stripe successfully — implies private/beta enablement. **USDsui as `destination_currency` not yet documented.** |
| **Bridge.xyz (issuer)** | US, EU, UK, LatAm via ACH/SEPA/SWIFT virtual accounts; not retail-facing | API-only (no widget) | $20 minimum after dev fee for USDT; $1+ for others; developer-fee configurable per call | KYC/KYB built into REST endpoints; Travel Rule compliant | [apidocs.bridge.xyz/docs/on-ramp](https://apidocs.bridge.xyz/docs/on-ramp). Publicly enumerated supported chains: Ethereum, Solana, Polygon, Arbitrum, Base, Tron, Stellar. **Sui not explicitly listed in May 2026 public docs**, but Bridge issues USDsui so support is presumably in private beta. Worth a sales-engineering call. |
| **RedotPay** | 100+ countries (consumer card product, not a B2B onramp widget) | Consumer wallet + card — not embeddable into 3rd party apps | Card spend / wallet fees, not standard onramp fees | KYC at signup | [blog.sui.io — RedotPay integrates SUI + USDC-Sui](https://blog.sui.io/redotpay-integrates-sui-and-usdc-sui/). Spend, not buy. Not useful as an embeddable onramp. |

---

## USDC-on-Sui (swap path)

This is the realistic shipping path today — onramp delivers USDC-on-Sui, app auto-converts to USDsui (already implemented via `AutoConvertBanner`).

| Provider | Geo | Embed type | Fees | KYC | Sui-on-receive gas? | Docs |
|---|---|---|---|---|---|---|
| **Stripe Crypto Onramp** | US + select EU/UK | Embedded SDK or hosted | 3.9% card / 1.5% ACH (estimate, Stripe varies by region) | Stripe-managed | No (gasless stablecoin transfers on Sui since 2026-05-20) | [docs.stripe.com/crypto/onramp](https://docs.stripe.com/crypto/onramp) |
| **Transak** | 150+ countries, incl. Nigeria/Ghana/Kenya, US, EU, UK, India | Hosted widget (iframe) or API | 0.99% to 3.5% depending on payment method + country | Light KYC under ~$1k (30s); Standard KYC up to $20k (10min) | No | [transak.com/buy/usdc](https://transak.com/buy/usdc); [transak.com/blog/transak-supports-sui](https://transak.com/blog/transak-supports-sui) |
| **MoonPay** | 160+ countries; US + EU + UK + most of LatAm; limited Africa | Hosted widget or "Headless Onramps" (one-tap Apple/Google Pay, May 2026) | 4.5% card / 1% bank transfer (min $3.99) | Tiered KYC | No | [moonpay.com/buy/sui](https://www.moonpay.com/buy/sui); [moonpay.com/business/ramps](https://www.moonpay.com/business/ramps) — note: SUI is supported; **USDC-on-Sui not explicitly confirmed in public buy pages as of May 2026** — needs sales confirmation |
| **Coinbase Onramp** | US + 100+ countries with Coinbase coverage | Embedded SDK / hosted redirect (via Coinbase Developer Platform) | Card ~3.99% + spread; ACH lower | Coinbase account KYC | No | [coinbase.com/developer-platform/products/onramp](https://www.coinbase.com/developer-platform/products/onramp); [Coinbase Onramp in Slush Wallet — Sui-native, fee-free USDC-on-Sui](https://www.coinbase.com/developer-platform/discover/launches/slush-wallet). **Sui is supported via Slush integration; needs confirmation it's available via the public CDP Onramp API.** |
| **Onramper** (aggregator) | 190+ countries | Widget or API; routes across MoonPay/Transak/Stripe/Banxa/Yellow Card under one integration | Pass-through (provider fees + ~0.5% Onramper margin, estimate) | Per-underlying-provider | No | [onramper.com](https://onramper.com); [docs.onramper.com](https://docs.onramper.com/docs/getting-started). Public docs do not enumerate Sui chain as of May 2026, but they integrate Transak and Yellow Card, both of whom touch Sui — likely surfaced via the right widget params. |
| **Ramp Network** | EU + UK + US + 150+ countries | Widget or SDK | 2.9% card / 0.99% bank (estimate from Ramp pricing pages) | Tiered | No | [ramp.network](https://rampnetwork.com/). **Sui not in their listed supported chains as of 2026-05-13** ([Ramp Stablecoin Account overview](https://support.ramp.com/hc/en-us/articles/50390917452947-Ramp-Stablecoin-Account-overview)) — supports Base, Ethereum, Polygon, Arbitrum, Optimism, Solana, Tempo. Skip until they add Sui. |
| **Banxa** | 200+ countries; US (most states), UK, EU, CA, AU money licenses | Widget ("Business Ramp") or API | Card ~3-4% (estimate); spreads | Multi-tier | No | [docs.banxa.com](https://docs.banxa.com/docs/tutorial). Stablecoin-focused B2B Ramp targets EU+AU first; Sui support not confirmed in public docs. Needs sales confirmation. |
| **Mercuryo** | 50+ countries, EU-strong | Widget / SDK | 1-4% (estimate) | KYC tier-based | No | Strong USDC-on-Base support; Sui support not confirmed in public 2026 announcements. Skip unless confirmed. |
| **Alchemy Pay** | 173 countries; strong APAC + LatAm + Africa | Widget / API | 2.5-3.9% + network (also runs 0-fee USDC promo) | Basic KYC up to $5k/day | No | [alchemypay.readme.io](https://alchemypay.readme.io/docs/alchemypay-on-ramp). Sui chain not explicitly enumerated; would need confirmation. |
| **Robinhood Connect** | US + select EU | Hosted redirect | Spread-based, no explicit fee | Robinhood-account KYC | No | [robinhood.com/us/en/crypto/SUI](https://robinhood.com/us/en/crypto/SUI/). SUI is listed; **USDC-on-Sui is NOT supported** — Robinhood USDC chains are Arbitrum/Base/Ethereum/Optimism/Polygon/Solana only. Useful only if accepting SUI then swapping in-app. |

---

## Africa-focused

The Talise corridor (per BRIEF.md / WORKPLAN.md / STRATEGY.md) is Nigeria → Ghana → Kenya / cross-border remittance.

| Provider | Geo | Embed type | Fees | KYC | Sui? | Docs |
|---|---|---|---|---|---|---|
| **Yellow Card** | 20 African countries (Nigeria, Ghana, Kenya, SA, Botswana, Tanzania, Uganda, Rwanda, Cameroon, DRC, etc.) | API-first ("Payments API Suite"); also via Onramper aggregator | Provider rates + FX spread (estimate; varies per country) | KYC required (varies per country — BVN for Nigeria) | Lists "30+ blockchains" — Sui not explicitly enumerated in public docs as of May 2026, but USDC + USDT supported. Worth a direct sales conversation. | [yellowcard.io/api-suite](https://yellowcard.io/api-suite); [docs.yellowcard.engineering](https://docs.yellowcard.engineering/) |
| **Kotani Pay** | Africa-focused (Kenya, Ghana, Nigeria, Uganda, Tanzania, Zambia, Rwanda, etc.); also services offline / USSD-based | API | Per-country mobile-money rates | KYC handled per-country | Supports USDC across multiple chains; Sui not explicitly confirmed in their public docs | [kotanipay.com/on-off-ramp](https://kotanipay.com/on-off-ramp) |
| **Fonbnk** | 19 markets, 15 blockchain networks; airtime-to-stablecoin (unique) | API | Per-country + airtime conversion spread | Light KYC for low amounts | "15 blockchain networks" — needs sales confirmation on Sui | [fonbnk.com](https://www.fonbnk.com/) |
| **Onafriq** (via Conduit) | 40 African markets; 1B+ mobile-money wallets, 500M bank accounts | B2B partnership (not a widget) — through Conduit for stablecoin | Wholesale | Wholesale | USDC routing via Conduit; Sui not enumerated | [Conduit + Onafriq partnership](https://finance.yahoo.com/news/conduit-onafriq-partner-enable-stablecoin-061532070.html) |
| **Maplerad** | Nigeria + Ghana + select Africa; primarily card-issuing + virtual-account API | API | Per-country | KYC | No published Sui support | (sales contact required) |
| **Paychant** | Africa-focused fiat on/off-ramp for stablecoins | API | Per-country | KYC | No public Sui mention | [paychant.com](https://paychant.com/) |

---

## Recommended integration approach

### Phase 1 — Today (already shipped)

**Stripe Crypto Onramp** (embedded SDK, US-only). Destination is USDC-on-Sui, auto-swapped to USDsui by `AutoConvertBanner`. This is `web/app/api/onramp/session/route.ts` as-is. No changes needed.

### Phase 2 — Africa GA (this quarter)

Add **Transak** as a second-channel route for non-US users:

- Same embedded pattern as Stripe (or hosted widget for fastest ship).
- Destination: USDC-on-Sui (delivered to user's zkLogin Sui address). App auto-swaps to USDsui.
- KYC tiering matches Talise's daily limit tiers naturally.
- Per-country pricing covers NG / GH / KE.

Server route shape: mirror `app/api/onramp/session/route.ts` as `app/api/onramp/transak-session/route.ts` — same `requireAppAttestStructural`, same `readEntryIdFromRequest`, same wallet-lock-down to `user.sui_address`. No new Sui RPC sites — onramp does not touch the gRPC/GraphQL transport stack outlined in `docs/sui-rpc-migration/migration-plan.md`.

### Phase 3 — Africa local-rail depth

Add **Yellow Card** via direct API (mobile money / bank in 20 African markets). Use Onramper as a fallback aggregator to fill gaps without N integrations.

### Phase 4 — Native USDsui destination

When Stripe publishes USDsui as a directly-buyable `destination_currency`, flip a single env-controlled feature flag in `route.ts`:

```ts
form.set("destination_currency", process.env.TALISE_ONRAMP_DEST ?? "usdc");
```

This eliminates the USDC→USDsui auto-swap leg and removes one source of slippage.

### Auth + gas + KYC stack

| Concern | Talise handles via | Reason |
|---|---|---|
| Destination address | `user.sui_address` (zkLogin) | One address per user, deterministic |
| Gas to *receive* USDsui | Not needed — Sui gasless stablecoin transfers since 2026-05-20 | [blog.sui.io gasless](https://blog.sui.io/sui-launches-gasless-stablecoin-transfers-with-support-from-fireblocks/) |
| Gas to *spend* USDsui later | Shinami Gas Station (already wired per `lib/zkclient.ts`) | Sponsored zkLogin send |
| KYC | Handled by onramp partner (Stripe / Transak / Yellow Card) | We don't store or process PII beyond what the partner returns in webhooks |
| Webhook receipts | `web/app/api/onramp/webhook/route.ts` (already scaffolded) | Mark a user's onramp session as fulfilled when partner confirms |

---

## Open questions / sources

1. **Does Stripe Crypto Onramp officially support `destination_network=sui` and `destination_currency=usdc` in 2026-Q2?** Our route works in practice (the staged code is live), but it's not enumerated in public docs. Action: get written confirmation from a Stripe rep; also ask for ETA on `destination_currency=usdsui`.
2. **Bridge.xyz onramp + Sui chain support.** Sui is not in Bridge's public chain enumeration as of May 2026, but Bridge issues USDsui — there must be a path. Action: sales call.
3. **Coinbase Onramp via CDP API + Sui chain.** Confirmed via Slush Wallet partnership; need to verify it's available to all CDP customers via the public Onramp API, not just Slush.
4. **Yellow Card Sui chain destination.** "30+ blockchains" claimed; Sui not explicitly enumerated. Direct API engineer contact needed.
5. **Onramper — does it surface a Sui chain destination in its widget?** Their docs don't list Sui as a `destNetwork` param value as of May 2026. Worth probing the widget API directly with `defaultCrypto=usdc_sui` to see if it resolves.
6. **Pricing — all "estimate" figures above** come from provider general pricing pages; **negotiate a Talise-specific rate card with each shortlisted partner** before committing to a primary, especially for Africa where retail card rates are punitive.

### Source list

- USDsui announcement: [blog.sui.io](https://blog.sui.io/sui-unveils-usdsui-native-stablecoin/), [coindesk.com](https://www.coindesk.com/business/2025/11/12/sui-launches-native-stablecoin-usdsui-using-bridge-s-open-issuance-platform)
- Sui gasless stablecoin transfers: [blog.sui.io](https://blog.sui.io/sui-launches-gasless-stablecoin-transfers-with-support-from-fireblocks/)
- Stripe Crypto Onramp: [docs.stripe.com/crypto/onramp](https://docs.stripe.com/crypto/onramp), [stripe.com/use-cases/crypto](https://stripe.com/use-cases/crypto)
- Bridge.xyz: [bridge.xyz](https://www.bridge.xyz/), [apidocs.bridge.xyz](https://apidocs.bridge.xyz/)
- Transak: [transak.com/blog/transak-supports-sui](https://transak.com/blog/transak-supports-sui), [transak.com/buy/usdc](https://transak.com/buy/usdc), [transak.com](https://transak.com/)
- MoonPay: [moonpay.com/buy/sui](https://www.moonpay.com/buy/sui), [moonpay.com/business/ramps](https://www.moonpay.com/business/ramps), [moonpay.com pricing disclosure](https://www.moonpay.com/legal/pricing_disclosure)
- Coinbase Onramp: [coinbase.com/developer-platform/products/onramp](https://www.coinbase.com/developer-platform/products/onramp), [Slush Wallet launch](https://www.coinbase.com/developer-platform/discover/launches/slush-wallet)
- Onramper: [onramper.com](https://onramper.com), [docs.onramper.com](https://docs.onramper.com/docs/getting-started)
- Ramp Network: [ramp.network](https://rampnetwork.com/), [stablecoin support article](https://support.ramp.com/hc/en-us/articles/50390917452947-Ramp-Stablecoin-Account-overview)
- Banxa: [docs.banxa.com](https://docs.banxa.com/docs/tutorial), [Business Ramp widget overview](https://docs.banxa.com/docs/banxa-business-ramp-widget-overview)
- Mercuryo: [mercuryo.io](https://mercuryo.io/explore/announcements/making-usdc-more-accessible-mercuryo-launches-fee-reduction-on-ramp-campaign-with-coinbase-metamask-and-base)
- Alchemy Pay: [alchemypay.org](https://alchemypay.org/), [alchemypay.readme.io](https://alchemypay.readme.io/docs/alchemypay-on-ramp)
- Robinhood: [robinhood.com/us/en/crypto/SUI](https://robinhood.com/us/en/crypto/SUI/), [crypto transfers help](https://robinhood.com/us/en/support/articles/crypto-transfers/)
- Yellow Card: [yellowcard.io/api-suite](https://yellowcard.io/api-suite), [docs.yellowcard.engineering](https://docs.yellowcard.engineering/), [Onramper partnership](https://www.onramper.com/blog/yellow-card-partners-with-onramper-to-enhance-crypto-onboarding-in-africa)
- Kotani Pay: [kotanipay.com/on-off-ramp](https://kotanipay.com/on-off-ramp)
- Fonbnk: [fonbnk.com](https://www.fonbnk.com/)
- Onafriq + Conduit stablecoin: [Yahoo Finance — Conduit Onafriq partnership](https://finance.yahoo.com/news/conduit-onafriq-partner-enable-stablecoin-061532070.html)
- RedotPay: [blog.sui.io — RedotPay SUI integration](https://blog.sui.io/redotpay-integrates-sui-and-usdc-sui/)
