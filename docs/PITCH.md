# Talise — pitch

## One-liner

**Talise is programmable money on Sui. Every dollar earns by default. Every payment is one atomic PTB. An agent compiles your intent into bounded policy.**

## 30-second elevator

Your bank pays 0%. Your savings app pays 4% but can't send money. Your wallet sends money but the balance sits idle. Talise solves all three: it's a wallet where every dollar is earning DeepBook Margin yield, every send is an atomic Move PTB, and you can save in USDC, BTC, or gold — all in one account.

## 5-slide deck outline

### Slide 1 — Title
**Talise**
Programmable money on Sui.
[hero asset image — gold coins / stylized water motif]

### Slide 2 — The problem (the brief's words)
> "Payments are static transfers. DeFi is complex and siloed. Users must manually orchestrate everything."

Today: your money sits idle while you swap apps to earn yield, send, save. Three apps for what should be one.

### Slide 3 — The product
**One account. Many assets. All earning. All composable.**

Three screen shots:
- Home — total balance + asset cards (USDC, BTC, ETH, SUI, XAUM)
- Send — atomic any-to-any with cross-asset routing via DeepBook
- Agent chat — "save 15% of every paycheck into rent bucket"

### Slide 4 — How it works (the killer PTB)
The headline: **one signature, one block, five Move calls**

```
margin::withdraw_quote(...)
deepbook::spot::swap(...)
transfer::public_transfer(...)
receipt::mint_with_conversion(...)
```

Suiscan screenshot of the actual tx.

### Slide 5 — Why now / why Talise / why this track
- Q1 2026: tokenized gold did $90.7B in volume. Silver perps up 400%.
- zkLogin removed wallet onboarding friction (Google sign-in, no seed phrase)
- DeepBook Margin + DeepBook Spot composes payments and yield in one PTB
- Talise hits 4 of 5 idea-bank categories in the DeFi & Payments brief

## Quotable bullets

- "A payment that automatically invests." — every incoming dollar enters DeepBook Margin in the same PTB
- "A salary that streams and earns yield." — Talise recurring payments draw from a yield-bearing position
- "A wallet that intelligently routes funds." — cross-asset send routes via DeepBook Spot in one tx
- "Programmable money." — the brief's exact phrase

## Distribution / X bio

> Programmable money on @SuiNetwork. Earns by default. Pays atomically. Routes intelligently.

## Pinned tweet

> Talise hits the @SuiNetwork Overflow DeFi & Payments track.
> Every dollar earns DeepBook Margin yield by default.
> Every payment is one atomic Move PTB.
> An agent compiles intent into bounded on-chain policy.
> Money that flows. Money that grows. One account.
