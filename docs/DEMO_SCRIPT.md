# Talise — 90-second demo script

Target: judges watching 80+ submissions back-to-back. Hook in 5 seconds.

## Shot list

### 0:00–0:05 — Title card
Black screen. Text fades in: **"Talise — Programmable money on Sui."** Cut.

### 0:05–0:15 — Cold open: the killer PTB
Suiscan transaction view fills the screen. Highlight five Move calls in sequence:
1. `margin::withdraw_quote`
2. `deepbook::spot::swap`
3. `transfer::public_transfer`
4. `receipt::mint_with_conversion`

Voiceover: *"This is one transaction. One signature. Your USDC withdrew from DeepBook Margin lending, swapped to SUI on the order book, sent to a friend, and minted a receipt — atomically. That's Talise."*

### 0:15–0:30 — Sign-in + Home
Cut to iPhone. Tap Talise icon. Tap "Continue with Google." Google chooser. JWT settles. Home screen renders:

- Big balance: **$1,247.50**
- Caption: *"+$0.18 today · earning 6.4% on DeepBook Margin"*
- Five asset cards: USDC, SUI, BTC, ETH, **Gold (XAUM)**

Voiceover: *"Sign in with Google. No seed phrase. No wallet install. Five assets. All earning."*

### 0:30–0:45 — Send: same-asset
Tap "Send." Recipient: `alice.sui`. Amount: $50. Asset: USDC. Confirm.

PTB sheet shows: "1. Withdraw $50 from DeepBook Margin · 2. Transfer to Alice · 3. Mint receipt." One tap to sign.

Cut to Suiscan tab — three Move calls in one tx. Receipt visible.

Voiceover: *"Send fifty dollars to Alice. The wallet pulls from your yield position, sends, mints a receipt. One signature."*

### 0:45–1:00 — Send: cross-asset (the hero shot)
Tap "Send." Recipient: `bob.sui`. Bob's profile chip: "Receives in: Gold (XAUM)." Amount: $50 USDC.

PTB sheet shows four calls: "Withdraw · Swap on DeepBook · Transfer XAUM · Mint receipt with conversion snapshot."

Sign. Suiscan opens. Order-book trade visible inside the tx.

Bob's wallet pings. Receipt NFT shows: *"Conversion: $50 USDC → 0.0241 oz gold @ $2,074/oz"*

Voiceover: *"Send Bob fifty dollars. Bob holds gold. One atomic transaction. The order book filled the swap. The receipt is permanent on-chain proof of the conversion rate."*

### 1:00–1:15 — Agent chat
Tap Agent tab. Type:

> "Save 10% of every payment I receive into a rent bucket. Cap the bucket at $2,000. Auto-pay rent of $1,500 on the 1st of every month."

Agent shows a planned PTB:
- Create `SavingsBucket { label: "Rent", inflow_pct: 10, cap: 2000 }`
- Create `Schedule { amount: 1500, cron: "0 9 1 * *", source: bucket }`

Confirm. Both objects mint.

Voiceover: *"Tell the agent what you want. It compiles your intent into bounded on-chain policy. You sign once. The schedule runs itself."*

### 1:15–1:25 — Earn tab
Tap Earn. Three tier cards: Conservative (6.4%), Balanced (11.2%), Aggressive (19.7%). Tap Balanced. Rebalance PTB previews: "Move 50% of USDC supply into DeepBook Spot LP."

Voiceover: *"Three yield tiers. Each maps to a different DeepBook strategy. Switch with one tap."*

### 1:25–1:30 — Close
Cut to the title card. Add tagline below:

**"Programmable money. Built on Sui. Composed in Move."**

Voiceover: *"Talise. Money that moves smarter."*

## Production notes

- Record on real testnet, real PTBs. No simulator fakes.
- Always show the Suiscan tab after each PTB. The atomic-multi-call screenshot is the entire pitch.
- Voiceover: friendly, deliberate, ~150 words/min. No crypto jargon beyond "PTB" and "DeepBook."
- Music: minimal. Maybe a single piano motif. Don't compete with the voiceover.
- Subtitles burned in (judges may watch muted).
- Save as `docs/demo.mp4`, 1080×1920 (vertical), under 60MB.

## Quotable lines for the script

These map directly to the brief's exemplars — judges will recognize them:

| Talise demo line | Brief exemplar |
|---|---|
| "Your USDC withdrew from DeepBook Margin lending, swapped to SUI..." | "A wallet that intelligently routes funds" |
| "The agent compiles your intent into bounded on-chain policy" | "Rule-based financial agents" |
| "Tell the agent: 'save 10% of every payment'" | "A payment that automatically invests" |
| "Schedule {amount: 1500, cron: '0 9 1 * *'}" | "A salary that streams and earns yield" (inverse) |

Land these phrases verbatim; judges will subconsciously check the box.
