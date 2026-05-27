# 45. Protocol design decisions

This doc captures the "why this and not that" set. Every choice below
has alternatives that are valid in isolation; what makes them coherent
is that they were picked together to serve one product thesis (consumer
payments that feel like a bank app, not a wallet).

## Why USDsui (not USDC) as the canonical hold asset

USDsui is Sui's native dollar-pegged stablecoin. USDC on Sui is a
bridged asset issued by Circle through Wormhole's native-issuance
program. Both look like dollars to the user. The protocol-level
differences that pushed Talise to USDsui:

- **No bridge dependency.** USDC on Sui is fundamentally tied to
  Wormhole's attestation set and Circle's issuance posture. USDsui
  is issued natively; there is no second protocol's safety to insure
  against.
- **No canonical-versus-wrapped distinction.** USDC, on a chain that
  is not Ethereum, has a long history of confusing users about
  which version they hold. USDsui has one form.
- **Single fixed conversion destination.** The auto-swap loop has a
  hardcoded `Dest = USDsui` in the off-chain SDK; the user has
  expressed a preference for dollars and nothing else. Encoding that
  as a native asset means the conversion is a swap-in-place, not a
  swap-plus-bridge.

The trade-off is that USDsui's liquidity ecosystem is smaller than
USDC's on equivalent chains. The Cetus aggregator handles this by
routing through whatever underlying pools have depth, often via SUI
or USDC as an intermediate hop.

## Why Cetus over other DEXes

Cetus is the largest concentrated-liquidity AMM on Sui, and crucially,
ships an aggregator (router v3) that routes across 20+ underlying
DEXs for best execution. The product-level reasons:

- **One integration, many pools.** Talise's auto-swap loop does not
  need to know which underlying pool actually filled the swap. The
  aggregator picks; the cron just hands it a `Balance<Source>` and
  takes back a `Balance<USDsui>`.
- **Best price across the ecosystem.** For long-tail coins where any
  single DEX would be a partial fill, the aggregator splits across
  pools.
- **Production maturity.** Cetus has the longest track record on
  Sui mainnet, which matters because the auto-swap path runs without
  per-transaction user consent: the protocol-level guarantee that
  "your money lands as USDsui" depends on the swap actually executing.

The trade-off is that the aggregator is itself an integration surface
that could change. The Move-level slippage assertion (output ≥ quoted
× 0.98) is the seatbelt: if the aggregator silently regresses, the
PTB reverts rather than silently handing the user a bad price.

## Why Navi over other lending markets

Navi was picked as the default yield venue over Suilend and Scallop
for three reasons:

- **USDsui supply market exists with non-trivial utilization.** Navi
  was the first to list USDsui as a supply asset with real demand on
  the borrow side, which is what makes the APY non-zero.
- **One-PTB supply with Pyth refresh.** Navi's withdraw entry takes
  a USDsui amount and runs the Pyth oracle refresh in the same
  transaction. Suilend and Scallop have similar primitives but Navi's
  TypeScript SDK was the cleanest to integrate against the existing
  T2000 wrapper.
- **Reasonable risk profile.** Navi has the deepest TVL among Sui
  lending markets and the longest production history. For a
  consumer-payments product where the user has not opted into DeFi
  risk explicitly, "boring and battle-tested" beats "high APY but
  newer."

The Earn view's `/api/yield/comparison` endpoint compares APYs across
venues (Navi vs Suilend vs DeepBook Margin) so the user can pick a
different venue if they want. Navi is the default surface but not
the only option.

## Why zkLogin (Google) over wallet connect

Wallet connect via Phantom / Suiet / Sui Wallet is the obvious
alternative. zkLogin won because the user Talise wants is the user
who does not have a wallet. The product wedge is "Mama Adaeze who
needs to receive money in dollars," and "install a wallet, write
down a seed phrase, fund it with gas" is the wrong onboarding for
that user.

Three protocol-level properties of zkLogin matter:

- **Deterministic address from `(iss, sub)`.** Same Google account,
  same Sui address, forever. Recovery is "log into Google on a new
  phone." Apple Cash makes the same trade-off against iCloud.
- **No seed phrase to lose.** The recovery vector is whatever Google
  provides (trusted contacts, backup codes). For the target user
  this is much better than a 12-word mnemonic.
- **Ephemeral key.** The browser or iOS app holds a 55-minute-TTL
  ephemeral keypair, not a long-lived private key. A compromised
  device window is bounded.

The trade-off is dependency on Google account custody. The litepaper
and the threat model are explicit about this. For users who want
sovereign custody, Talise is not the right product; Phantom and
Suiet are.

## Why a sponsored transaction model

Onara, the sponsor, pays gas on every user-submitted PTB. The user
holds zero SUI. The product reason is that asking a new user to
acquire SUI before they can transact is a deal-breaker: it requires
either an on-ramp purchase (high friction, KYC, fees) or receiving
SUI from someone else (chicken-and-egg). Free transfers are the
hook.

The Onara worker is a Cloudflare Worker holding a hot sponsor
keypair. Its policy ("talise") gates on:

- Maximum gas budget per transaction.
- Maximum commands per PTB.
- Targets matcher: `["*"]`, which requires at least one MoveCall.
  This is what forces the vanilla-send clock shim from `42-flow-send.md`.

## The economic model

If transfers are free and the Talise stack charges zero on the swap,
how does the protocol stay solvent? The current intent has three
pieces:

**Yield rebate (the float, primary).** USDsui balances sitting in
user wallets (including idle balances) earn yield on Navi. The
product's economic model assumes Talise will, in a future version,
take a small portion of the spread between the lending APY and the
APY shown to the user. At launch the user sees the full APY; the
take rate is documented as a future lever, not a current one. This
is the model the strategy doc discusses under "QR payments for
merchants" (vendor balance float earns yield; the protocol keeps a
slice).

**Off-ramp partnership margin (secondary, on the roadmap).** When
the user converts USDsui to NGN, KES, GHS, or ZAR through a partner
like Yellow Card, Onramper, or a mobile-money operator, the partner
charges a fee. Talise can negotiate a share of that fee at scale.
This is what the litepaper alludes to with "off-ramp at the
destination, which Talise does not collect" today: the door is
explicitly left open to collect a slice tomorrow.

**Take rate on auto-swap (tertiary, not yet enabled).** The auto-swap
path runs through Cetus's aggregator. A 5 to 25 basis point fee on
the converted amount would be invisible to the user (well under the
existing slippage tolerance) and would meaningfully fund the
sponsor wallet. Today this is zero.

**Tip jar / optional fees (long tail).** A user who wants to support
the project can opt to add a small voluntary fee on send. This is on
the roadmap as a future surface, not a current revenue line.

Until any of these are turned on, the sponsor wallet is funded by
the team. The strategy doc is honest that this is a finite runway
that the product needs to close before the audit milestone.

## The 4-role admin model in plain English

The Move package's v7 RBAC splits privileged actions across four
roles, with a 48-hour delay window on the most sensitive ones.
Translated out of code:

- **Root / admin (cold key).** The one key that can grant or revoke
  any other role. Held offline in deep storage. Can rotate itself
  through a 2-step handoff: `begin_admin_transfer` sets a pending
  address and snapshots a 48-hour delay; `accept_admin_transfer`
  finalizes only after the snapshot expires. The snapshot defeats
  shrink-attacks where a compromised admin tries to shorten the
  delay before the rotation completes.
- **Treasury (cold, multi-sig in practice).** The role that
  governs what asset types are allowed as conversion destinations
  (the `allowed_dest_types` list) and what Cetus provider strings
  are allowed (the aggregator routes that can be called). Treasury
  cannot pause or rotate admin; it can only manage the allowlists.
- **Oncall (warm).** The role that can pause and unpause the
  registry in an emergency. Oncall cannot mint, cannot change
  allowlists, cannot rotate admin. Pause is the kill-switch for
  "stop all auto-swaps now," which is the right blast radius for
  a warm key.
- **Worker (hot, on the Onara key).** The role the cron worker
  uses to call `validate_for_swap_v2`. Worker cannot pause, cannot
  rotate, cannot add to allowlists. A compromised worker can
  only drain up to the per-cap daily budget before the on-chain
  cap hits zero and refuses further validation.

The principle is least-privilege: each role can only do the thing
its trust tier justifies. A worker key compromise is bounded by the
per-user daily caps. A treasury compromise cannot rotate admin. An
admin rotation always honors the snapshotted delay.

Cross-reference: `02-move-rbac-and-caps.md` has the source-line-level
detail on each role's powers and the 2-step transfer mechanics.
