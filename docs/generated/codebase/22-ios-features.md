# 22. iOS Features

A tour of each feature module under `ios/Talise/Features/`. For every screen: what the user sees, key views, the data model, and the backend routes it touches. Sponsored signing always means `ZkLoginCoordinator.signAndSubmit(transactionKindB64:intent:rewards:)`.

## Onboarding

Folder: `Features/Onboarding/`.

State machine in `OnboardingRoot.swift:15`:

```
enum OnboardingStep { splash, welcome, intro1, intro2, intro3, signIn, kycTier, done }
```

- `SplashView` (~auto-advance to welcome).
- `WelcomeView` then `BrandIntroCarousel` (three slides, swipeable; the binding writes back to `step`).
- `SignInScreen` calls `ZkLoginCoordinator.shared.signIn()` and on success holds the returned `UserDTO` in `signedInUser`.
- `KycTierPicker` persists the choice into `UserDefaults` (`talise.kyc_tier = "free"`) and posts `io.talise.onboardingCompleted`.
- `OnboardingCompletedView.onDismiss → finish()` calls `session.handleSignedIn(user:)` so the phase machine moves to `.ready` or `.onboarding(user)`.

`KYCView` (`Features/KYC/KYCView.swift`) handles the country + account-type leg when `user.accountType == nil`.

## Home

Folder: `Features/Home/`. Main entry: `HomeView` (1003 lines).

What renders, top to bottom:

1. **Top bar** (`HomeView.swift:107`): brand mark + Contacts glyph (opens `ContactsSheet`).
2. **Balance block** (`:143`): big `$X.XX` rendered in the user's display currency via `TaliseFormat.local2(balance.usdsui)`, with a `0.05 USDsui` sub-line, the "Earn up to 11%" green nudge, and action buttons (Convert all, +, Move to wallet, Send).
3. **Sweep banner** (`:609`): only when `/api/sweep/prepare {action:"preview"}` returns `eligible: true`. Tap → confirm alert → `/api/sweep/prepare {action:"execute"}` returns a Cetus router PTB → sign + sponsor-execute.
4. **AutoSwapMigrationBanner** (`Features/Home/AutoSwapMigrationBanner.swift`): drives `/api/vault/migration-status`.
5. **Username card** (`:259`): shows `displayHandle()` from `UserDTO` or a "Claim your name" CTA that posts `taliseRequestClaimSheet`.
6. **Activity card** (`:353`): top 4 of `/api/activity?limit=20`, each row a `HistoryRow`. "See all" opens `HistoryView` (full feed with filters).

`HomeView` posts and listens on `NotificationCenter`:

- Listens on `taliseTxCompleted` (a `TaliseTxEvent { digest, direction, amountUsdsui, counterparty?, counterpartyName?, venue? }`) and calls `applyOptimisticTx(_:)` (`:533`). That prepends a synthetic `ActivityEntryDTO` and adjusts `balance.usdsui` by `+/-amountUsdsui`, then schedules a 1.5s-delayed `loadAll(force: true)` to reconcile. This hides the 1-3s `suix_queryTransactionBlocks` indexing lag after a sponsor-execute lands.

### HistoryRow

`Features/Home/HistoryRow.swift`. Glass card with a directional tint applied while pressed. Categories: `sent | received | invest | withdraw | autoswap | neutral`. Auto-swap and DEX `swap` rows render two legs ("0.1 SUI → ₦139.59") rather than a debit/credit. Non-USDsui rows (WAL, USDC, USDT, ...) use `entry.otherCoin.displayAmount + symbol`.

### TxReceiptView

`Features/Home/TxReceiptView.swift`. Sheet opened from a row tap. Shows direction badge (sent/received/invest/withdraw), the big amount, a glass details card (To/From/Venue, Date, Network, Digest), and two actions: "View on Suiscan" (opens `https://suiscan.xyz/mainnet/tx/<digest>`) and "Copy digest" (UIPasteboard).

Two recent fixes worth flagging:

- **To/From label correctness** (`TxReceiptView.swift:172`). Previously hardcoded "From"; now switches on category so sent reads "To <recipient>", received reads "From <sender>", invest/withdraw reads "Venue <NAVI/DEEPBOOK>". Shipped as `c2b9b37`.
- **Persistent FX for amount conversion** (`TxReceiptView.swift:36`). On `.task` the view calls `CurrencySettings.shared.refresh()` if the persisted rate snapshot `isStale(ttlSec: 4h)`. The persisted snapshot in `UserDefaults` ensures cold-launch receipts render in the correct local currency without a flash of unconverted USD.

### VaultWithdrawSheet

`Features/Home/VaultWithdrawSheet.swift`. Reads `/api/vault/state`; user picks a coin balance and an amount; POSTs `/api/vault/withdraw` → sponsored sign + submit (the on-chain entry is `talise::vault::withdraw_and_send<T>`).

## Send

Folder: `Features/Send/`.

Two flows, gated by a compile-time switch in `SendView.swift:13`:

```swift
static let useNewSendFlow = true
```

- `LegacySendView` (`SendView.swift:113`): single-screen recipient field + amount field + button.
- `SendFlowView`: a `NavigationStack(path: [SendStep])` with five steps:

```swift
enum SendStep { case amount, recipient, review, sending, complete }
```

Shared mutable draft (`@Observable`):

```swift
final class SendDraft {
    var rawAmount: String
    var recipientInput: String
    var resolved: RecipientResolution?
    var currency: TaliseCurrency
    var amountUsdsui: Double
    var success: SendSuccess?
    var errorMessage: String?
    var previousSendsToRecipient: Int?
}
```

Step responsibilities:

- `SendAmountView` — numpad + amount entry in display currency.
- `SendRecipientView` — accepts a Talise handle (`alice`), full SuiNS (`alice.sui`, `alice@talise.sui`), or `0x...` address. Resolves via `GET /api/recipient/resolve?q=...` with a 250ms debounce.
- `SendReviewView` — confirmation. Converts `rawAmount` from `currency` to `amountUsdsui` via `CurrencySettings.convertToUsd`.
- `SendInProgressView` — back-button hidden during sponsor-execute.
- `SendCompleteView` — success / error.

`SendFlowView.confirm()` (`SendFlowView.swift:98`):

```
POST /api/send/prepare { to, amount, asset: "USDsui" } → BuildKindResponse { transactionKindB64, roundupUsd? }
ZkLoginCoordinator.signAndSubmit(
    transactionKindB64: built.transactionKindB64,
    intent: "Send <symbol><rawAmount>",
    rewards: RewardsMeta(kind: "send", amountUsd, venue: nil, roundupUsd: built.roundupUsd)
)
Post .taliseTxCompleted with TaliseTxEvent(direction: "sent", ...)
path = [.recipient, .review, .complete]   // replace, not push
```

Also, after `complete`, `SendFlowView` fires `VaultAPI.sweepNow()` as a fire-and-forget so any `name@talise` deposit is swept within seconds instead of waiting for the 60s Vercel cron.

`SendPaperPlane.swift` is the animated paperplane micro-illustration shown during sending.

## Receive

`Features/Receive/ReceiveView.swift` (200 lines). A QR card (220×220 on a white pad) encoding `sui:<address>`, the user's handle line (`displayHandle()` or short address), and two pill actions: Copy address (with a 1.5s "Copied" affordance) and Share (`UIActivityViewController` with the raw address). QR is generated with `CIFilter.qrCodeGenerator()` at 8x scale.

## Earn

Folder: `Features/Earn/`. Main entry: `EarnView` (865 lines).

Renders the venue comparison + a supply form + three money-management sections (Round-up, Goals, Insights) relocated from the Rewards tab.

**Top:**

- Header with the best venue's APY callout.
- Venue cards from `GET /api/yield/comparison → YieldComparison { venues: [YieldVenue], best }`. Each `YieldVenue` has `apy`, `supplied?`, `pendingRewards?`, `earned?`, `earningPerDay?`, `principalSupplied?`. DeepBook is filtered unless the user already has a position (`EarnView.swift:90`) because its USDsui margin pool sits near 0% utilization.
- Tap a card with a non-zero `supplied` to open `WithdrawSheet` (`EarnView.swift:475`).

**Supply card:**

- Amount input in the user's display currency (symbol prefix + `TextField` + currency code label).
- Earnings projection band (day / week / month / year) computed from `usd = convertToUsd(local) ; annual = usd * best.apy`. Formatted via `TaliseFormat.local(_)` so a Nigerian user sees ₦ earnings.
- `LiquidGlassButton` titled "Supply <amount> to <venue>". On tap:

```
POST /api/earn/supply/prepare { venue, amount: usd } → BuildKindResponse
signAndSubmit(intent: "Supply <symbol><local> to <venue>",
              rewards: RewardsMeta(kind: "invest", amountUsd: usd, venue: venue))
Post .taliseTxCompleted with TaliseTxEvent(direction: "invest", venue: venue)
```

### WithdrawSheet + dust-rounding-aware earned

`EarnView.swift:475`. Shows the position breakdown: `Supplied <principal>`, `Earned <yield-so-far>`, projected daily yield (prefers server `earningPerDay`, falls back to `supplied * apy / 365`). Two paths: "Withdraw all" (server marks the position fully closed) or partial-amount withdraw (USDsui input). The server's `earned` field (cumulative-yield = `currentValue - principalSupplied`) is dust-rounding aware (the math happens server-side from on-chain activity replay), so the iOS side just decodes the optional and renders.

### AutoSwap Settings

`Features/Earn/AutoSwapSettings.swift` (1043 lines) and `AutoSwapEnableSheet.swift` are the surface for the vault `AutoSwapCap<T>` lifecycle. Per source coin (`AutoSwapSourceCoin`: SUI / USDC / USDT, with decimals + isStable) the user can enable, pause, resume, disable, migrate (share user-owned cap), or upgrade v1 → v2 (per-day budget). All paths go through `VaultAPI.*` to fetch a PTB then sign + sponsor-execute. See `24-ios-networking-and-sui.md` for the typed API surface.

## Rewards

Folder: `Features/Rewards/`. Main entry: `RewardsView` (331 lines).

After the v2 reshuffle, Rewards is the points + perks hub:

- **Tier card**: badge + total points + progress to next tier. Tier data is server-computed (`summary.tier` from `/api/referral/summary`).
- **Lifetime stats row**: `lifetimeSentUsd`, `lifetimeSavedUsd` rendered in display currency.
- **Earn rules card**: from `summary.pointRates: PointRates { send, invest, withdraw, roundup, goal }`. Note `invest` was earlier named `save` in the JSON and silently fell back to hardcoded `3` (fixed; see `APIModels.swift:325`).
- **RedemptionsSection**: `GET /api/rewards/catalogue → RedemptionsCatalogue { pointsTotal, items: [RedeemSKU] }`. Each SKU has `canAfford`, `minTier`, `kind` (`"instant" | "flagged" | "pending"`). Redemption POSTs `/api/rewards/redeem { sku }` and refreshes the parent summary.
- **Referral card**.

The Round-up, Goals, and Insights sections moved to `EarnView` (`RoundupCard.swift`, `GoalsSection.swift`, `InsightsSection.swift`) because they semantically belong with money management.

## Profile

`Features/Profile/ProfileView.swift` (638 lines). Hierarchy: Hero (avatar + name + handle) → Stats strip (KYC tier × Rewards tier × member-since) → Wallet section (address + copy + Suiscan link) → Preferences (display currency picker, notify on receive, AutoSwap settings sheet entry) → Help → Sign out (destructive alert) → Version footer.

`ClaimHandleSheet` (`Features/Profile/ClaimHandleSheet.swift`, 385 lines) is the SuiNS handle minting flow. Checks availability via `GET /api/username/check?u=<input>` and mints via `POST /api/username/claim`. The recent App audit commit (`5421c4b`) made handle-claim race-safe so two parallel taps cannot mint conflicting subnames.

## Chat (hidden)

`Features/Chat/` is the AI finance assistant (`ChatTabView`, `ChatViewModel`, `ChatModels`, `ChatHistoryStore`). The comment at `AppRoot.swift:58` notes the tab was removed from the user-facing nav: the code stays so the slot can be re-added once Payment-Intent confirm cards, voice input, and grounding are ready.

## Cross-cutting notifications

| Name | Purpose |
|---|---|
| `taliseRequestSendSheet` | Home → MainTabView opens Send. |
| `taliseRequestReceiveSheet` | Home/+ button → MainTabView opens Receive. |
| `taliseRequestClaimSheet` | Home username card → MainTabView opens ClaimHandleSheet. |
| `taliseTxCompleted` (payload `TaliseTxEvent`) | Send/Earn/Sweep → HomeView optimistic update. |

The Send sheet bridges contact picking via `UserDefaults["io.talise.send.prefillRecipient"]` (set by ContactsSheet, read once and cleared by `LegacySendView.onAppear`).
