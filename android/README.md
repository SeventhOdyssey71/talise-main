# Talise Android

Native Android port of the Talise iOS app — Kotlin + Jetpack Compose, talking to the
same backend (`https://app.talise.io`). Dark-only UI modeled 1:1 on the iOS design system.

> **Status: functional Android port — lags the iOS client and is updated in bursts.**

See **[PLAN.md](PLAN.md)** for the full architecture + build phases.

## Status

A functional, iOS-parity port has landed — no longer a bare scaffold. The
`app/` module carries a substantial Kotlin/Compose codebase (~170+ `.kt` files)
plus real `res/` assets, with the design system, zkLogin sign-in, and the core
screens below working against the live backend. It trails the iOS client on
newer features and is advanced in bursts (see the phase breakdown below and in
PLAN.md).

Structured to compile in Android Studio (Giraffe+ / AGP 8.7):

- **Design system** (`ui/theme`, `ui/components`) — exact iOS tokens: colors, type,
  radii/spacing, `taliseGlass` surface, `SlideToConfirm`, `IconChip`/`HugeIcon`,
  buttons, `HeroAmount`, `StatTile`, `PremiumListRow`, `OptionCardRow`, `ActionTile`.
- **Core** (`core/`) — Retrofit/OkHttp `ApiClient` + `TaliseApi`, kotlinx-serialization
  DTOs, Keystore-backed `SecureStore`, `AppSession` phase machine, `TaliseEvents` bus,
  `ZkLoginCoordinator` + `SuiCrypto` (byte-exact Ed25519 + Blake2b signing).
- **Navigation** — `TaliseRoot` phase router → `MainScaffold` (floating pill bottom nav:
  Home / Invest / Rewards / Profile) + routes for Move money, Deposit, Payroll, Send.
- **Screens** — Home (live `/api/balances` + `/api/activity`, activity rows incl.
  team/cash-out treatment), SignIn, Earn, Rewards, Profile, the Move-money hub,
  Deposit, Payroll (live `/api/payouts/teams`), Send (amount + SlideToConfirm).
- **Copilot** (`feature/chat`, `core/net/ChatClient`) — the money assistant, streamed
  live from `POST /api/chat/stream` over Server-Sent Events (the same wire the iOS
  Chat tab consumes). Greeting + 2x2 starter grid on an empty thread, growing reply
  bubbles as tokens arrive, "Ask anything" input pill. Launches from the Home header.
  Recall + persistence to Walrus Memory are server-side per turn, so the client stays
  thin — no on-device transcript store.

## Phase 1 — zkLogin sign-in (done)

Native Google sign-in is wired end-to-end against the live backend:
`prepareGoogle` (GET `/api/sui/epoch` → maxEpoch+2, gen randomness, POST
`/api/auth/mobile/nonce` for the Poseidon nonce) → Credential Manager returns a
**nonce-bound** Google ID token (web client id) → POST `/api/auth/mobile/exchange`
→ bearer stored, session advances into the app. Set `GOOGLE_WEB_CLIENT_ID` to use it.

## Remaining (phases 2–4 — see PLAN.md §6)

- Phase 2: Send pipeline (sponsor-prepare → sign → execute), Earn supply/withdraw,
  Payroll pay, Profile actions, Play Integrity headers.
- Phase 3: cross-border, cheques, streams, invoices, ramps, scan-to-pay, private send.
- Phase 4: optimistic updates + SWR cache, success animations, QA, Play Console.

## Setup

1. Open the `android/` folder in Android Studio and sync. The Gradle wrapper
   (`gradle 8.11.1`) is committed, so `./gradlew assembleDebug` works from the CLI too
   (needs a JDK 17 + the Android SDK; set `ANDROID_HOME` or a `local.properties` with
   `sdk.dir`).
2. Set the OAuth client id for sign-in (phase 1): in `app/build.gradle.kts`,
   `GOOGLE_WEB_CLIENT_ID` — use the **same web client id** the iOS app + web use
   (required for zkLogin address parity).
3. To point at a local backend, change `API_BASE_URL` in `app/build.gradle.kts`.
4. Run on an emulator/device (minSdk 26).

> Icons currently use Material stand-ins mapped by `TaliseIcons`; import the 15 HugeIcons
> SVGs + flag assets as vector drawables for a pixel-exact match (see PLAN.md §3).
> Fonts use the platform sans/mono; drop Inter + JetBrains Mono into `res/font` to match SF.
