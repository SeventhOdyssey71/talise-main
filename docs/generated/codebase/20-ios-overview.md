# 20. iOS Overview

A high-level map of the Talise iOS app: stack, layout, entry point, auth model, networking host, and the dark-mode-only stance.

## Stack

- **SwiftUI**, observable state (`@Observable`, the new macro-based observation model: see `App/AppSession.swift:8`).
- **CryptoKit** for Curve25519 keypair generation (no Secure Enclave: Sui zkLogin requires Ed25519, SE only supports P-256, and `SecKeyCreateRandomKey` is rejected on Simulator).
- **AuthenticationServices** (`ASWebAuthenticationSession`) for the OAuth handoff.
- **DeviceCheck** (`DCAppAttestService`) for hardware-attested request integrity.
- Custom **pure-Swift BLAKE2b-256** (no Apple framework provides it).
- Bundled assets: Google Sans variable font registered at launch (`Resources/GoogleSans`), DM Sans + JetBrains Mono families referenced by `TaliseFont` with SF Pro / SF Mono fallback.

The project targets recent iOS (uses `@Observable` macro and `NavigationStack(path:)`, both iOS 17+). Swift 5.9+.

## Top-level layout

```
ios/Talise/
  App/                  app lifecycle, session, config, currency
  Auth/                 zkLogin pipeline (Google, ephemeral key, sessions, App Attest)
  Sui/                  BLAKE2b, SuiAddress, asset decimals
  Network/              APIClient, APIError, APIModels (DTOs), WalletAPI, VaultAPI
  DesignSystem/         Tokens, Typography, TopGlow, TaliseFormat
    Components/         LiquidGlass* primitives + TaliseButton
  Features/
    Home/               HomeView, HistoryRow, HistoryView, TxReceiptView,
                        VaultWithdrawSheet, AutoSwapMigrationBanner
    Send/               SendView (legacy), SendFlowView, SendAmountView,
                        SendRecipientView, SendReviewView,
                        SendInProgressView, SendCompleteView, SendNumpad,
                        SendPaperPlane, SendSuccessView
    Receive/            ReceiveView (QR + share)
    Earn/               EarnView, AutoSwapSettings, AutoSwapEnableSheet
    Profile/            ProfileView, ClaimHandleSheet
    Onboarding/         OnboardingRoot, SplashView, WelcomeView,
                        BrandIntroCarousel, SignInScreen, KycTierPicker,
                        OnboardingCompletedView
    SignIn/             SignInView (legacy, post-onboarding flow)
    KYC/                KYCView (post-OAuth country + account type)
    Rewards/            RewardsView, GoalsSection, InsightsSection,
                        RedemptionsSection, RoundupCard
    Chat/               ChatTabView, ChatViewModel, ChatModels,
                        ChatHistoryStore (kept in tree, hidden from nav)
  Resources/            fonts, asset catalogs
```

Counts: 68 Swift files, ~12k LOC total.

## App entry point

`App/TaliseApp.swift:5` is the `@main`. On `init()` (DEBUG only) it:

1. `setenv("OS_ACTIVITY_MODE", "disable", 1)` to silence CFNetwork chatter before `URLSession` is touched.
2. Registers Google Sans Variable from the bundle.
3. Runs `Blake2b.runSelfTest()` and logs any divergence (a wrong digest means sponsor-execute would reject every signature: "Invalid signature was given to the function").

The scene wires `AppRoot` into the window, injects a shared `AppSession` via `.environment(session)`, kicks `session.bootstrap()` on appear, and applies a privacy lock overlay when `scenePhase` flips to background or inactive (`TaliseApp.swift:61`).

`AppRoot` (App/AppRoot.swift:5) is a phase switch. `AppSession.Phase` has five cases: `.launching`, `.signedOut`, `.onboarding(user)`, `.ready(user)`, `.locked`. The post-auth root is `MainTabView` with four tabs (home, invest, rewards, profile) and a floating Liquid Glass pill nav (`AppRoot.swift:147`). Send and Receive are not tabs: they are presented as `.fullScreenCover` and `.sheet` over the active tab, driven by Notification posts (`taliseRequestSendSheet`, `taliseRequestReceiveSheet`, `taliseRequestClaimSheet`).

## Startup wiring

`AppSession.bootstrap()` (App/AppSession.swift:21):

1. If `SecureSessionStore.hasToken()` is false: `phase = .signedOut`.
2. Otherwise GET `/api/me`. If `accountType == nil`, transition to `.onboarding(user)`; else `.ready(user)`.
3. On 401 or any other error: clear Keychain, drop to `.signedOut`.
4. Once `.ready`: fire-and-forget `ZkLoginCoordinator.shared.ensureProofWarm()` (so the first Send doesn't wait on Shinami) and `CurrencySettings.shared.refresh()` (FX rates for the display currency picker).

## Auth model

Server-mediated Google OAuth. The iOS app opens `${apiBase}/api/auth/mobile/start` in `ASWebAuthenticationSession`; the backend runs OAuth with the WEB `GOOGLE_CLIENT_ID` (so the JWT `aud` matches what Shinami sees on web, returning the same Sui address for the same Google account); on success the callback URL is `talise://auth/callback?token=...&userId=...` (see `Auth/GoogleSignInService.swift:16`).

- Bearer token: Keychain (`SecureSessionStore`, accessibility `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`).
- Ephemeral signing key: Curve25519 32-byte raw, Keychain backed (`EphemeralKeyStore`).
- zkLogin proof cache: Keychain (`ProofCache` inside `Auth/ZkLoginCoordinator.swift:452`), persists `maxEpoch`, `jwtRandomness`, and raw proof bytes across cold starts.
- Onboarding survives in `UserDefaults` (`talise.kyc_tier`).
- FX rates: `UserDefaults` snapshot in `App/CurrencySettings.swift:43`.

Full pipeline lives in `21-ios-auth-zklogin.md`.

## Networking

`AppConfig` (App/AppConfig.swift) reads `TALISE_API_BASE_URL` from process environment then `TaliseAPIBaseURL` from Info.plist, defaulting to `https://talise.io`. Production iOS clients hit the `app.talise.io` mobile origin. Every request goes through `APIClient.shared`, a `MainActor` singleton URLSession on an ephemeral config (`Network/APIClient.swift:18`) that:

- Attaches `Authorization: Bearer <token>` (Keychain) and optional `X-App-Attest` + `X-App-Attest-KeyId` headers.
- Deduplicates in-flight GETs by `"METHOD path"` (collapses SwiftUI `.task` + `.refreshable` races, see `Network/APIClient.swift:184`).
- Maps `NSURLErrorCancelled` (-999) to `APIError.cancelled` so call sites can ignore them via `APIError.isCancellation(_:)`.
- Supports SPKI cert pinning (the pinned set is currently empty pending first prod deploy: `Network/APIClient.swift:208`).

Typed request/response shapes live in `Network/APIModels.swift`. PTB sponsor + sponsor-execute responses bypass Codable and use raw `[String: Any]` parsing because the proof object is a nested freeform structure that gets stringified through `AnyCodable` (see `24-ios-networking-and-sui.md`).

## Dark mode only

`AppRoot.body` ends with `.preferredColorScheme(.dark)` (App/AppRoot.swift:26). `TaliseColor` (DesignSystem/Tokens.swift:7) is dark by spec: pure black background (`bg = 0x000000`), white foreground, two glass surfaces (`surfaceGlass`, `surfaceGlassStrong`), and a single accent green (`0x79D96C`). The comment at `Tokens.swift:5` flags the intent: the web product is light-mode; a future shared design system will thread these through `@Environment(\.colorScheme)`, but iOS is dark by spec today. A prior attempt to add light-mode infra on iOS was reverted.
