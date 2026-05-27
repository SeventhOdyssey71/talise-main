# 21. iOS Auth: zkLogin

The end-to-end flow for getting from "tap Continue with Google" to a signed Sui transaction, with the iOS-specific bugs the team had to fix along the way.

## Actors

| File | Responsibility |
|---|---|
| `ios/Talise/Auth/GoogleSignInService.swift` | OAuth handoff via `ASWebAuthenticationSession` against the backend's WEB OAuth client. |
| `ios/Talise/Auth/EphemeralKeyStore.swift` | Curve25519 keypair, persisted in Keychain. Also hosts `SuiRandomness` (base-10 randomness for BN254 scalars). |
| `ios/Talise/Auth/SecureSessionStore.swift` | Bearer token in Keychain. |
| `ios/Talise/Auth/AppAttestService.swift` | DCAppAttestService bootstrap + per-request assertion. |
| `ios/Talise/Auth/ZkLoginCoordinator.swift` | The pipeline orchestrator. Owns `ProofCache`. |

## Sign-in flow

`ZkLoginCoordinator.signIn()` (`Auth/ZkLoginCoordinator.swift:57`):

```
1. EphemeralKeyStore.loadOrCreate()        // Curve25519, Keychain
   → pubKeyB64 = key.publicKey.rawRepresentation.base64EncodedString()

2. GoogleSignInService().signIn(ephemeralPubKeyB64: pubKeyB64)
   → opens ${apiBase}/api/auth/mobile/start?ephemeralPubKey=<base64URL>
     in ASWebAuthenticationSession (callbackURLScheme: "talise")
   → backend runs OAuth against WEB GOOGLE_CLIENT_ID + secret
   → callback URL: talise://auth/callback?token=...&userId=...
   → returns { bearer, userId }

3. SecureSessionStore.save(token: bearer)  // Keychain

4. GET /api/me                              // canonical UserDTO
   → taliseHandle, suiAddress, accountType, country, ...

5. Warm the zkLogin proof in the background:
     randomness = SuiRandomness.generate()
     maxEpoch   = fetchMaxEpoch()           // backend, then mainnet RPC fallback
     POST /api/zk/proof { ephemeralPubKeyB64, maxEpoch, randomness }
     ProofCache.shared.proofRaw = byte-identical re-serialization of `proof` dict
```

`SignInScreen` (`Features/Onboarding/SignInScreen.swift`) and the legacy `SignInView` (`Features/SignIn/SignInView.swift:54`) both call `ZkLoginCoordinator.shared.signIn()` and forward the resulting `UserDTO` to `AppSession.handleSignedIn(user:)`.

## Why server-mediated OAuth

`GoogleSignInService.swift:8`: if iOS uses its own OAuth client, the JWT's `aud` differs from the web client's, and Shinami's salt service returns a different Sui address for the same Google account. The fix is to route iOS OAuth through the backend's existing WEB client so iOS and web produce identical wallets.

## The `+` → space bug

`GoogleSignInService.swift:58`. Standard base64 contains `+`, which survives a URL query string but gets decoded back to a literal SPACE by Next.js's `URLSearchParams`. That corrupted the ephemeral pubkey server-side. The fix is base64URL (RFC 4648 section 5): replace `+ → -`, `/ → _`, strip `=` before adding the query param:

```swift
let urlSafe = ephemeralPubKeyB64
    .replacingOccurrences(of: "+", with: "-")
    .replacingOccurrences(of: "/", with: "_")
    .replacingOccurrences(of: "=", with: "")
```

This shipped as commit `00653cc mobile-start: base64URL the ephemeral pubkey so '+' doesn't become space`.

## Ephemeral key

`EphemeralKeyStore.swift:34`. `Curve25519.Signing.PrivateKey` from CryptoKit, 32-byte raw representation persisted as a generic-password Keychain item under service `io.talise.app.zklogin.ephemeral`, accessibility `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`. Not Secure Enclave because SE only supports P-256 (zkLogin requires Ed25519, sig scheme flag 0x00) and SE rejects key creation on the Simulator.

## Salt + randomness

Talise relies on the backend's Shinami salt service (no client-side salt is held). What the client does provide is the per-session `jwtRandomness`: a 16-byte big-endian decimal string from `SuiRandomness.generate()` (`Auth/EphemeralKeyStore.swift:106`). The base-10 form fits Mysten's prover expectation and stays within the BN254 scalar field. `ProofCache.jwtRandomness` is the persisted string.

## Address derivation

iOS does not derive the address client-side. `GET /api/me` returns the authoritative `UserDTO.suiAddress` (the same address Shinami minted for the JWT). `SuiAddress` (`Sui/SuiAddress.swift`) is just a value type for validation and display (`short` truncation, hex check).

## Sign + submit (sponsored)

`ZkLoginCoordinator.signAndSubmit(transactionKindB64:intent:rewards:)` (`Auth/ZkLoginCoordinator.swift:201`):

```
1. POST /api/zk/sponsor   { transactionKindB64 } → { bytes }
2. txBytesData = base64.decode(bytes)
   intentMessage = Data([0,0,0]) + txBytesData           // Sui intent prefix
   digest = Blake2b.hash256(intentMessage)               // 32 bytes
   rawSig = key.signature(for: digest)                   // Ed25519, 64 bytes
   userSig = base64( [0x00] + rawSig + pubKey )          // SerializedSignature, 97 bytes
3. POST /api/zk/sponsor-execute {
     bytesB64, ephemeralPubKeyB64, maxEpoch, randomness,
     userSignature: userSig,
     cachedProof?: <proof dict if shape-valid>,
     meta?: { kind, amountUsd, venue?, roundupUsd? }
   } → { digest, freshProof? }
```

The actual `zkLoginSignature` (proof + ephemeral sig + JWT metadata) is assembled server-side. iOS only produces the Ed25519 leg and forwards the proof, randomness, and `maxEpoch`. Same pattern as the web app.

`maxEpoch` is `currentEpoch + 2` (the standard zkLogin ~48-hour window). `fetchMaxEpoch()` tries the backend (`/api/sui/epoch`) first then falls back to a direct mainnet JSON-RPC call (`sui_getLatestSuiSystemState`) so a server outage doesn't block sign-in (`ZkLoginCoordinator.swift:321`).

### Why iOS used to fail sponsor-execute with "Invalid signature"

`ZkLoginCoordinator.swift:222`. Earlier iOS code signed the raw intent message. Sui's protocol is:

```
digest = blake2b256(intentMessage)
sig    = ed25519_sign(ephemeralSK, digest)
```

Signing `intentMessage` directly (Ed25519 does its own internal SHA-512 round) produces a signature the validator rejects. The fix was to hash with BLAKE2b first. CryptoKit has no BLAKE2 so the team shipped a pure-Swift implementation (see `24-ios-networking-and-sui.md`). The DEBUG branch logs `digest=<hex>` for cross-checking against the server's `signTransaction` output.

## Proof JSON round-trip

`Auth/ZkLoginCoordinator.swift:120` and `:274`. The Shinami proof is a nested object: `proofPoints` is a dict of arrays, `issBase64Details` is an object, etc. Routing it through Codable + `AnyCodable` stringifies inner JSON values: `cachedProof` then arrives at the server as a string and the valibot validator rejects with "Expected object, found string."

The fix is to bypass Codable entirely on the proof leg:

- Read the raw `Data`, `JSONSerialization.jsonObject(...)`, extract the `proof` dict.
- Persist `JSONSerialization.data(withJSONObject: proof)` byte-identically in `ProofCache.proofRaw`.
- Before forwarding `cachedProof`, validate the shape: `proofJSON["proofPoints"] is [String: Any]`. If the shape is wrong (older corrupted cache), drop it so the server mints a fresh proof on this call.
- When sponsor-execute returns `freshProof`, persist it for the next round.

Shipped as `4180d5a Fix proof JSON round-trip (cached AnyCodable was stringifying inner json)`.

## ProofCache

`Auth/ZkLoginCoordinator.swift:452`. Before this change, the cache was in-memory only and evaporated on cold start; users who relaunched between actions saw "no proof cache, sign in again" on the next Send despite still being signed in.

Now: a `Snapshot { maxEpoch, jwtRandomness, proofRaw }` is encoded to JSON and stored as a generic-password Keychain item under service `io.talise.app.proof-cache`, account `v1`, accessibility `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`. Every `didSet` on a property persists. `hydrate()` runs in `init`.

`ZkLoginCoordinator.ensureProofWarm()` (`:100`) is called from `AppSession.bootstrap` for returning users (bearer survived but cache might be cold). It short-circuits if all three slots are populated.

## Session rebind error

`Auth/ZkLoginCoordinator.swift:396`. The backend can respond `401 { code: "session_rebind_required" }` for older bearers that predate the Poseidon-nonce binding. `postAuthenticated` detects this and throws `SessionError.rebindRequired`, which both `SendFlowView.confirm()` (`Features/Send/SendFlowView.swift:169`) and `LegacySendView.send()` (`Features/Send/SendView.swift:515`) intercept to surface a "Sign in again" message and call `session.signOut()`.

## App Attest

`Auth/AppAttestService.swift`. Optional hardware attestation: `DCAppAttestService.generateKey()` on first launch, `attestKey` with `SHA256` of a server challenge, register at `/api/auth/attest/register`. After bootstrap, every API call's payload SHA-256 is signed into an assertion attached as `X-App-Attest`. On Simulator `isSupported` is false, so the header is omitted; the backend allows missing assertions when `TALISE_ATTEST_REQUIRED=0`.

## Sign-out

`AppSession.signOut()` (`App/AppSession.swift:52`) clears all three Keychain stores: bearer, ephemeral key, and proof cache. `Phase = .signedOut`.
