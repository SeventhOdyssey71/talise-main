# Talise Android — Build Plan

A native Android port of the Talise iOS app (gasless USD-stablecoin wallet on Sui).
Goal: **model the iOS UI exactly** — same dark theme, same flows, same design tokens —
on idiomatic Android (Kotlin + Jetpack Compose), talking to the **same backend**
(`https://app.talise.io`).

---

## 1. Tech stack (the SwiftUI → Compose mapping)

| iOS | Android |
|-----|---------|
| SwiftUI | Jetpack Compose (Material3 base, fully re-themed) |
| `@Observable AppSession` | `AppSession` singleton exposing `StateFlow<Phase>` |
| `NavigationStack` + `fullScreenCover` + `sheet` | `androidx.navigation.compose` NavHost + `ModalBottomSheet` + full-screen routes |
| `NotificationCenter` events | a `TaliseEvents` `SharedFlow` bus (`txCompleted`, `homeShouldRefresh`, cover requests) |
| `URLSession` + `APIClient` | Retrofit + OkHttp (auth + App-Integrity interceptors) + kotlinx.serialization |
| Keychain | Android Keystore via `EncryptedSharedPreferences` (`SecureStore`) |
| CryptoKit Ed25519 + Blake2b | BouncyCastle (`Ed25519Signer`, `Blake2bDigest`) |
| Google Sign-In (web client id) | Credential Manager + Google ID, **same web OAuth client id** |
| `@AppStorage` | `DataStore<Preferences>` |
| custom fonts in bundle | `res/font` + Compose `FontFamily` |

**Min SDK 26, target/compile SDK 35, Kotlin 2.x, AGP 8.x, Compose BOM.** Dark theme only.

---

## 2. Module / package layout

Single `:app` module (a multi-module split is premature for a port). Package root `io.talise.app`.

```
io.talise.app
├── TaliseApp.kt                  Application (init SecureStore, AppSession)
├── MainActivity.kt               single activity, hosts TaliseRoot()
├── config/  AppConfig            base URL, OAuth client id, build flags
├── core/
│   ├── net/    ApiClient, AuthInterceptor, ApiResult, Endpoints (Retrofit iface)
│   ├── auth/   ZkLoginCoordinator, EphemeralKeyStore, ProofCache, GoogleSignInService
│   ├── store/  SecureStore (EncryptedSharedPreferences), Prefs (DataStore)
│   ├── session/ AppSession (Phase state machine), TaliseEvents (event bus)
│   └── model/  DTOs (UserDTO, BalancesDTO, ActivityEntryDTO, …) — mirror APIModels.swift
├── ui/
│   ├── theme/  Color, Type, Shape, Spacing, Theme  ← exact iOS tokens
│   ├── components/  SlideToConfirm, IconChip, HugeIcon, Cards (taliseGlass),
│   │               Buttons (LiquidGlassButton/Pill), Eyebrow/MicroLabel,
│   │               HeroAmount, StatTile, PremiumListRow, OptionCardRow,
│   │               ActionTile, RoundedFlag, SuccessScreen, Toast
│   └── nav/    TaliseRoot (phase router), MainScaffold (bottom nav), Routes
└── feature/
    ├── onboarding/ SignInScreen
    ├── home/       HomeScreen + HomeViewModel + HomeRepository
    ├── earn/       EarnScreen + EarnViewModel
    ├── rewards/    RewardsScreen + RewardsViewModel
    ├── profile/    ProfileScreen + ProfileViewModel
    ├── send/       SendFlow (amount→recipient→review→sending→complete/failure)
    ├── movemoney/  MoveMoneyScreen (the "Move money" hub: 2×2 grid + groups)
    ├── deposit/    DepositScreen
    ├── payroll/    PayrollScreen, TeamEditScreen, PayTeamScreen
    └── …           cheques/streams/invoices/ramps (later phases)
```

---

## 3. Design system (ported 1:1 from iOS — exact values)

**Colors** (dark only): `bg #000000`, `surface #161616`, `surface2 #242424`,
`surfaceGlass #1C1C1C`, `surfaceGlassStrong #2C2C2C`, `fg #FFFFFF`, `fgSubtle #FAFAFA`,
`fgMuted #B5B5B5`, `fgDim #636363`, `line white@8%`, `accent #79D96C`,
`greenMint #CAFFB8`, `greenDeep #4B8A37`, `warmGold #C08A3E`, `danger #A05A3E`.
Badges: `badgeSent #6C3A38@50%`, `badgeReceived #355F40@50%`, `badgeNeutral #4A4A4A@60%`.
TopGlow gradient: `#6BA85A@55% → #355626@40% → black`.

**Type**: system sans (Inter/Roboto stand-in for SF Pro) + mono (JetBrains/Roboto Mono).
Helpers `display/heading/body/mono(size, weight)`. Hero amount = display 42, kerning −1.6.
Eyebrow = mono 10, tracking 2.0, uppercase, fgMuted. MicroLabel = mono 8.

**Shape/spacing**: continuous corners → `RoundedCornerShape`. Radii sm 10 / md 14 / lg 20 /
xl 25 / pill 40. Spacing 4/8/12/16/24/32/48. Button heights 32/40/44.

**Core surface** = `taliseGlass(radius)`: `surface` fill + 1px `line` border, **flat** (no blur/
gradient — "Liquid Glass" is flat now). `rampCard()` = `taliseGlass(20)`.

**Key components**: `SlideToConfirm` (58dp capsule, 0.8 drag threshold, spring),
`IconChip` (squircle radius=side*0.32, tint@12% wash + tinted glyph), `HugeIcon`
(template drawable, tinted), `RoundedFlag`, `HeroAmount`, `StatTile`, `PremiumListRow`,
`OptionCardRow`, `ActionTile` (132dp tile), `LiquidGlassButton/Pill`.

**Icons**: import the 15 HugeIcons SVGs (`hi.bank`…`hi.team`) as vector drawables
(`ic_hi_bank.xml` …). Flags: `flag-<cc>` → `flag_<cc>` drawables.

---

## 4. Backend contract (same API as iOS/web)

Base `https://app.talise.io`. Auth: `Authorization: Bearer <token>` from
`/api/auth/mobile/exchange`. App-integrity headers (Play Integrity ≈ iOS App Attest) — phase 2.

Key endpoints used by the first screens:
- `GET /api/me`, `GET /api/balances`, `GET /api/activity?limit=`
- `GET /api/recipient/resolve?q=`, `GET /api/contacts`
- `POST /api/send/sponsor-prepare`, `POST /api/zk/sponsor-execute`, `POST /api/zk/proof`
- `GET /api/yield/comparison`, `POST /api/earn/{supply,withdraw}/prepare`
- `GET /api/payouts/teams`, `POST /api/payouts/teams[/record]`, `POST /api/payouts/batch/prepare`, `…/record`
- `GET /api/rewards/*`

Full DTO list mirrored in `core/model/` (see APIModels.swift parity).

---

## 5. The hard part — zkLogin on Android

The signing path **must be byte-identical** to iOS or Sui rejects the proof:
1. Ephemeral **Ed25519** keypair (BouncyCastle), stored in Keystore.
2. Google sign-in with the **same web OAuth client id**, nonce derived from
   `(ephemeralPubKey, maxEpoch, jwtRandomness)`.
3. `POST /api/auth/mobile/exchange { idToken, ephemeralPubKeyB64, jwtRandomness, maxEpoch }`
   → `{ bearer, user, proof? }`.
4. Sign a tx: `digest = Blake2b256([0,0,0] ++ txBytes)`; `sig = Ed25519.sign(digest)`;
   `userSignature = base64(0x00 ++ sig(64) ++ pubkey(32))`.
5. `POST /api/zk/sponsor-execute { bytesB64, ephemeralPubKeyB64, maxEpoch, randomness, userSignature, cachedProof?, meta }` → `{ digest }`.

Server mints/wraps the ZK proof, so Android only needs Ed25519 + Blake2b + the intent
prefix `[0,0,0]`. This is scaffolded as `ZkLoginCoordinator` with the crypto helpers stubbed
where the real keypair/signing wiring lands in phase 2.

---

## 6. Build phases

- **Phase 0 (this scaffold)**: Gradle project, theme + component library, networking +
  models + session + event bus, navigation shell (phase router + bottom nav), **Home** screen
  wired to `/api/balances` + `/api/activity`, **SignIn** screen, tab shells (Earn/Rewards/Profile),
  the **Move money** hub layout, **Payroll** list. Compiles in Android Studio (Giraffe+).
- **Phase 1**: real zkLogin (Ed25519 + Google + exchange), live data on all tabs.
- **Phase 2**: Send flow (full 5-step), Earn supply/withdraw, Deposit, Payroll pay (prepare→sign→record), Profile actions, Play Integrity.
- **Phase 3**: Cross-border, cheques, streams, invoices, ramps (Bridge), scan-to-pay, private send.
- **Phase 4**: polish (optimistic updates, snapshots/SWR cache, success animations, haptics), QA, Play Console internal track.

---

## 7. Parity checklist (UI must match iOS)

Dark-only · flat surfaces + hairline borders · bottom floating pill nav (Home/Invest/Rewards/Profile) ·
hero balance with dimmed cents + privacy eye · quick-action circles · activity rows with directional
badges + team/cashout icons · SlideToConfirm everywhere · full-screen success celebrations ·
custom numpad for amounts · the "Move money" 2×2 grid + expandable Cheques/Work groups + Payroll row.
