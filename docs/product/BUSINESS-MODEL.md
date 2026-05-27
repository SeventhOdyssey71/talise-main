# Talise Business Model

**Status:** Draft v1
**Last updated:** 2026-05-27
**Companion to:** `docs/product/LITEPAPER.md`

## 1. Positioning, in one sentence

Talise is free for the user where it matters (sending money to another Talise handle), and earns a small, transparent margin on the boundary actions where the user moves between currencies and rails. The product wins by being **20x cheaper than the incumbent** (Wise, Western Union, Remitly) on the headline action, not by being literally free end-to-end.

## 2. What "free" actually means

The hero promise "Send money across the globe. For free." is scoped to:

* The **network fee** on a Sui transaction. Talise sponsors gas. For pure USDsui transfers the protocol-native gasless path means even the sponsor pays nothing.
* The **per-transfer fee**. Talise does not charge $10 to push money like Western Union. Sending USDsui from one Talise handle to another is genuinely $0 to the user.

It is not scoped to:

* The **FX spread** when an inbound coin auto-swaps to USDsui.
* The **off-ramp spread** when USDsui converts to naira / cedis / shillings / rand in the user's bank account.
* The **on-ramp spread** when fiat buys USDsui through Stripe Onramp.
* The **yield take** on idle USDsui in Earn.

This is the same boundary that Wise, Revolut, Chime, and Cash App all operate inside. "Free transfers" is the marketing claim; the business runs on the spread at the edges. The honesty fix is to say that out loud, not to retire the claim.

## 3. Revenue streams, ranked by confidence

### 3.1 FX spread on auto-swap (primary, structural)

**Mechanic:** Every coin sent to a Talise handle gets routed through Cetus to USDsui via the auto-swap path. The user sees "you received X USDsui." The route price can carry a configurable spread above the Cetus mid-price.

**Why it works:**
- Invisible to the user. There is no itemised "FX fee" line. The user compares the final USDsui delivered against the expected sender amount and sees a number that is still 95% better than Western Union.
- No new flow, no new UI, no new permission. It is a single config value in the Move auto-swap module or the off-chain caller that constructs the swap PTB.
- It scales linearly with volume. Every send through the auto-swap path is a billable event.

**Numbers:**
- On a $200 remit at a 30 bps spread, Talise earns $0.60.
- Western Union on the same corridor: $10 to $20.
- Talise's user-visible price advantage: 95% to 97% cheaper than the incumbent, while still booking margin.
- 100k monthly senders at $200 average and 30 bps: $60k/month, $720k/year.

**Risks:**
- A user with on-chain literacy can compare against Cetus mid-price and notice the spread. Mitigate by (a) keeping spread small enough that it falls inside normal slippage tolerance, (b) being transparent about it in this document and the litepaper, (c) framing as "routing margin" rather than a fee.

**Ship gate:** v1. This goes live the day the auto-swap path goes live.

### 3.2 Off-ramp margin (primary, large)

**Mechanic:** Sending USDsui to another Talise user is free. Cashing out to a local bank account or M-Pesa is not. Talise converts USDsui to local fiat at a routed rate that includes a margin, then pushes through Flutterwave / Paystack / M-Pesa.

**Why it works:**
- This is the same lever Wise uses on every cross-border send. Wise's headline rate is "near mid-market" plus a small spread; the spread is the entire business.
- The user's reference point is Western Union (5-10% all-in). A Talise off-ramp at 0.5% feels free even though it is the only place a real fee is captured.
- Volume scales with the size of each transaction, not the count. Larger remits subsidise the small ones.

**Numbers:**
- On a $200 cash-out at 50 bps: $1.00.
- On a $2000 cash-out at 50 bps: $10.00.
- 100k monthly off-ramps at $300 average and 50 bps: $150k/month, $1.8M/year.

**Risks:**
- Liquidity. Talise needs a USDsui ↔ local-currency liquidity provider (likely an OTC desk per corridor). Until the desks are live, this revenue line is theoretical.
- Regulatory. Pushing fiat into a Nigerian bank account requires either a licensed counterparty (Flutterwave, OnePipe) or a license. Margin negotiations happen with the licensed partner.

**Ship gate:** v1.5 or v2 (depends on payout-partner integration timeline). Probably the first non-test corridor is the Naira corridor through Flutterwave.

### 3.3 Yield rebate on idle USDsui (recurring, scales with float)

**Mechanic:** Talise's Earn surface routes idle USDsui to Navi for supply yield. Today the litepaper implies the full APY flows to the user. The lever: keep a slice.

**Why it works:**
- This is how every neobank operates. Chime, Wise, Revolut, Cash App all earn float income. Users do not expect to receive 100% of the underlying interbank rate.
- Marginal cost is zero. The yield is already being earned on the user's behalf; Talise just keeps a portion at the display layer.
- It scales with float, not with volume. A user who deposits $1000 and never moves it generates ~$10/year at a 1% take (assuming a 6% gross yield and 5% display yield).

**Numbers:**
- Gross Navi APY: ~6% (variable; check the live number in `web/lib/navi-supply.ts`).
- Display APY to user: ~5%.
- Take: ~1% (100 bps).
- $10M idle float × 100 bps = $100k/year.
- $100M idle float × 100 bps = $1M/year.

**Risks:**
- Transparency. The litepaper currently implies the user gets the full APY. The fix is to clarify in the litepaper and Earn UI that the displayed APY is the user's APY, not the underlying protocol APY.
- APY volatility. If Navi gross APY compresses below the displayed user APY, Talise is paying out of pocket. Mitigate with a dynamic display rate.

**Ship gate:** v1.5. Live the day the Earn surface is in production, by adjusting the displayed APY downward from the live Navi rate.

### 3.4 On-ramp take rate (small, passthrough)

**Mechanic:** Stripe Crypto Onramp handles fiat → USDsui purchases. Stripe takes its cut. Talise can add a small spread on top of the USD → USDsui leg.

**Why it works:**
- Already wired up. The integration lives at `web/app/api/onramp/...` (see `12-web-libs.md`).
- Users expect on-ramp fees. Coinbase, MoonPay, and Stripe all charge in the 1-4% range. A 50 bps add-on is invisible inside that band.

**Numbers:**
- $100 on-ramp at 50 bps: $0.50.
- This is the smallest line because most users on-ramp once or twice and then transact within the Talise system thereafter.

**Risks:**
- Stripe ToS. Check that adding a margin on top of Stripe's published rate is permitted. If not, the revenue line is zero and the integration is purely a user-acquisition cost.

**Ship gate:** v1, subject to Stripe ToS check.

### 3.5 Premium tier (optional, long horizon)

**Mechanic:** A $5/month Talise Plus tier that unlocks higher displayed yield, faster off-ramps, multi-handle, business accounts, virtual cards, priority support.

**Why it works:**
- Recurring revenue, predictable. Every 100k subscribers at $5/month is $6M/year.
- Pricing power. By the time a user pays $5/month, they are sending and receiving enough volume to make the spread-based revenue worth defending.

**Why not v1:**
- Muddies the "free" narrative. Hard to position a free product alongside a paid tier without the paid tier feeling like the bait-and-switch the marketing rules out.
- Requires the product to have a base of users who would pay for incremental features. Pre-launch is the wrong time.

**Ship gate:** v2+. Likely 100k active users threshold before considering.

## 4. Unit economics, illustrative

Assume a representative user in the African remittance corridor:

* On-ramps once at $500. Talise earns $2.50 (50 bps).
* Holds an average idle balance of $200 across the year. Talise earns $2.00 (100 bps × $200).
* Sends $100/month to a Talise handle on the other side of the corridor. The recipient auto-swaps and Talise earns $3.60/year (30 bps × $1200 annual volume).
* Recipient off-ramps $100/month. Talise earns $6.00/year (50 bps × $1200).

**Total per active corridor user per year: ~$14.10.**

10k corridor users: $141k revenue.
100k corridor users: $1.41M revenue.
1M corridor users: $14.1M revenue.

These are rough sketches. Tweak the spreads up or down, the float assumption up or down, the corridor volume up or down. The point is the unit economics work even at conservative assumptions, and there is meaningful upside as transaction sizes grow (larger off-ramps are flat-rate margin, so the 50 bps becomes more dollars).

## 5. Costs, by category

This is where the model needs more rigour before fundraising. Sketched here:

* **Stablecoin yield. Net zero or negative on Earn rebate** if Navi yields compress.
* **Sponsor gas.** Sui mainnet fees are low (sub-cent per transaction). At 100k sends/day at $0.005 average, that is $500/day or $182k/year. Negligible at the unit level.
* **Off-ramp partner fees.** Flutterwave, M-Pesa, Paystack take their own cut. The 50 bps quoted above is what Talise keeps after the partner is paid. Already net.
* **Infrastructure.** Vercel, Postgres, zkLogin prover. Today these are flat costs in the low five figures per month, scaling sublinearly. Largest line is the GPU prover at ~$317/month per L4 box. See `32-infra-gpu-prover.md`.
* **People.** Founders + early team. Not modelled here.
* **Acquisition.** Pre-launch is free (waitlist). Post-launch the cost-per-acquired-user (CAC) will dominate. A reasonable corridor user with $14/year of revenue cannot cost more than $30 to acquire on a 24-month payback.

## 6. Where the litepaper and landing currently overpromise

Reviewed against this document. Fix list:

* **Landing FinalCta** says "Send. Save. Earn. Always free." Strictly true only for Send. Tweak the tag to "Free transfers" or "Free to send" and add a single transparent line about how Talise earns. Done in this commit.
* **Landing FinalCta paragraph** says "No fine print." This is a stretch. The fine print is that auto-swap and off-ramp carry spreads. Soften.
* **Landing GaslessDeep** is fine. "Talise pays the network fee" is literally true.
* **Litepaper §3 (or wherever it discusses fees)** should add a section: "How Talise earns" with the four lines from section 3 above, condensed. Do not bury it.
* **Earn UI** must label the displayed APY as the user's APY, not the protocol APY. Today it shows the Navi rate raw; the moment we start taking a rebate it must say "X% APY (Talise)" or similar.

## 7. Decision points open

The following are unsettled and need an explicit founder call:

1. **What spread on auto-swap?** Defaulting to 30 bps in this doc; could be 20, 50, or dynamic. Lower is more competitive, higher is more revenue. Settle at 30, ship, watch retention, adjust.
2. **What spread on off-ramp?** Defaulting to 50 bps. Compare against Wise's headline rate on the same corridor before launch; Talise should be at or under.
3. **What yield rebate?** Defaulting to 100 bps. Lower if user retention is yield-sensitive.
4. **Is the on-ramp margin worth the Stripe-ToS check?** Probably yes, but get the answer in writing before assuming the line item exists.
5. **When do we ship the off-ramp?** Today there is no payout partner. This is the largest revenue line and the biggest gap.
6. **Disclosure level.** Two valid stances: (a) bury the spreads in a small "How we earn" line on the landing and a paragraph in the litepaper, (b) lean in and make transparency a feature (live mid-price comparison in the receipt). Lean toward (b) once the spreads are dialed in; it differentiates against Wise, which famously hid spreads for years before becoming "transparent" as a marketing move.

### Spreads (config-only, not wired)

| Constant | Value (bps) | Location | Wired into flows |
| -------- | ----------- | -------- | ---------------- |
| `autoSwapSpreadBps`, `offRampSpreadBps`, `yieldRebateBps` | 30 / 50 / 100 | `web/lib/economics.ts` (`ECONOMICS`) | No. Constants only; no behavior change yet. Wire-up tracked separately. |

## 8. What this document is not

* Not a financial model. Numbers are illustrative. Plug into a spreadsheet for real planning.
* Not legal advice. Off-ramp regulation per corridor is the most expensive open question.
* Not a fundraising deck. Lift the unit economics and the four revenue streams; everything else lives here as background.

## 9. Open questions for the team

* Is the 30 bps default on auto-swap competitive? Compare against (a) the spread baked into Sui's native bridges, (b) Cetus's own slippage tolerance defaults.
* Does the iOS app surface the realised vs. quoted price on the receipt? If yes, the user can in principle reverse-engineer the spread. If no, add it as a transparency feature, not a bug.
* When do we publish this document? Two answers: never (internal), or with the litepaper at launch (public). The honest case for "with the litepaper" is that the African remittance audience is unusually price-sensitive and will respect explicit numbers more than hand-wavy "free."
