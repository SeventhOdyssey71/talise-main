# zkLogin integration for Talise

Drop-in zkLogin (Google sign-in → Sui address, no seed phrase) ported from the Cible app. Battle-tested: the Cible build shipped this in production with sponsored transactions, sign-and-submit, and JWT freshness checks all working on iOS 16+.

## What's here

```
zklogin/
├── README.md                   ← you are here
├── INTEGRATION.md              ← step-by-step guide to wire this into Talise
├── ios/
│   ├── ZkLoginService.swift    ← the @MainActor service — Google OAuth + ephemeral key + bridge calls
│   ├── ConnectWalletSheet.swift← working SwiftUI sign-in UI
│   └── Info.reference.plist    ← URL-scheme + ATS config to copy into Talise's Info.plist
├── bridge/
│   ├── server.js               ← stateless Node bridge (4 endpoints)
│   ├── package.json            ← @mysten/sui + @mysten/zklogin + express
│   ├── package-lock.json
│   ├── .env.example
│   └── sponsor-key.example.txt ← how to provision the sponsor keypair
└── docs/
    ├── ARCHITECTURE.md         ← why a bridge exists, what each piece does
    └── TROUBLESHOOTING.md      ← every error I hit during the Cible build + fix
```

## The 60-second pitch

1. User taps "Continue with Google" in `ConnectWalletSheet`
2. iOS opens `ASWebAuthenticationSession` to Google with **PKCE code flow** (iOS clients can't use implicit `id_token`)
3. Google calls back to `com.googleusercontent.apps.<reversed-client-id>://oauthredirect`
4. iOS exchanges the code at `oauth2.googleapis.com/token` for an `id_token` (JWT)
5. iOS generates an **ephemeral Curve25519 keypair** + a 16-byte **salt** (both Keychain-persisted)
6. iOS calls bridge `POST /zklogin/address` with `{jwt, salt}` → returns the user's Sui address
7. iOS shows the address. User is signed in.

For signing transactions later:
1. iOS describes a Move call to bridge `POST /tx/build` → returns BCS PTB bytes
2. iOS signs the bytes with its ephemeral Ed25519 key (CryptoKit)
3. iOS calls the **Mysten prover** at `prover-dev.mystenlabs.com` → returns a ZK proof
4. iOS calls bridge `POST /zklogin/sign` to wrap proof + signature into a final `zkLoginSignature`
5. iOS submits via `sui_executeTransactionBlock`

## Why a bridge

iOS standard libraries don't include:
- **Poseidon** (ZK-friendly hash used to derive the zkLogin address seed)
- **Blake2b** (hash for the final address)
- **BCS encoding** (Sui's binary canonical serialization)

A pure-Swift port of all three is multi-day work and isn't worth it for the hackathon. The bridge is ~280 LOC of Node and reuses `@mysten/zklogin` + `@mysten/sui` for the heavy lifting. The user's private key never leaves the device — the bridge only sees the JWT (already visible during OAuth) and the public ephemeral key.

## Quick start

```bash
# 1. Bring up the bridge
cd zklogin/bridge
npm install
cp .env.example .env
node server.js   # listens on :8787

# 2. In Xcode, drag ios/ZkLoginService.swift + ConnectWalletSheet.swift into Talise
#    Update the googleClientID constant in ZkLoginService.swift
#    Merge Info.reference.plist URL types + ATS section into Talise's Info.plist

# 3. In the app: tap Continue with Google → done
```

Read `INTEGRATION.md` for the full step-by-step.
