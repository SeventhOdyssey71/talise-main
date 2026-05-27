# zkLogin troubleshooting

Every error I hit while wiring this up for Cible, and the exact fix that worked. If you see a new one, add it.

## `unsupported_response_type` from Google

**Symptom:** the OAuth redirect comes back with `error=unsupported_response_type`.

**Cause:** Google's iOS OAuth clients reject `response_type=id_token` (implicit flow). They only allow `response_type=code` with PKCE.

**Fix:** This is already implemented correctly in `ZkLoginService.runGoogleOAuth()` — it uses code flow + PKCE + token exchange. If you see this error, you've probably modified the auth URL. Restore the version in this folder.

---

## OAuth callback hangs (Safari opens, never returns)

**Symptom:** `ASWebAuthenticationSession` opens Google, you authenticate, then the page tries to redirect and either errors out or sits there.

**Cause:** Info.plist is missing the reversed-client-ID URL scheme. iOS doesn't know to route the callback back to the app.

**Fix:** Add this to Info.plist (replace the scheme with your reversed client ID):

```xml
<key>CFBundleURLTypes</key>
<array>
    <dict>
        <key>CFBundleURLName</key>
        <string>app.talise.googleoauth</string>
        <key>CFBundleURLSchemes</key>
        <array>
            <string>com.googleusercontent.apps.YOUR-PREFIX</string>
        </array>
    </dict>
</array>
```

---

## Bridge call fails with "A server with the specified hostname could not be found"

**Symptom:** `ZkLoginService` logs "bridge returned non-2xx" or DNS failure.

**Cause:** ATS (App Transport Security) blocks `http://localhost:8787`. iOS requires HTTPS by default.

**Fix:** Add the ATS exception in Info.plist:

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

Remove this for production (deploy bridge to HTTPS first).

---

## `tx/build returned non-2xx`

**Symptom:** building a PTB via the bridge fails with HTTP 500.

**Cause:** the most common one is misformatted `args`. The bridge expects each arg to be either `{"object": "0x..."}` or `{"pure": {"type": "...", "value": "..."}}`. Flat strings, ints, or untagged values are rejected.

**Fix:** Wrap every arg:

```swift
// WRONG
args: ["0xabc...", 1000, true]

// RIGHT
args: [
    ["object": "0xabc..."],
    ["pure": ["type": "u64", "value": "1000"]],
    ["pure": ["type": "bool", "value": true]],
]
```

If the type is `u64` and the number is large (anything over Int32 max), pass it as a **string**, not a Swift `Int`. JSON serialization will lose precision otherwise.

---

## `Prover failed: nonReserved...` from Mysten prover

**Symptom:** the prover call returns a 400 or 500 with a message about reserved fields or invalid input.

**Cause:** typically a JWT that's expired, malformed, or doesn't match the `aud` claim Google issued.

**Fix:**
1. Sign out and sign back in to get a fresh JWT.
2. Verify the Google OAuth client ID in `ZkLoginService.googleClientID` exactly matches the one whose JWT is being sent.
3. Check that `keyClaimName` is `"sub"` in both the bridge call and the prover call.
4. If `defaultMaxEpoch` is way in the past, increase it (current value `1_000_000` is fine for testnet but should track the actual current epoch in production).

---

## `wallet not connected` after signing in

**Symptom:** `ZkLoginService.status` is `.ready` but `WalletService.connectedAddress` is `nil`.

**Cause:** the two services aren't synced. The Cible app fixed this by having `WalletService` subscribe to `ZkLoginService.$status` via Combine.

**Fix:** in your Talise `WalletService.init()`:

```swift
private var zkLoginCancellable: AnyCancellable?

init() {
    zkLoginCancellable = ZkLoginService.shared.$status
        .receive(on: RunLoop.main)
        .sink { [weak self] status in
            Task { @MainActor in
                if case let .ready(address) = status {
                    self?.connectedAddress = address
                }
            }
        }
}
```

Single source of truth. They can never diverge.

---

## `tx not successful` from sui_executeTransactionBlock

**Symptom:** the transaction is built and signed, but submission returns `effects.status.status == "error"` with a Move abort code.

**Cause:** Move-level failure. Could be: insufficient balance, invalid object reference, policy cap exceeded, slippage trigger, etc.

**Fix:** inspect the error message. The bridge surfaces it as `errMsg` in `submitTransaction()`. Common ones:

- `EOverCap` — single payment exceeded `AgentPolicy.max_single_payment_usdc`
- `EOverDailyCap` — daily spend cap hit; resets at next UTC day
- `ENotOwner` — caller doesn't own the policy or account
- `ESlippageExceeded` — DeepBook spot price moved beyond tolerance

Each is a normal user-facing condition. Surface a friendly message in the UI rather than just dumping the abort code.

---

## Stale address auto-reconnects after sign-out

**Symptom:** after `signOut()`, restarting the app shows the old address still connected.

**Cause:** SQLite or UserDefaults held a saved address; `init()` restored it without checking JWT freshness.

**Fix:** in `ZkLoginService.init()`, before restoring `status = .ready(...)`, validate the JWT is still present and not expired. The current implementation does this — if you see this bug, you've probably broken the order of the init logic. Restore from this folder.

---

## Bridge can't `npm install`

**Symptom:** `npm install` fails with peer-dependency conflicts or "no matching version" errors.

**Cause:** the package.json pins specific versions. Make sure you're on Node 20+.

**Fix:**
```bash
node --version  # must be >= 20
rm -rf node_modules package-lock.json
npm install
```

If you still get errors, the `@mysten/sui` and `@mysten/zklogin` versions may have drifted. Pin to the versions in `package.json` (currently `@mysten/sui@1.38.0`, `@mysten/zklogin@0.7.30`).

---

## Sponsor returns 503

**Symptom:** `/sponsor` returns HTTP 503 with "sponsor key not configured".

**Cause:** `SPONSOR_PRIVATE_KEY_B64` env var is empty.

**Fix:** Follow `bridge/sponsor-key.example.txt`. Provision an Ed25519 keypair, base64-encode the secret seed, drop into `.env`, restart the bridge. Don't forget to fund the sponsor address from the testnet faucet so it has SUI to spend on gas.

---

## "OAuth state mismatch"

**Symptom:** OAuth comes back with `state mismatch` error after Google login.

**Cause:** the `state` parameter sent to Google didn't survive the round-trip. Most often: the user closed and reopened the browser sheet, or there are concurrent OAuth flows.

**Fix:** dismiss any open sheets before calling `signInWithGoogle()`. If you're calling it from a button tap, debounce to prevent double-tap.

---

## App rejects "cancelled" errors in UI

**Symptom:** transient `URLError.cancelled` shows up as a red error banner.

**Cause:** the user navigated away while a request was in flight, or iOS killed the background task.

**Fix:** suppress transient errors. The Cible app has a `RetryPolicy.isTransientNetworkError()` helper that filters `URLError.cancelled`, `.networkConnectionLost`, `.timedOut`. Use it:

```swift
do {
    // request
} catch {
    if isTransientNetworkError(error) {
        print("transient, ignoring: \(error)")
        return
    }
    self.lastError = error.localizedDescription
}
```

Port `RetryPolicy.swift` over from the Cible app if you want this.
