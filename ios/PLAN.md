# Talise iOS — Plan

End goal: a native iOS app that delivers the Talise wallet experience — zkLogin sign-in, KYC, send/receive, invest, earn rewards — sitting on the same backend (`/web`) and the same Sui infrastructure (Onara sponsored gas, Shinami zkLogin prover/salt, Payment Kit, SuiNS, NAVI + DeepBook yield).

Native iOS, not React Native or Capacitor. We need Secure Enclave for ephemeral keys, App Attest for backend trust, Face/Touch ID gating on every signature, push notifications for receives, and Universal Links for `/p/<handle>` payment links. None of those work cleanly through a cross-platform shim.

## Architecture in one diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│  iOS app  (SwiftUI · Swift 5.10 · iOS 18+)                           │
│                                                                      │
│  Features      DesignSystem      Auth                Sui             │
│  ─────────     ────────────      ──────              ────            │
│  SignIn        HeroNumber        GoogleSignIn(ASWeb) Address         │
│  KYC           StatCard          EphemeralKey(SE)    Amount          │
│  Home          TaliseButton      SessionStore(KC)    TxBuilder       │
│  Send          PageHeader        ZkLoginCoord        Signature       │
│  Receive       Typography(GS)    AppAttest                           │
│  Earn          Tokens                                                │
│  Rewards                                                             │
│  Chat                                                                │
│                                                                      │
│         Network: APIClient (URLSession + async/await + AppAttest)    │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                  cookie + bearer · TLS pinned
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Existing /web backend (Next.js · Railway)                           │
│  /api/auth/google · /api/zk/proof · /api/zk/sponsor-execute          │
│  /api/me · /api/sui/epoch · /api/recipient · /api/tx                 │
│  /api/spot · /api/t2000 · /api/referral · /api/chat (Memwal)         │
└──────────────────────────────────────────────────────────────────────┘
        │                  │                  │              │
   Shinami zkLogin     Onara sponsor     Sui RPC      NAVI / DeepBook
   (proof + salt)      (Cloudflare)      (mainnet)    (yield venues)
```

The iOS app is a **thin native client over the backend we already shipped**. The hard cryptography (proof generation, salt management, sponsor sign) stays server-side. iOS handles ephemeral keys, signature assembly, biometric gating, and the UI.

## Security model

The wallet is non-custodial in the way zkLogin is non-custodial: the user controls signatures via Google + a device-bound ephemeral key. We harden the iOS surface:

- **Ephemeral private key in Secure Enclave** via `SecKeyCreateRandomKey` with `kSecAttrTokenIDSecureEnclave` and an access control of `.privateKeyUsage + .userPresence`. Every signature triggers Face/Touch ID. Key is rotated when `maxEpoch` expires (currently ~2 epochs / ~48h).
- **Session bearer in Keychain** with `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` and `.biometryCurrentSet` ACL. Token is rotated on every cold start.
- **Salt stays server-side** in Shinami. Device never sees it. This is identical to the web flow — it's the whole point of using Shinami's salt service.
- **App Attest** (`DCAppAttestService`) generates a per-install hardware-attested key. Every API call carries an attestation assertion in `X-App-Attest` so the backend rejects requests from outside the iOS app (no Postman replay).
- **TLS certificate pinning** on `URLSession` via `URLSessionDelegate.urlSession(_:didReceive:completionHandler:)`. Pin the Talise API leaf certificate's SPKI hash; rotate pins on a 90-day cadence with overlap.
- **Jailbreak/runtime checks** — best-effort: refuse to launch if `/Applications/Cydia.app` exists or if dyld shows `MobileSubstrate.dylib`. Not a real defense; just raises cost.
- **No mnemonic, no seed phrase, no private key export.** The recovery story is identical to web: sign back in with Google. That is the wallet.
- **Anti-replay**: every signed payload includes a server-issued nonce + `maxEpoch`. Backend rejects re-use.
- **Biometry on every send.** Even with a warm session, send/swap/supply/withdraw require LAContext evaluation. Idle apps lock after 60s with a blur overlay.

## Auth + KYC flow

The user's "KYC" requirement here is **verify the Google account binds to a real human**, not a full Sumsub-style identity check. The flow:

1. `SignInView` → tap "Continue with Google" → `ASWebAuthenticationSession` opens `https://talise.io/auth/google?mobile=1` with a `talise://auth/callback` redirect.
2. Backend runs the standard OAuth dance, mints the zkLogin proof via Shinami, creates the user row, sets the session cookie, and returns to `talise://auth/callback?token=<short-lived-bearer>&userId=<id>`.
3. App catches the deep link, stores the bearer in Keychain, fetches `/api/me`.
4. `KYCView` confirms: name (from Google), country picker (NG/US/UK/Other), phone (optional — used for receipt notifications via APNs association), account type (Personal/Business). Posts to `/api/onboarding` (already exists).
5. On success, generate ephemeral keypair in Secure Enclave, warm the proof via `/api/zk/proof`, navigate to `HomeView`.

Step 1's `?mobile=1` query is a new flag we add to `/auth/google` — it tells the backend to issue a mobile bearer token in addition to the cookie, and to redirect to the custom scheme instead of `/home`. Twelve-line change on the backend.

## Transaction signing

Every Sui write follows this pattern:

```
[Feature view]
  ↓ user taps Confirm, Face ID prompt
[ZkLoginCoordinator.signAndSubmit(ptbBuilder)]
  ↓ build PTB via SuiKit (or local BCS encoder)
  ↓ POST /api/zk/sponsor with { ptbBytesB64, sender }
[Backend]
  ↓ Onara sponsors gas, returns { txBytes, sponsorSig, digest, expiry }
[App]
  ↓ Sign txBytes with Secure Enclave ephemeral key
  ↓ Assemble zkLogin signature using cached proof + salt-derived addressSeed
  ↓ POST /api/zk/sponsor-execute with { txBytes, userSig }
[Backend]
  ↓ Submits to Sui, persists tx row, returns { digest }
[Feature view]
  ↓ Show success + Suiscan link
```

Sui address, BCS encoding, and zkLogin signature assembly come from **[OpenDive/SuiKit](https://github.com/opendive/suikit)** — the active Swift SDK with zkLogin support. We pin to a specific version and audit the surface we use.

When the new gasless stablecoin transfers from the May 20 announcement are usable, `signAndSubmit` gets a fast path that skips Onara for eligible USDsui sends — sets `gas_price = 0`, submits direct to Sui RPC, no sponsor leg, no `/api/zk/sponsor` round trip. Saves ~400-800ms per send.

## Module map

| Module | Job |
|---|---|
| `App/` | Entry point, scene phase handling, deep link router, app-lock overlay |
| `DesignSystem/` | Color tokens (mirrors `--color-*` from web), Google Sans loader, primitives (HeroNumber, StatCard, TaliseButton, PageHeader, Eyebrow) |
| `Auth/` | Google sign-in, Secure Enclave ephemeral key, Keychain session, App Attest, zkLogin coordinator |
| `Network/` | `APIClient` (URLSession + cert pinning + retry), typed Codable models, error type |
| `Sui/` | SuiAddress, SuiAmount (USDsui has 6 decimals, SUI has 9), PTB builder helpers wrapping SuiKit |
| `Features/SignIn/` | First-run sign-in screen |
| `Features/KYC/` | Country + account-type confirmation |
| `Features/Home/` | Dashboard with HeroNumber + sparkline + stat cards + payment actions |
| `Features/Send/` | Recipient resolver (SuiNS → address), amount, asset picker, confirm |
| `Features/Receive/` | QR + share + copy address |
| `Features/Earn/` | Yield comparison (NAVI vs DeepBook Margin), supply, withdraw |
| `Features/Rewards/` | Points, referrals, recent events |
| `Features/Chat/` | Memwal-backed Talise agent (SSE consumer) |

## Backend additions needed

Small surface — we re-use almost everything.

1. **Mobile OAuth flag** — `/auth/google` accepts `?mobile=1` and redirects to `talise://auth/callback?token=<bearer>&userId=<id>` instead of `/home`. Backend already mints proofs and sessions; just a new redirect branch.
2. **Bearer token table** — `mobile_sessions(user_id, token_hash, device_id, app_attest_key_id, created_at, expires_at)`. Validate on every mobile API call via `Authorization: Bearer <token>`. Cookie sessions stay unchanged for web.
3. **App Attest verifier** — `POST /api/auth/attest/register` (one-time per install) and middleware that validates `X-App-Attest` assertion on subsequent calls. Apple's public docs cover the flow.
4. **APNs registration** — `POST /api/notifications/register` storing device tokens; existing on-chain watcher triggers push when `payment_received` event fires.
5. **Universal Links manifest** — `/.well-known/apple-app-site-association` served by `/web` listing `/p/<handle>` and `/r/<code>` paths, signed by App ID.

None of this touches the wallet logic. It's plumbing for a second client.

## Phasing — what gets built when

**Week 1 — Foundation (this commit and the next):**
- Xcode project via XcodeGen
- Design system primitives matching the web visual scale
- `APIClient` with cert pinning + typed models for `/me`, `/zk/proof`, `/zk/sponsor*`, `/recipient`, `/spot`, `/t2000`
- Auth: Google sign-in via `ASWebAuthenticationSession`, Secure Enclave key, Keychain session
- `SignInView` + `KYCView` skeleton wired end-to-end against staging backend

**Week 2 — Send/Receive:**
- SuiKit integration, transaction builder for USDsui and SUI transfer PTBs
- `SendView`: SuiNS resolver, amount, biometric confirm, sponsored execute
- `ReceiveView`: QR with `sui:<addr>` URI scheme + amount param, share sheet
- Push notification scaffolding (APNs entitlement, register, handle)

**Week 3 — Invest + Rewards:**
- `EarnView`: yield comparison cards, supply via NAVI / DeepBook Margin, withdraw
- `RewardsView`: points, referrals, share-sheet referral code
- `HomeView`: full dashboard (HeroNumber, sparkline, stat row, recent activity)

**Week 4 — Polish + ship:**
- Chat (Memwal SSE consumer)
- App Attest enforced
- TestFlight + App Store assets
- Universal Links wired for `/p/<handle>` payment links and `/r/<code>` referral links
- Once the Sui gasless stablecoin path is verified (see the strategy memo from May 21), wire the fast path in `signAndSubmit`

## Risks

- **SuiKit version drift** — pin and audit. The Swift SDK is less mature than the JS SDK. If `signTransactionBlock` semantics drift or zkLogin assembly breaks, we have a small zkLogin assembler of our own to write. Budget 2 days of buffer.
- **Apple OAuth + Google** — Apple sometimes requires Sign In with Apple to be offered alongside any other third-party sign-in (App Store guideline 4.8). We add Sign In with Apple as a parallel path; the backend already has the OAuth scaffolding to extend.
- **App Attest false-fail rates** on jailbroken devices or simulators — provide a dev override behind a build flag, never shipped to App Store.
- **TestFlight review for crypto wallets** can be slow. Apple has gotten friendlier post-2024 wallet guidance, but expect 1-2 rejection cycles. Have clear "no in-app purchase of crypto, no on-ramp inside the app for the initial submission" framing.

## Non-goals (initial release)

- No Android. Single platform until iOS is solid.
- No in-app fiat on-ramp on launch — keep the App Store review clean. Hand off to web for on-ramp via Safari.
- No business context. Personal accounts only on iOS v1; business stays web-only.
- No full Sumsub-style KYC. Google verification is the bar for v1; revisit for jurisdictions that require more.
