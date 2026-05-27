# 44. Flow: earn and receive

This doc covers two related surfaces. **Receive** is the passive
counterpart to send: the user shares a handle, others pay them. **Earn**
is what the user does with idle USDsui sitting in their wallet: supply
to Navi at the current APY, watch the position accrue, withdraw at any
time.

## Receive

There is no separate "receive transaction." A user receives by sharing
their handle. The handle resolves to their vault address (or, for users
without a vault, their bare zkLogin address), and anything sent to that
address shows up after the auto-swap pass converts it to USDsui.

What the Receive surface gives the user is three artifacts:

**Handle card.** `/receive` on web and the Receive sheet on iOS render
a card showing `alice@talise.sui` along with the resolved address.
The address is shown for advanced users who want to verify; the handle
is the primary affordance.

**QR code.** The QR encodes a deep link
(`talise://pay?to=alice@talise.sui&amount=...`) that opens the iOS app
on the sender's phone with a prefilled Send screen. The fallback is a
web URL at `talise.app/p/alice` that surfaces the same Send flow in
the browser.

**Shareable link.** `talise.app/p/<handle>` is the public-facing
payment link. The sender lands on a page that resolves the handle
on chain, displays it back in human terms, and routes them into a
Send flow (which, if they are signed in, runs the sponsored 2-trip
flow from `42-flow-send.md`).

The reverse-resolve flow that powers "your handle on /home" uses
`findTaliseSubnameForOwner(address)` to scan the user's
`SubDomainRegistration` objects. If they own one, the card renders
their handle; if not, the dashboard surfaces a "Claim your @username"
banner that links to `/claim`.

## Earn: Navi USDsui supply

The Earn tab is the user's path from "I hold dollars" to "I earn yield
on dollars." Today it surfaces a single venue (Navi USDsui supply),
with DeepBook Margin sitting alongside for users who already have a
position there. Navi is the default because USDsui supply on Navi has
non-trivial utilization and a live APY in the 5 to 9 percent range.

The Earn surface shows three numbers per venue:

- **APY** (live, from `fetchNaviUsdsuiSupplyApy`). Surfaced as a
  percentage. Below 1 basis point it renders as a dash rather than
  "0.00%" because DeepBook in particular drops to zero utilization in
  quiet periods and "0.00% APY" misleads. See
  `EarnView.swift:185-195`.
- **Supplied** (the user's current position value from the venue
  adapter, in USDsui).
- **Earned** (the accrued yield computed by
  `naviPositionFromActivity`, see below).

A projected-yield row underneath shows what the user can expect: daily
yield at `current × apy / 365` and annual at `current × apy`.

### The dust-rounding-aware earned calculation

A natural way to compute "earned" is `currentValue − (deposits − withdrawals)`.
In practice this fails because of USDsui-dust rounding inside Navi's
integer-u64 supply accounting: tiny rounding losses on every supply or
withdraw can push naive net deposits a few cents above currentValue,
which makes earned go negative.

`naviPositionFromActivity` in `web/lib/navi-supply.ts:255` handles this
with a three-branch fix:

1. **No history.** If the user has no recorded Navi activity at all,
   conservatively set `principalSupplied = currentValue` and `earned = 0`.
2. **Happy case.** If naive net-deposits is at or below current, set
   `principalSupplied = naiveNetDeposited` and
   `earned = currentValue − naiveNetDeposited`.
3. **Dust case (naive net-deposits exceeds current).** Fall back to a
   time-weighted projection that uses the earliest Navi-invest
   timestamp:

   ```text
   yearsSinceFirstSupply = (now − tFirstSupply) / 365d
   projected = min(
     currentValue × 0.10,
     currentValue × apy × yearsSinceFirstSupply
   )
   earned = max(0, projected)
   principalSupplied = max(0, currentValue − earned)
   ```

   The 10% cap prevents runaway projections for long-tenured users
   whose principal may have been swapped in and out repeatedly. The
   iOS UI labels these as "estimated" via the dailyEarning row, so a
   modest projection reads as honest rather than misleading.

This calculation is what feeds the "Withdraw earned" button on iOS.
The server-side floor is 1 cent (`DUST_USDSUI = 0.01`); the iOS-side
floor is the equivalent of about 10 NGN. If the computed `earned`
is under the floor, the button hides and the supply position remains
intact.

## Withdraw

Three withdraw paths exist, all of which build sponsored-ready PTBs.

**`/api/earn/withdraw/prepare`** is the general partial-or-full
withdraw, the new route introduced in this branch. It accepts
`{ venue, amount? }` where:

- `venue` is `"navi"` or `"deepbook"`.
- `amount` is the USDsui amount to withdraw. Omitting it (or passing
  zero) means "withdraw everything."

For Navi, the route calls `appendNaviWithdraw` which composes the
withdraw entry plus a Pyth oracle refresh in the same PTB (Navi
requires a fresh price for its position-health check). For DeepBook,
the route fetches the `SupplierCap` id for the user's address and
calls `buildWithdrawUsdsuiMargin`. Both paths close with a Payment
Kit receipt tagged `kind: withdraw, venue: <v>` so the activity feed
can render "Withdrew from Navi" authoritatively.

**`/api/earn/withdraw-earned/prepare`** is the yield-only withdraw. It
computes `earned` server-side from current position and activity
history, asserts the result is above the dust floor, and builds a
Navi withdraw for exactly that amount. The user gets paid out their
accrued yield while the principal stays supplied and keeps earning.
Today this is Navi-only because DeepBook redeems supplier shares
rather than typed USDsui amounts, which makes a clean partial
yield-only withdraw non-trivial. The iOS Earn view hides the button
for non-Navi venues.

**`/api/earn/supply/prepare`** is the inverse: it builds a PTB that
deposits a user-specified USDsui amount into the chosen venue. The
sponsor flow is the same two-trip pattern as send (see
`42-flow-send.md`).

## Display

The Earn view ranks venues by APY and picks a default. The user's
own positions surface in line under each venue card. A bottom-sheet
withdraw flow opens when the user taps any position; an inline
deposit affordance opens a corresponding supply sheet.

Daily and annual yield projections are computed client-side from the
server-blessed `currentValue` and `apy`, so they tick live whenever
the user reopens the screen. They are intentionally projections, not
realized yield: realized yield is what the "Withdraw earned" button
actually moves on chain.

## Cross-references

- `42-flow-send.md` for the two-trip sponsor pattern that supply and
  withdraw both reuse.
- `43-flow-auto-swap.md` for what happens to a non-USDsui inbound
  before it reaches the Earn surface.
- `45-protocol-design-decisions.md` for why Navi was picked over
  Suilend / Scallop.
