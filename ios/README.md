# Talise iOS

Native iOS client over the existing Talise backend (`/web`). Swift 5.10, SwiftUI, iOS 17+.

## Getting started

```bash
brew install xcodegen
cd ios
xcodegen
open Talise.xcodeproj
```

Set these in a local `.env` (gitignored) or in scheme env vars:

| Key | Example | Notes |
|---|---|---|
| `TALISE_API_BASE_URL` | `https://talise.io` | Backend origin. Use `http://localhost:3000` against local web dev. |
| `TALISE_GOOGLE_CLIENT_ID` | `<reverse-client-id>.apps.googleusercontent.com` | iOS OAuth client from Google Cloud Console. |

The app reads these via `Bundle.main.infoDictionary` — see `Talise/App/AppConfig.swift`.

## Project layout

See [PLAN.md](./PLAN.md) for the full strategy. Module map:

```
Talise/
├── App/                Entry, root coordinator, app lock, deep links
├── DesignSystem/       Tokens, typography, primitives
├── Auth/               GoogleSignIn, Secure Enclave key, Keychain, zkLogin coord, App Attest
├── Network/            APIClient, Codable models, errors
├── Sui/                Address + amount helpers, transaction builders
├── Features/
│   ├── SignIn/
│   ├── KYC/
│   ├── Home/
│   ├── Send/
│   ├── Receive/
│   ├── Earn/
│   ├── Rewards/
│   └── Chat/
└── Resources/
    ├── Assets.xcassets
    ├── GoogleSans/     Variable .ttf bundled (see DesignSystem/Typography.swift)
    ├── Info.plist
    └── Talise.entitlements
```

## Backend dependencies

The iOS app depends on these existing backend endpoints (all under `/web/app/api`):

- `/auth/google?mobile=1` — needs a 12-line patch to redirect to `talise://auth/callback?token=...&userId=...` (see PLAN.md § Backend additions needed)
- `/zk/proof` — already returns the proof shape we need
- `/zk/sponsor` + `/zk/sponsor-execute` — Onara sponsored gas
- `/me`, `/recipient/resolve`, `/sui/epoch`, `/spot/*`, `/t2000/*`, `/referral/*`, `/chat`

New endpoints to add (week 1):

- `POST /api/auth/attest/register` — App Attest key registration
- `POST /api/auth/mobile/token` — exchange Google ID token for a Talise bearer
- `POST /api/notifications/register` — APNs device token storage
- `/.well-known/apple-app-site-association` — Universal Links manifest

## Security posture

See PLAN.md § Security model. Headline:
- Ephemeral key in Secure Enclave with `.userPresence` ACL — every signature triggers Face/Touch ID
- Session bearer in Keychain with biometry-gated retrieval
- App Attest assertion on every API call
- TLS cert pinning to the Talise leaf SPKI
- Salt never leaves Shinami — device only ever sees zkLogin proofs, not salts
- No mnemonic, no seed phrase, no key export. Recovery = sign back in with Google.

## Where the design lives

Figma source of truth: Untitled · node `42-1819` (URL in conversation history). The home dashboard layout mirrors the web `/home` Ledgerix-style hero. Other screens reference web components (HeroNumber, StatCard, TaliseButton, PageHeader) ported to SwiftUI in `DesignSystem/`.
