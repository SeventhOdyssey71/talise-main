# Talise — Hackathon & Product Workplan
*Source of truth for the planner-auditor + per-plan implementation agents.*

**Context recap (so agents read cold):**
- Sui Overflow 2026, DeFi & Payments track, prizes $30k/$15k/$10k/$7.5k. Sponsors OpenZeppelin (1st) + OtterSec (3rd) — security narrative weighted heavily.
- Talise = consumer payments app on Sui, African corridor focus. Working: zkLogin (Shinami), sponsored gas (Onara), USDsui native stablecoin, NAVI 5.18% supply, SuiNS subnames, Payment Kit receipts wired (commit-pending).
- iOS app (SwiftUI 17+, CryptoKit, App Attest), Next.js 15 backend on Vercel, sponsored via Onara workers.

**Files-disjoint test for parallel-safe execution:**
- Send flow → `ios/Talise/Features/Send/**` only
- Onboarding → `ios/Talise/Features/Onboarding/**` (new) + `ios/Talise/App/AppRoot.swift` (1-line addition)
- AI chat → `ios/Talise/Features/Chat/**` (new) + `web/app/api/chat/**` (new)
- KYC backend → `web/app/api/kyc/**` (new) + `web/lib/db.ts` (schema)
- Activity classifier → `web/lib/activity.ts` (single file)
- Docs → `README.md` + `THREAT_MODEL.md` (new)

---

## STRATEGIC PLANS (1-8) — direction, not code

### Plan 1 — "Africa Dollar Bank" (focused remittance vertical)
NGN ↔ USDsui ↔ NGN corridor. Phone-number recipient onboarding. KYC-tiered limits. Yellow Card off-ramp. **Narrative win:** Wise/Cash App for the African diaspora.

### Plan 2 — "Payment Kit fully realized" (protocol reference impl)
Universal PK wrapper across every PTB Talise builds. Activity classifier reads PK PaymentRecords as authoritative. Reader SDK `@talise/receipts` on npm. **In progress** — wrapper landed for send/invest/withdraw; activity classifier rewrite is the next slice.

### Plan 3 — "Yield by default" (DeFi-first product story)
Auto-supply USDsui above a $5 buffer to NAVI. Yield ledger with daily P&L. Pre-warm liquidity for instant withdraw. Circuit breakers per venue.

### Plan 4 — "Agent-ready rails" (2026 AI narrative)
MCP server exposing `pay`, `request_payment`, `get_balance`. On-chain spend-policy NFTs gate every agent call. Per-key delegation revocable in iOS.

### Plan 5 — "Composed hackathon submission" (recommended)
Plan 1 as narrative + Plan 2 as technical foundation + Plan 3 as differentiator + Plan 4 as closing flourish. Single 3-min demo, two-layer technical depth.

### Plan 6 — "Compliance-first" (the regulatory moat)
KYC tiers as a *feature*, not a chore. Free $100/day, Verified $5k/day, Pro $50k/day. Sumsub SDK in iOS. Tier-aware send rejections with "Upgrade" CTA. The fact that Talise is the only Sui app with a real compliance posture becomes the OpenZeppelin pitch.

### Plan 7 — "Social payments" (viral mechanics)
Split bills with multi-recipient PTBs (PK marks each leg). Payment requests via shareable links. Group savings pools as shared objects with member caps. Friend graph from on-chain counterparties.

### Plan 8 — "Merchant mode" (B2B leg)
USDsui invoice issuing + POS via QR. Subscription receivers (recurring PK records). Per-merchant registry under the global namespace. Withdrawals through AdminCap.

---

## IMPLEMENTATION SLICES (9-20) — concrete, narrow, parallelizable

### Plan 9 — Send flow redesign (multi-page NavigationStack)
**Path:** `ios/Talise/Features/Send/**`
Replace the single-screen sheet with a 5-step flow:
1. `SendAmountView` — full-page custom numpad, big amount in display currency
2. `SendRecipientView` — full-page input + recent-contacts list
3. `SendReviewView` — "Sending privately" with from/to glass cards
4. `SendInProgressView` — animated paperplane Shape
5. `SendCompleteView` — animated checkmark, "Sent" success state

State machine: `enum SendStep { amount, recipient, review, sending, complete }` with shared `SendDraft` model. Backend untouched — same `/api/send/prepare` + sponsor-execute.

### Plan 10 — Onboarding flow skeleton
**Path:** `ios/Talise/Features/Onboarding/**` (new) + 1 line in `AppRoot.swift`
Pages: Splash → Welcome (dark-green-disc logo hero) → Brand intro carousel (3 placeholder slides) → Continue with Google → KYC tier picker → Done.
Higgsfield-generated illustrations slot in later — leave a `Image("OnboardingHero_1")` placeholder asset entry per slide.

### Plan 11 — KYC backend (tier column + Sumsub webhook)
**Path:** `web/lib/db.ts` (schema) + `web/app/api/kyc/**` (new) + `web/lib/sumsub.ts` (new)
- `users.kyc_tier` column: `free` (default) | `verified` | `pro` | `pending`
- `users.daily_limit_usd` derived view
- `/api/kyc/start` → returns Sumsub access token
- `/api/kyc/sumsub/webhook` → HMAC-verified status updates
- `/api/send/prepare` adds tier check: reject `amount > daily_limit_usd` with `{ error, code: "tier_limit_exceeded", currentTier, dailyLimit }`

### Plan 12 — AI finance chat tab (5th nav slot)
**Path:** `ios/Talise/Features/Chat/**` (new) + `web/app/api/chat/**` (new)
- iOS: `ChatTabView` with greeting, suggested prompts, SSE-driven conversation history
- Bottom nav reordered: `Home · Invest · **Chat** · Rewards · Profile`
- Backend: `/api/chat/stream` — Anthropic via [Vercel AI Gateway](https://vercel.com/docs/ai-gateway), `claude-sonnet-4-6`, tool use: `get_balance`, `list_recent_txs`, `get_yields`, `simulate_supply`
- System prompt: finance-savvy assistant, uses tools to ground in actual numbers, refuses tax/legal advice

### Plan 13 — Activity classifier rewrite (PK PaymentRecord lookup)
**Path:** `web/lib/activity.ts` (single file)
For each tx, look up its `PaymentRecord` under the talise registry via `objectChanges`. Parse the compact nonce (`t1<kind1><ts8><rand4><sender6><receiver6>[refs]`) for authoritative kind/venue. Heuristic stays as fallback for pre-PK txs.

### Plan 14 — Stripe Onramp bridge (bearer→cookie handoff)
**Path:** `web/app/api/onramp/**` (new) + iOS deposit button rewire
- `/api/onramp/session` — mints a one-time signed handoff JWT, opens Safari `https://buy.stripe.com/...?session=<jwt>` with proper redirect back to `talise://onramp/return`
- Stripe webhook → credit user USDsui via sponsored swap from settled USDC

### Plan 15 — Yellow Card off-ramp (sandbox integration)
**Path:** `web/app/api/offramp/**` (new) + `web/lib/yellowcard.ts` (new)
- `/api/offramp/quote` — locked NGN rate, 30s TTL
- `/api/offramp/execute` — settle USDsui → NGN payout via Yellow Card sandbox
- Production-gated behind `OFFRAMP_PROVIDER_ENABLED=false` flag until corporate KYC closes

### Plan 16 — Yield router + auto-supply hook
**Path:** `web/lib/yield/router.ts` (new) + `web/lib/yield/auto-supply.ts` (new) + `web/app/api/keeper/auto-supply/route.ts` (new)
- Risk-adjusted APY ranking (NAVI vs Suilend vs DeepBook), pulls safety from DefiLlama
- Hook on received tx > $5: sponsored PTB supplies to router's pick
- Idempotency keys on `auto_supply_actions` table

### Plan 17 — Move contracts: SpendPolicy + Escrow
**Path:** `move/talise/sources/policy.move` + `move/talise/sources/escrow.move` (new)
- `SpendPolicy { owner, max_per_day, max_per_tx, allowlist, blocklist, expires_at }` — agent-pay gate
- `Hold { sender, receiver, amount, release_at, dispute_window_ms }` — escrow for big sends
- Sui Move Analyzer pass + OpenZeppelin Sui pattern citations

### Plan 18 — Move contracts: RecurringSchedule + SplitBill
**Path:** `move/talise/sources/recurring.move` + `move/talise/sources/split.move` (new)
- `Schedule { owner, recipient, amount, interval_ms, next_run_ms }` + keeper API
- `Bill { creator, total, shares: vector<Share { addr, bps }> }` + atomic settle

### Plan 19 — Threat model + audit storytelling
**Path:** `README.md` (rewrite security section) + `THREAT_MODEL.md` (new)
Sections: trust boundaries, abuse vectors, mitigations table, key rotation policy, JWT nonce binding diagram, App Attest cert chain note, TLS pinning roadmap, sponsor policy enforcement, Move Analyzer clean-pass evidence.

### Plan 20 — Demo recording + 1-page submission doc
**Path:** `demo/SUBMISSION.md` (new) + `demo/script.md` (new) + `demo/RECORDING.md`
3-min walkthrough script keyed to Plan 5 (composed submission). Architecture diagram, problem statement, security claims summary, "what's next" roadmap. Ready for HackerEarth upload.
