# Talise mobile (React Native) — porting plan

Rebuild of the Talise app in **Expo (SDK 57) + expo-router**, Android-first.
Ported screen-for-screen from the native iOS app (`../ios/Talise`). The native
`ios/` and `android/` apps stay live until this reaches parity.

## Source of truth

The iOS app has **78 screens across 18 feature modules**. Each screen here is a
1:1 port of its SwiftUI counterpart — same layout, same API calls, same design
tokens (`src/design/tokens.ts` mirrors `ios/.../DesignSystem/Tokens.swift`).

## Foundation (done)

- Expo SDK 57 + expo-router, dark-only, `io.talise.app`, `talise://` + applinks.
- Design system: `src/design/tokens.ts`, `typography.ts`, `components/Screen.tsx`.
- Navigation: custom **pill tab bar** (`src/components/PillTabBar.tsx`) over the
  four tabs — Home · Finance · Rewards · Profile (`src/app/(tabs)/`).
- API client skeleton: `src/api/client.ts` (base `app.talise.io`, bearer +
  `X-App-Attest`, 5xx retry) — mirrors iOS `Network/APIClient.swift`.
- **Home** screen built (`src/app/(tabs)/index.tsx`); other tabs are shells.

## Phases (remaining)

**P1 — Infra & auth (unblocks everything real)**
zkLogin (Google/Apple, server-mediated) · secure session (expo-secure-store) ·
PIN gate + biometrics (expo-local-authentication) · App Attest · APNs/FCM push ·
deep-link router. Then wire the API services (wallet, activity, me).

**P2 — Core wallet (13 screens)**
Home (real data) · History · TxReceipt · TokenBucket · CurrencyPockets ·
Deposit · Withdraw hub · Receive · Scan-to-pay + bank payout + confirm.

**P3 — Send & cross-border (14 screens)**
Send: Amount → Recipient → SendToBank → Review → InProgress → Complete/Failure.
Cross-border: Recipient → Amount → Review → Sending → Complete/Failure. Shared
`SuccessfulTxView`-style result screen.

**P4 — Onboarding/auth screens (13 screens)**
Splash · Welcome · SignIn · HandlePicker · PinSetup · Permissions · KycTier ·
BankLink · Completed · KYC · PinCreate · PinUnlock · WelcomeBack.

**P5 — Finance (Earn + Perps + Goals/Rewards) (13 screens)**
EarnView · EarnManage · SavingsSuccess · Trade (perps chart) · OrderSheet ·
PnLShare · RewardsView · NewGoal · GoalAction · GoalSuccess.

**P6 — Money tools (17 screens)**
Cheques (4) · Streams (2) · Invoices (3) · Contracts (2) · Requests (2) ·
Rules (2) · Ramps: Onramp/Cashout/Corridor (3 — partly in P2).

**P7 — Profile & business (5 + Payroll 4)**
Profile · IdentityVerification · BankAccounts · ClaimHandle · RetargetHandle ·
ChangePin · Payroll (Teams · TeamEdit · PayTeam · TeamStream).

**P8 — Copilot / AI (3, off-nav)**
Chat · ChatHistory · AgentReceipt.

## Conventions

- Money flows are **pushed routes on the root Stack** (iOS dispatches them as
  modal covers via NotificationCenter; expo-router `router.push` replaces that).
- Every screen wraps in `<Screen>`; use tokens, never ad-hoc hex.
- Each feature area gets a typed API service in `src/api/` returning the same
  DTOs the web/iOS clients use.
