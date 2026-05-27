# zkLogin → Talise integration guide

A complete, ordered checklist for wiring this folder into the Talise iOS app + backend. Follow top to bottom; each step assumes the previous is done.

## Phase 1 — Google OAuth client

You need a Google iOS OAuth client. **The existing Cible client (`786432206940-hb9nbm7ie4p40g6vcseb15lnh2a870k2.apps.googleusercontent.com`) is bound to the Cible bundle ID** — you can reuse it for development if Talise's bundle ID is the same, otherwise create a new one.

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → APIs & Services → Credentials
2. Create OAuth 2.0 Client ID. Application type: **iOS**
3. Bundle ID: whatever Talise will ship as, e.g. `app.talise.Talise`
4. Save. You'll get a client ID of the form `1234567890-abcdef.apps.googleusercontent.com`
5. Note both the client ID **and** its reversed form `com.googleusercontent.apps.1234567890-abcdef` — you need both

**No client secret needed.** iOS OAuth clients use PKCE alone.

## Phase 2 — Bridge

The bridge is a stateless Node service. Same code for testnet and mainnet — just change `SUI_RPC_URL` in `.env`.

```bash
cd /Users/eromonseleodigie/Talise/zklogin/bridge
npm install
cp .env.example .env
```

Edit `.env`:
```
SPONSOR_PRIVATE_KEY_B64=          # leave empty if not using sponsored txs
SUI_RPC_URL=https://fullnode.testnet.sui.io
PORT=8787
```

Run:
```bash
node server.js
# → cible zklogin bridge listening on :8787
```

(The startup log still says "cible" — rename in `server.js` line 49 + 278 + `package.json` if you want it to say "talise." Pure cosmetic.)

Test from another terminal:
```bash
curl http://localhost:8787/health
# → {"ok":true,"service":"cible-zklogin-bridge","sponsor":null}
```

If you want sponsored transactions (gasless UX), follow `bridge/sponsor-key.example.txt` to provision and fund a sponsor keypair, then set `SPONSOR_PRIVATE_KEY_B64`.

## Phase 3 — iOS files

Talise's iOS app lives at `/Users/eromonseleodigie/Talise/ios/`. Copy these two files in:

```bash
cp /Users/eromonseleodigie/Talise/zklogin/ios/ZkLoginService.swift \
   /Users/eromonseleodigie/Talise/ios/Talise/Services/ZkLoginService.swift

cp /Users/eromonseleodigie/Talise/zklogin/ios/ConnectWalletSheet.swift \
   /Users/eromonseleodigie/Talise/ios/Talise/Views/Common/ConnectWalletSheet.swift
```

(If `ios/Talise/` doesn't exist yet, do this after Day 4 of `PLAN.md` when you scaffold the iOS app.)

### File-level renames

`ZkLoginService.swift` carries `cible.` Keychain key prefixes — leave them as-is or do a find-replace to `talise.`. Migration only matters if you have existing users; for a fresh hackathon build, rename freely.

Find-replace targets in `ZkLoginService.swift`:
- `cible.zkLoginJWT` → `talise.zkLoginJWT`
- `cible.zkLoginSalt` → `talise.zkLoginSalt`
- `cible.zkLoginRandomness` → `talise.zkLoginRandomness`
- `cible.zkLoginEphemeralKey` → `talise.zkLoginEphemeralKey`
- `cible.zkLoginAddress` → `talise.zkLoginAddress`
- `app.cible.zkLogin` (Keychain service name) → `app.talise.zkLogin`

Find-replace targets in `ConnectWalletSheet.swift`:
- "Cible never sees your password" → "Talise never sees your password"

### Required Talise-side types

`ZkLoginService` references three Talise-side types that must exist:

1. `NetworkConfig.shared.current.bridgeBaseURL` — the URL the bridge listens on (default `http://localhost:8787`)
2. `NetworkConfig.shared.current.zkProverURL` — Mysten prover URL (default `https://prover-dev.mystenlabs.com/v1`)
3. `SuiRPC.shared.rpcURL` — the Sui RPC endpoint for `sui_executeTransactionBlock`

`ConnectWalletSheet.swift` references:
4. `WalletService.shared.connect(address:)` — Talise's wallet service that consumes the derived address

If you're cloning the Cible app into `/Users/eromonseleodigie/Talise/ios/`, all of these come over for free. If you're starting from scratch, the minimal definitions are at the bottom of this file.

### Update the client ID

In `ZkLoginService.swift`, replace the constant:

```swift
static let googleClientID = "786432206940-hb9nbm7ie4p40g6vcseb15lnh2a870k2.apps.googleusercontent.com"
```

with your Talise client ID. The `redirectURI` and `redirectScheme` getters derive themselves from this — no other code change needed.

## Phase 4 — Info.plist

Open Talise's `Info.plist` and merge in two sections from `ios/Info.reference.plist`.

### Section A — URL types (Google OAuth callback)

Add a `CFBundleURLTypes` array entry whose `CFBundleURLSchemes` is the reversed Google client ID:

```xml
<key>CFBundleURLTypes</key>
<array>
    <dict>
        <key>CFBundleURLName</key>
        <string>app.talise.googleoauth</string>
        <key>CFBundleURLSchemes</key>
        <array>
            <string>com.googleusercontent.apps.YOUR-CLIENT-ID-PREFIX</string>
        </array>
    </dict>
</array>
```

Replace `YOUR-CLIENT-ID-PREFIX` with everything before `.apps.googleusercontent.com` in your client ID. Example: client ID `1234567890-abc.apps.googleusercontent.com` becomes scheme `com.googleusercontent.apps.1234567890-abc`.

**Without this, the OAuth callback will hang. iOS won't know to route the redirect back to the app.**

### Section B — App Transport Security (only for local development)

Allows iOS to talk to `http://localhost:8787` during development:

```xml
<key>NSAppTransportSecurity</key>
<dict>
    <key>NSAllowsLocalNetworking</key>
    <true/>
    <key>NSExceptionDomains</key>
    <dict>
        <key>localhost</key>
        <dict>
            <key>NSExceptionAllowsInsecureHTTPLoads</key>
            <true/>
            <key>NSIncludesSubdomains</key>
            <true/>
        </dict>
    </dict>
</dict>
```

Remove this once the bridge is deployed to HTTPS.

## Phase 5 — Wire ConnectWalletSheet into the app

In Talise's app entry (`TaliseApp.swift` or `ContentView.swift`):

```swift
@StateObject private var wallet = WalletService.shared

var body: some Scene {
    WindowGroup {
        ContentView()
            .environmentObject(wallet)
            .sheet(isPresented: $showSignIn) {
                ConnectWalletSheet()
                    .environmentObject(wallet)
            }
    }
}
```

Trigger `$showSignIn = true` from your home screen's sign-in button.

## Phase 6 — Smoke test

1. Bridge running on `:8787`
2. App built and launched in iOS Simulator
3. Tap "Continue with Google"
4. Google chooser appears
5. Pick an account
6. Returns to app
7. `ZkLoginService.shared.status` becomes `.ready(suiAddress: "0x...")`
8. `WalletService.shared.connectedAddress` mirrors that address

If step 7 fails, see `docs/TROUBLESHOOTING.md`.

## Phase 7 — Signing transactions

Once a user is signed in, send a transaction through Talise's Move package:

```swift
let bytes = try await ZkLoginService.shared.buildPtbViaBridge(
    sender: ZkLoginService.shared.connectedAddress!,
    packageId: "0x<talise_package_id>",
    module: "send",
    function: "send_usdc",
    typeArgs: [],
    args: [
        ["object": "0x<account_obj_id>"],
        ["object": "0x<policy_obj_id>"],
        ["pure": ["type": "u64", "value": "50000000"]],
        ["pure": ["type": "address", "value": "0x<recipient>"]],
        ["pure": ["type": "string", "value": "groceries"]],
    ]
)

let digest = try await ZkLoginService.shared.signAndSubmit(ptbBcsBytesB64: bytes)
print("tx digest:", digest)
```

That's the full flow. One PTB call, one signature, one digest back.

## Phase 8 — Production checklist (post-hackathon)

- [ ] Deploy the bridge to Fly / Railway / Render — don't ship localhost
- [ ] Update `NetworkConfig.bridgeBaseURL` to the deployed URL
- [ ] Remove the localhost ATS exception from Info.plist
- [ ] Tighten the bridge's CORS allow-list (currently `*`)
- [ ] Put a per-IP rate limit in front of `/sponsor`
- [ ] Monitor the sponsor address SUI balance — top up before it drains
- [ ] Switch `SUI_RPC_URL` to a mainnet endpoint
- [ ] Switch `zkProverURL` to `prover.mystenlabs.com` (no `-dev`)
- [ ] Verify the Google OAuth client's bundle ID matches the released app

## Appendix — Minimal Talise-side types (if not cloning from Cible)

If you're not cloning the Cible iOS app, you'll need these stubs:

### `NetworkConfig.swift`

```swift
import Foundation

@MainActor
final class NetworkConfig: ObservableObject {
    static let shared = NetworkConfig()

    struct Profile {
        let bridgeBaseURL: URL
        let zkProverURL: URL
        let suiRPCURL: URL
    }

    static let testnet = Profile(
        bridgeBaseURL: URL(string: "http://localhost:8787")!,
        zkProverURL: URL(string: "https://prover-dev.mystenlabs.com/v1")!,
        suiRPCURL: URL(string: "https://fullnode.testnet.sui.io")!
    )

    @Published var current: Profile = .testnet
}
```

### `SuiRPC.swift`

```swift
@MainActor
final class SuiRPC {
    static let shared = SuiRPC()
    var rpcURL: URL { NetworkConfig.shared.current.suiRPCURL }
}
```

### `WalletService.swift` (minimal stub)

```swift
@MainActor
final class WalletService: ObservableObject {
    static let shared = WalletService()
    @Published private(set) var connectedAddress: String?

    func connect(address: String) async {
        self.connectedAddress = address
    }

    func disconnect() {
        self.connectedAddress = nil
        ZkLoginService.shared.signOut()
    }
}
```

That's the floor. Everything else can grow from here.
