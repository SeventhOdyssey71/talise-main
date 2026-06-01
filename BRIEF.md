# Sui Overflow 2026 — DeFi & Payments track (verbatim)

Source: `mystenlabs.notion.site/defi-payments-problem-statement` (fetched 2026-05-17)

> **⚠️ CORRECTED 2026-06-01.** The original logistics in this file were wrong. Verified live against
> the Notion problem statement + the Participant Handbook: the **submission deadline is June 21, 2026**
> (NOT May 23 — it has NOT passed), prize sponsors are NOT assigned per-place, and the scored rubric
> is the four weighted axes below (the "Strong/Top-tier project" bullets are guidance, not the rubric).
> See `docs/hackathon/HACKATHON-REVIEW.md` + `docs/hackathon/PLAN.md` for the current strategy.

## Programmable Money, Payments & Financial Systems on Sui

### Problem

Payments and DeFi today are disconnected:
- Payments are static transfers
- DeFi is complex and siloed
- Users must manually orchestrate everything

On Sui, this changes: **Payments can become programmable financial actions.**

Examples:
- A payment that automatically invests
- A salary that streams and earns yield
- A wallet that intelligently routes funds

### Overview

Sui introduces a fundamentally different model for building financial systems:
- Assets are objects, not just balances
- Transactions can bundle complex logic atomically (PTBs)
- Smart contracts (Move) enforce ownership and composability at the type level

Enables **programmable money** — where assets, logic, and flows are natively composable.

Track challenges: payment systems, financial workflows, capital management tools, user-facing financial products — all powered by Sui Move.

### What you're building

- Payment flows
- Wallets and financial interfaces
- Vaults and capital allocators
- Automation systems
- Financial abstractions for real users

### Building blocks (any combination)

1. **Sui Move** — object-based assets, strong ownership, type-safe financial logic
2. **PTBs** — bundle multiple actions atomically (e.g. pay → swap → deposit)
3. **Tokens & Assets** — fungible (stablecoins) + NFT/object-based (receipts, identity, tokenized positions)
4. **DeFi Protocols (Optional)** — lending, DEXs, yield. *"These are tools, not requirements."*

### Idea bank

- **Trust-Minimized Finance:** programmable loans, milestone-based escrow, payment-linked credit, treasury, novel prediction markets
- **Payments & Consumer Finance:** smart wallets w/ automation, merchant payments, subscriptions/streaming, payroll, privacy rails
- **Vaults & Capital Management:** yield vaults, automated savings, treasury, portfolio allocators
- **Financial Automation:** auto-investment bots, rebalancing, conditional payments, **rule-based financial agents**
- **Infrastructure & Tooling:** payment SDKs, flow visualizers, dashboards, Move debuggers

### What a STRONG project looks like

- Clear financial use case
- Correct handling of assets and ownership
- Working end-to-end integrations/flows
- Thoughtful abstraction for users

### What a TOP-TIER project looks like

- **Novel use of programmable transactions**
- **Strong composability across components**
- **Excellent UX for complex financial actions**
- **Real-world applicability**

### Submission types accepted

- Full-stack applications
- Smart contract systems (Move modules)
- Bots or automation services
- Developer tools

### Closing

> "Build something that makes money move smarter. Godspeed."

---

## Track logistics (corrected 2026-06-01 from the Participant Handbook)

| | |
|---|---|
| Prize pool (DeFi & Payments) | $62,500 |
| 1st / 2nd / 3rd / 4th | $30,000 / $15,000 / $10,000 / $7,500 |
| Prize sponsors | OpenZeppelin + OtterSec (**overall**, not per-place); Scallop (Award Sponsor); Walrus (Headline Partner) |
| Payout | 50% at winner announcement, 50% after **mainnet** deployment (100% upfront if on mainnet by August) |
| Building period | May 7 – June 21, 2026 |
| **Submission deadline** | **June 21, 2026 (Pacific)** |
| Shortlist announced | July 8, 2026 |
| Demo Day (shortlisted, live) | July 20–21, 2026 |
| Winners announced | August 27, 2026 |
| Submit via | DeepSurge portal (`deepsurge.xyz`) |

### Judging rubric (VERIFIED — weighted, from the Participant Handbook)

- **Real-World Application — 50%** — meaningful problem-solving, market relevance, long-term value
- **Product & UX — 20%** — quality, usability, polish
- **Technical Implementation — 20%** — technical quality, reliability, meaningful Sui integration
- **Presentation & Vision — 10%** — clarity, storytelling, long-term vision

> The "Strong project" / "Top-tier project" bullets above are descriptive guidance from the problem
> statement, NOT the scored rubric. The four weighted axes here are what's judged.

### Required deliverables

Public GitHub repo · ≤5-min demo video (YouTube) · deployment (testnet or mainnet) · Package ID ·
1:1 logo (JPG/PNG) · project name + description · website (optional). Submit via DeepSurge.
