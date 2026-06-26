# Talise Android

Native Android port of the Talise iOS app — Kotlin + Jetpack Compose, talking to the
same backend (`https://app.talise.io`). Dark-only UI modeled 1:1 on the iOS design system.

See **[PLAN.md](PLAN.md)** for the full architecture + build phases.

## Status — Phase 0 (scaffold)

Done and structured to compile in Android Studio (Giraffe+ / AGP 8.7):

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

## Remaining (phases 1–4 — see PLAN.md §6)

- Phase 1: real zkLogin sign-in (Credential Manager → Google ID token → exchange).
- Phase 2: Send pipeline (sponsor-prepare → sign → execute), Earn supply/withdraw,
  Payroll pay, Profile actions, Play Integrity headers.
- Phase 3: cross-border, cheques, streams, invoices, ramps, scan-to-pay, private send.
- Phase 4: optimistic updates + SWR cache, success animations, QA, Play Console.

## Setup

1. Open the `android/` folder in Android Studio. It will fetch the Gradle wrapper
   (`gradle 8.11.1`) and sync.
2. Set the OAuth client id for sign-in (phase 1): in `app/build.gradle.kts`,
   `GOOGLE_WEB_CLIENT_ID` — use the **same web client id** the iOS app + web use
   (required for zkLogin address parity).
3. To point at a local backend, change `API_BASE_URL` in `app/build.gradle.kts`.
4. Run on an emulator/device (minSdk 26).

> Icons currently use Material stand-ins mapped by `TaliseIcons`; import the 15 HugeIcons
> SVGs + flag assets as vector drawables for a pixel-exact match (see PLAN.md §3).
> Fonts use the platform sans/mono; drop Inter + JetBrains Mono into `res/font` to match SF.
