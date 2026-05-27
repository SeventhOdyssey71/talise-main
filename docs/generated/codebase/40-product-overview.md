# 40. Product overview

## What Talise is

Talise is a consumer payments app on Sui aimed at the African remittance
corridor. A user signs in with Google, claims a handle of the form
`alice@talise.sui`, and sends or receives dollar-denominated value as
easily as they would on Cash App or Wise. The product hides the chain on
purpose. There is no seed phrase, no gas token to acquire, no swap screen
to navigate, and no wallet to install. The user sees a handle, an amount
in their local currency, and a balance.

What sits behind that simple surface is a Move package on Sui mainnet, a
Next.js web app, a SwiftUI iOS client, and a Cloudflare Worker called
Onara that pays gas on the user's behalf. Anything sent to a Talise
handle, whether SUI, USDC, USDT, or some random meme coin, is
auto-converted to USDsui (Sui's native dollar-pegged stablecoin) and
deposited into the user's wallet within about a minute. Idle USDsui can
earn yield on Navi in one tap. None of that requires a per-transaction
signature from the recipient.

Today Talise is in pre-launch private beta. The web landing page at
`talise.app` runs a waitlist. The iOS app is being built in parallel and
exercises the full protocol (sign-in, handle claim, send, receive,
auto-swap settings, earn, history). The Move package is on Sui mainnet
with 66 of 66 tests passing. The first real corridor (Nigeria) is what
the team is shipping against.

## Target market

The product targets the Sub-Saharan remittance corridor with an initial
focus on four markets: Nigeria, Kenya, Ghana, and South Africa. These
are countries where:

1. The diaspora-to-home flow is large and continuous (Nigeria alone
   receives roughly $21B/year per World Bank 2024 data).
2. The legacy rails are expensive (Sub-Saharan Africa averages 7.89% on
   a $200 send, vs. the global average of 6.65%).
3. The recipient is often on a worse device and worse network than the
   sender, which makes a seed-phrase wallet the wrong abstraction.
4. Local-currency holdings devalue meaningfully against the dollar over
   any 12-month window, which is why 79% of crypto-active Nigerians
   already hold a stablecoin as a synthetic dollar.

The user Talise wants to win is not the crypto-native power user. It is
Amaka in London sending fifty pounds to her mother in Lagos, and
Mama Adaeze in Lagos who needs to receive that money in a wallet that
holds dollars and feels like a normal app.

## Core value propositions

Four things differentiate the consumer experience.

**Free transfers.** Onara, the gas sponsor, pays gas on every send. The
user holds zero SUI. There is no Talise stack fee, only the off-ramp
fee at the destination, which Talise does not collect today.

**Dollar-denominated holding via USDsui.** Anything you receive becomes
USDsui before it touches your wallet. The recipient sees a stable
dollar balance, not a portfolio of fragments they have to learn to
manage. Local-currency rendering (NGN, KES, GHS, ZAR) is layered on top
through an FX lookup; USDsui is the canonical hold asset.

**Sub-second settlement on Sui.** Mysticeti consensus finalizes
owned-object transactions in well under a second and shared-object
transactions in roughly one. The recipient does not wait. This is what
makes the experience feel like a payment instead of a transfer.

**Earn yield on idle balance.** USDsui sitting in the wallet can be
supplied to Navi from inside the Earn tab. Supply, withdraw, and a
yield-only withdraw all build sponsored PTBs. The user signs once. The
APY surfaces live in the Earn view.

## Why Sui specifically

Three platform properties make Talise possible on Sui in a way that is
not yet possible elsewhere in production.

**zkLogin removes the seed phrase.** Sign-in with Google derives a
deterministic Sui address through the OAuth identity. Recovery is
Google account recovery: the same trade Apple Cash makes with iCloud.
No other production L1 has this primitive.

**Sub-second finality means payments feel like payments.** A consumer
payments product cannot ship on a chain whose tail latency goes to
thirty seconds under load. Sui's parallel execution keeps the auto-swap
worker from being a sequencer bottleneck even when many users convert
inbound coins in the same minute.

**The accumulator model.** Sui routes plain transfers to shared-object
addresses through a global accumulator at `0x000...0acc`. This
behavior is a Sui platform quirk that initially looked like a bug to
the Talise auto-swap cron (deposits showed as zero in
`getOwnedObjects`); the fix turned it into a feature. See
`43-flow-auto-swap.md`.

**SuiNS subnames as handles.** Talise owns the `talise.sui` SuiNS
domain and mints `*.talise.sui` subname NFTs into the user's wallet.
The NFT is the handle. The user owns it. Talise cannot revoke it
without the user's signature.

**Sponsored gas is first-class.** Onara signs as `gasOwner` on every
user-submitted PTB, which lets the user transact without ever holding
SUI. Combined with zkLogin, this is what makes onboarding feel like
"sign in" rather than "set up a wallet."

## Competitive positioning

Against Wise, Western Union, and Remitly, Talise is structurally
different: there is no correspondent-banking partner, no FX spread on
the Talise stack, and no settlement delay. Funds land on a public chain
in the recipient's wallet, denominated in USDsui from the moment the
swap closes. The 7.89% Sub-Saharan corridor fee that the legacy rails
charge collapses to whatever the off-ramp partner takes at the last
mile (Yellow Card, Onramper, M-Pesa partners are on the roadmap).

Against Phantom and Suiet, Talise is the inverse: those are wallets the
user installs and secures with a mnemonic. Talise is a payment account
the user signs into. The recipient who just wants the equivalent of
fifteen dollars in dollars is the wrong audience for a sovereign-wallet
product, and the right audience for Talise.

Against embedded-wallet SDKs like Privy and Magic, Talise is the
destination, not the toolkit. Each Privy integration produces its own
siloed account; the Talise handle resolves to a single account across
every Talise surface (iOS, web, future SDK integrations).

## The handle system

Handles follow an email-style format: `alice@talise.sui`. The part
before the `@` is the user's chosen name; the part after is the
SuiNS-issued parent domain that Talise's operator key controls. The
handle is implemented as a SuiNS subname under `talise.sui` and is
minted as an NFT into the user's wallet (see `42-flow-send.md` and
`02-move-rbac-and-caps.md`). The DB does not own the handle. Authoritative
state lives on chain.

## Current state

Pre-launch private beta. Waitlist live at `talise.app`. iOS in active
development. Move package v7 on Sui mainnet with role separation,
per-user daily caps, allowlists, global pause, and a slippage ceiling.
Onara worker live. First corridor: Nigeria. External audit scheduled
before user funds exceed $10k.
