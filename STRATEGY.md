# Talise — Consumer strategy

> The killer wedge: **Africans lose money every day they hold local currency. We let them save and spend in dollars without ever touching a US bank, a seed phrase, or a 7% remittance fee.**

Powered by Sui's 400ms finality + sponsored gas + Payment Intents, so the user never sees blockchain.

---

## The market is already here. We're not creating demand.

| What | Number | Source |
|---|---|---|
| Africa on-chain crypto volume, 12 months | $205B (+52% YoY) | Chainalysis 2025 |
| Stablecoin share of Sub-Saharan Africa flow | 43% | Chainalysis |
| Nigeria crypto value received | $92.1B / yr | Chainalysis (3x next country) |
| Nigerians already holding stablecoins | 79% of crypto-active | Various surveys |
| Naira lost vs USD past decade | ~70% | Investing.com / IMF |
| Nigeria inflation rate 2026 | 15–30% | CBN data |
| Western Union remittance fee | 6.4% avg | World Bank |
| Diaspora remittance to Nigeria | $21B / yr | World Bank 2024 |
| New CBN naira-only IMTO rule (May 2026) | Slower, partial payouts | weetracker.com |
| Proposed US 5% diaspora tax | Pending bill | Vanguard 2025 |

**Translation:** the demand is mainstream, the rails are broken, and the regulatory environment is making them worse. Stablecoins are already the workaround. We're the consumer interface that makes them feel like a bank app.

---

## The seven killer use cases (each is one payment intent)

### 1. **"Dollar Savings" — kill naira inflation, in two taps.**

**Pain.** A Lagos nurse earns ₦300,000/month. Inflation eats ~2% per month. She can't legally open a USD bank account in Nigeria. The legal CBN-approved domiciliary accounts require a $10k minimum that she doesn't have. Her ₦100,000 in the bank quietly becomes ₦75,000 of purchasing power over a year.

**The intent.** `depositAutosplitIntent` on every inbound naira payroll. Default: keep 30% liquid in ₦, auto-convert 70% to USDC, deposit into DeepBook Margin USDC pool at ~6–8% APY. Single sponsored signature on payday.

**The promise.** "You earn ₦300,000. We make sure it's still worth ₦300,000 a year from now. Plus 8%."

**Sui edge.** Atomic on-chain conversion + supply in one PTB. No exchange account. No KYC nightmare. Sub-second.

**Moat.** Off-ramp partner depth (Yellow Card, Flutterwave) and the savings-product wrapper. The "₦ in, $ saved" framing is the brand.

---

### 2. **"Send money home — and protect mom from devaluation."**

**Pain.** Nigerian nurse in London sends £100/month. Western Union takes ~£6.50. Sometimes the new May-2026 CBN rule means mom gets paid 6 hours late or partially. The naira she receives may have devalued 4% by the time she actually spends it.

**The intent.** `remittanceIntent` — bundles platform fee (1%) + atomic settlement to a Sui address that off-ramps to mom's mobile money. Optional **"freeze the FX rate for 30 days"** leg: a small Move-deployed put-option that pays mom an extra $20 if the naira drops >5% by the end of the month. The intent shows mom's payout in ₦, locks the rate, and routes the hedge premium into a managed vault.

**The promise.** "Send £100, mom receives ₦210,000 in 2 seconds. If naira drops, we top her up. £1 flat fee, no markups."

**Sui edge.** Hedge instrument and settlement compose into one signed PTB. The diaspora worker sees the math, signs once. Bytes are the contract.

**Moat.** Hedge product is unique to programmable money. Western Union literally cannot offer this.

---

### 3. **"Ajo / Chama — but your money grows and nobody runs off."**

**Pain.** Rotating savings circles (Ajo in Nigeria, Chama in Kenya, Susu in Ghana, Stokvel in SA) move billions informally. Trust is fragile — 1 in 8 collapses because someone runs off with the pot.

**The intent.** Move-deployed `Ajo` shared object. Members deposit USDC monthly via sponsored signature. Smart contract enforces rotation. Pot earns 6–8% APY in DeepBook Margin while it waits. Late members literally collect MORE than they contributed.

**The promise.** "Same Ajo your grandma ran, but unbreakable. And the last in the rotation gets ₦8,500 bonus."

**Sui edge.** Programmable yield + auto-rotation + on-chain payout proofs.

**Moat.** Cultural product. Western fintechs don't understand Ajo. Incumbents (M-Pesa, Opay) haven't built it. Network effects scale per-circle (12 friends × N circles).

---

### 4. **"Stripe Atlas, killed. Get paid USD in your M-Pesa in 6 seconds."**

**Pain.** A Kenyan developer wants $5,000 from a US client. Options:
- **Stripe Atlas**: $500 upfront LLC + Form 1120 + 3% fees. Months to set up.
- **Wise/Payoneer**: 2–3% FX cut. 3–5 days.
- **P2P stablecoin trader**: sketchy escrow, 1–2% spread, manual.

**The intent.** Talise invoice link. Client pays with card or USDC. PTB bundles: charge fee 0.5% + settle USDC to freelancer Sui address + auto-off-ramp via Kotani Pay/M-Pesa partner + mint a receipt NFT (the invoice's proof of paid). End-to-end ~6 seconds.

**The promise.** "Same checkout your client uses on Amazon. You see KSh land in your M-Pesa before the page reloads. No LLC, no Stripe, no escrow."

**Sui edge.** Card-in → USDC settlement → KSh-out is one PTB once the on-ramp/off-ramp are wired. Receipt NFT is the legal artifact.

**Moat.** Off-ramp depth + receipt-as-invoice format that becomes the African freelancer standard.

---

### 5. **"Free QR payments for any merchant. Yes, free."**

**Pain.** Nairobi street vendor pays 0.5% (capped KSh 200) per M-Pesa Buy Goods tx. Plus 2-day settlement to bank. Card terminals cost $100+ and require ≥3G internet.

**The intent.** Vendor signs up, gets a printable QR sticker. Customer scans → pays in USDC (or M-Pesa via on-ramp). PTB transfers to vendor's wallet. Vendor's balance shows in KSh. Withdrawal: free, instant.

**The economics.** 0% fee on first $1,000/month/merchant. 0.3% above. We're not sustained by fees — we earn the **float**: vendor balances sit in DeepBook Margin earning 6–8% until withdrawn. At 5 days average hold + $1B annual throughput at 1.5% net yield = $200K/yr per $1B.

**The promise.** "Sell a chapati. Get paid in 400ms. Lose ₦0 to fees. Withdraw whenever."

**Sui edge.** Sponsored gas means the customer doesn't need SUI. zkLogin means the vendor doesn't install anything.

**Moat.** Merchant network density per city + the float-yield revenue model lets us undercut anyone forever.

---

### 6. **"Salary that streams by the second and earns while it flows."**

**Pain.** Nigerian SaaS engineer earns $4,000/month from US client. Lands in his Nigerian bank monthly. Inflation eats 2% before he can deploy it. Plus he can't move large sums into USD legally without paperwork.

**The intent.** Employer funds $4,000 to Talise on the 1st. A `RecurringStream` Move object releases ~$133/day, $5.55/hour, automatically via Sui Clock-tick. Each release auto-deposits into the engineer's yield vault. Engineer sees: "$2,847 streamed, $1,153 incoming, $193 earned this month."

**The promise.** "Get paid every second you work. Earn 8% on every dollar that lands."

**Sui edge.** The Sablier-style stream + yield-on-arrival as one composed PTB. Cheap enough on Sui that hourly ticks are economical (would cost more in gas than the tick on Ethereum).

**Moat.** First-mover on Sui-native streaming + yield. Deel's product is a feature; we make it the default.

---

### 7. **"Pay all your foreign subscriptions in USDC. Save ₦35,000/month."**

**Pain.** Nigerian saving for Netflix (₦4,400 nominal but actually ~₦5,500 with FX markup), Spotify ($10 = ₦16,000 via naira card), ChatGPT ($20 = ₦32,000), Notion ($8). A $50/month subscription stack becomes ~₦100,000 because of card FX markup + international tx fees + occasional declines. Plus the embarrassment of telling the team "my card got declined again."

**The intent.** `billBatchIntent` runs on the 1st. Talise holds the user's USDC stash. PTB pays Netflix, Spotify, ChatGPT, Notion via mid-market USDC rails (we partner with the merchants directly, OR use the user's prepaid USDC card). No card decline. No FX markup.

**The promise.** "Pay your subscriptions in dollars at the dollar price. We saved you ₦35,000 last month."

**Sui edge.** One sponsored signature pays N subscriptions atomically. If one merchant rejects, all of them retry seamlessly.

**Moat.** Merchant partnerships + the "we saved you X" framing is the retention loop.

---

## What we ship for the hackathon (4 days left)

Stack-ranked. We ship 1–3 polished. 4–7 are the v2 roadmap on the pitch deck.

| # | Build target | Status | Days |
|---|---|---|---|
| 1 | Dollar Savings flow (autosplit + vault) | `depositAutosplitIntent` ready in `lib/intents.ts`. Need: UI page + onboarding "set your split" + balance card showing yield earned. | 1.5 |
| 2 | Send money home (remittance intent w/ ₦ display) | `remittanceIntent` ready. Need: Send page rewrite with country picker + ₦ amount preview + recipient as phone number stub. | 1 |
| 3 | Ajo on-chain (basic circle) | Need: Move module (`ajo.move` — circle/deposit/rotate) + simple page (create circle, invite, deposit, see position). | 1.5 |
| 4 | Hero PTB receipt + Suiscan screenshots | Hero artifact for pitch deck. | 0.5 |
| 5 | Demo video (90s) | Show all three flows. | 0.5 |

**Cut from hackathon scope** (named on pitch deck as roadmap):
- FX hedge product (#2's optional leg)
- Free QR for merchants (#5) — needs a partnership story
- Streaming salary (#6) — needs Move RecurringStream
- Subscription paying (#7) — needs merchant partnerships
- Stripe-killer invoicing (#4) — needs off-ramp deal

---

## What makes this a real consumer product (not another DeFi toy)

| Principle | How we enforce it |
|---|---|
| Never say "wallet", "crypto", "blockchain", "gas", "Sui" | Already done. Landing copy: 0 mentions. |
| Local currency primary, USDC is plumbing | `lib/fx.ts` ships ₦/KES/GHS/ZAR. Balance card leads with ₦. |
| Sponsored gas everywhere | `lib/sponsor.ts` ships. Sponsor wallet funded. |
| 2-tap onboarding | Google sign-in → set split percentage → done. |
| Compliance from day one | KYC tier 1 via Google email + later device check for >$1K/mo flows. Sanctions screen via Chainalysis API. |
| Off-ramp depth = real moat | Partnerships with Yellow Card (NGN), Flutterwave (NGN/GHS), Kotani Pay (KES), Onafriq (multi-country). All on-chain settlement, fiat last mile. |

---

## Why this wins the Sui Overflow track

The Sui Overflow brief lists three killer examples: *payments that auto-invest*, *salaries that stream and earn yield*, *wallets that intelligently route funds*. **All three are in our seven use cases.** They're not riffs on the brief — they're literal:

- **Auto-invest** = Dollar Savings flow (#1)
- **Stream + yield** = Salary streaming (#6)
- **Intelligent routing** = the Payment Intents abstraction itself

And we wrap it in a story judges have never heard at a Web3 conference: **"This is for Mama Adaeze."**

---

## Sources

- [Chainalysis — Sub-Saharan Africa crypto adoption 2025](https://www.chainalysis.com/blog/subsaharan-africa-crypto-adoption-2025/)
- [Sui Payment Intents docs](https://docs.sui.io/onchain-finance/payment-intents)
- [weetracker — Nigeria naira-only IMTO rule May 2026](https://weetracker.com/2026/05/04/nigeria-naira-remittance-new-rule/)
- [Vanguard — US 5% diaspora tax bill](https://www.vanguardngr.com/2025/05/nigerias-fx-inflow-under-threat-as-us-mulls-5-tax-on-diaspora-remittances/)
- [Investing.com — African currencies 2026](https://www.investing.com/analysis/african-currencies-in-2026-where-stability-is-returning-and-why-it-matters-to-you-200673836)
- [Brookings — Remittances to Africa](https://www.brookings.edu/articles/keep-remittances-flowing-to-africa/)
- [M-Pesa 2026 tariffs](https://pesatrail.com/mpesa-charges-2026.html)
- [African Freelancers — Stablecoin payouts](https://www.africanfreelancers.com/2026/03/how-african-freelancers-use-stablecoins-to-get-paid-without-paypal/)
