# 24. iOS Networking and Sui

The HTTP client, the typed DTOs, the BLAKE2b digest path, address handling, the sponsored transaction flow, and the error taxonomy.

## API host

`App/AppConfig.swift:8`. Resolution order:

```
ProcessInfo.processInfo.environment["TALISE_API_BASE_URL"]
?? Bundle.main.infoDictionary["TaliseAPIBaseURL"]
?? "https://talise.io"
```

Local dev sets `TALISE_API_BASE_URL=http://localhost:3000` in the Xcode scheme's Run > Arguments > Environment Variables. Production builds hit `app.talise.io` (the mobile origin).

Other config values: `TALISE_GOOGLE_CLIENT_ID` (currently unused in code, kept for future direct PKCE), `CFBundleShortVersionString` (becomes the `User-Agent`).

## APIClient

`Network/APIClient.swift:18`. A `@MainActor` singleton on an ephemeral `URLSession`. Per-request configuration:

```swift
cfg.timeoutIntervalForRequest = 15
cfg.timeoutIntervalForResource = 30
cfg.httpAdditionalHeaders = [
    "Accept": "application/json",
    "User-Agent": "Talise-iOS/\(AppConfig.shared.appVersion)",
]
```

Public surface:

```swift
func get<T: Decodable>(_ path: String) async throws -> T
func post<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T
```

Both flow through a private `request<T>` that:

1. Resolves URL via `URL(string: AppConfig.apiBaseURL + path)` (NOT `URL.append(path:)`, which percent-encodes `?` and breaks query strings; see comment at `:118`).
2. Attaches `Authorization: Bearer <SecureSessionStore.read()>` if present.
3. Attaches `X-App-Attest: <assertion>` and `X-App-Attest-KeyId` if `DCAppAttestService` is supported. The assertion is over `SHA256(body ?? Data())`.
4. Dedupes GETs via an `actor InFlightRegistry` keyed on `"METHOD path"` (collapses the SwiftUI `.task + .refreshable` race that flooded logs with `-999 cancelled`).
5. Maps transport errors to `APIError` (cancellations to `.cancelled`).
6. 401 → `APIError.unauthorized`. Non-2xx → `APIError.status(code, message:)`. Decode failure → `APIError.decode(error, body:)` with the raw body preserved.

### Cert pinning

`PinningDelegate` (`Network/APIClient.swift:205`). SPKI SHA-256 base64 set is currently empty (the TODO notes "fill these in after first prod deploy"); falls back to system trust evaluation. Rotate with overlap when the leaf cert is renewed.

## APIError

`Network/APIError.swift`. Cases: `transport(Error)`, `decode(Error, body: String)`, `status(Int, message: String?)`, `unauthorized`, `noSession`, `pinningFailed`, `invalidResponse`, `cancelled`.

`APIError.isCancellation(_:)` is the centralized predicate: matches `CancellationError`, `APIError.cancelled`, or `NSURLErrorDomain / NSURLErrorCancelled`. Call sites use it to skip clobbering on-screen state during pull-to-refresh races (e.g. `HomeView.loadBalance()` preserves the last known balance instead of nil-ing it).

`safeMessage(_:)` (`:64`) strips markup-looking bodies and extracts `error`/`message` fields from JSON, then clips at 140 chars so a Next.js 404 HTML page never leaks into a SwiftUI Text view.

## APIModels

`Network/APIModels.swift` (800 lines). The canonical typed shapes. Highlights:

```swift
struct UserDTO: Codable, Hashable {
    let id, email: String
    let name, picture, country: String?
    let suiAddress: String
    let accountType: AccountType?   // .personal | .business
    let businessName, businessHandle: String?
    let taliseHandle, taliseSubname: String?
    func displayHandle() -> String?   // honors accountType
}

struct BalancesDTO: Codable {
    let address: String
    let usdsui, sui, suiPriceUsd, totalUsd: Double
}

struct ActivityEntryDTO: Codable, Identifiable {
    let digest: String
    let timestampMs: Double
    let direction: String   // "sent" | "received" | "invest" | "withdraw" | "autoswap" | "swap"
    let amountUsdsui, amountSui: Double?
    let counterparty, counterpartyName: String?
    let venue: String?           // "deepbook" | "navi"
    let otherCoin: ActivityOtherCoin?    // WAL / USDC / USDT (raw u64 string)
}

struct BuildKindResponse: Codable {
    let transactionKindB64: String
    let roundupUsd: Double?     // Phase 2 v2 compound NAVI supply leg
}

struct YieldVenue: Codable, Identifiable {
    let venue: String           // wire stays lowercase
    let apy: Double
    let supplied, pendingRewards, earned, earningPerDay, principalSupplied: Double?
    var displayName: String { displayVenueName(venue) }  // "Navi", "Deepbook"
}
```

There is one centralized free function `displayVenueName(_ code: String) -> String` (`APIModels.swift:270`) so every receipt, history row, and button caption maps `"navi" → "Navi"` and `"deepbook" → "Deepbook"` identically.

### u64 over the wire

Any cap, balance, or amount that could approach `2^53` is sent as a `String` not a `UInt64` — Codable would lose precision. Examples: `VaultBalance.amount`, `WalletCoinBalance.amount`, `AutoSwapCapDTO.maxPerSwap`, `AutoSwapCapDTO.expiresAtMs`. Each provides an `amountDouble: Double` computed for display.

`AutoSwapCapDTO.expiresAtMs` was originally typed `UInt64` and Codable failed to decode the server's `"0"` string, surfacing as "Couldn't read response from server." Fixed to `String` with an `expiresAtMsValue: UInt64` accessor.

### Proof + sponsor responses bypass Codable

`APIModels.swift:84` makes the case explicit: `/api/zk/proof`, `/api/zk/sponsor`, and `/api/zk/sponsor-execute` responses are read via raw `JSONSerialization` because routing the freeform `proof` dict through `AnyCodable` stringifies inner JSON. There is a fallback `AnyCodable` at `:772` but it is intentionally not used on the proof path.

### Domain namespaces

Two thin namespaces split feature-specific endpoints out of the bare `APIClient` calls:

- `Network/WalletAPI.swift`. `WalletAPI.balances()`, `WalletAPI.sweep(coins:)`. The sweep is the one-tap "Convert all to USDsui" PTB that swaps every non-USDsui leg through Cetus in a single transaction.
- `Network/VaultAPI.swift`. Full vault surface: `migrationStatus`, `createPrepare`, `record`, `migrateBundle`, `migrateConfirm`, `enableAutoSwap`, `enableDefaultCaps`, `pauseAutoSwap`, `resumeAutoSwap`, `disableAutoSwap`, `migrateCap`, `upgradeCapV2`, `sweepNow` (fire-and-forget), `getState`, `withdrawFromVault`. Every PTB-builder returns `VaultCreatePrepareResponse { bytesB64, sender }` for the standard sign + sponsor-execute pipeline.

The companion enum `AutoSwapSourceCoin` (`VaultAPI.swift:259`) hardcodes the supported source coin type tags (`"0x2::sui::SUI"`, USDC, USDT) along with their native decimals (9 for SUI, 6 for USDC/USDT) and `isStable` (no oracle hit needed for the cap amount calc). Hardcoding decimals as a fixed 6 was the bug that turned a "₦250 cap" into ~0.000167 SUI on chain.

## Sui glue

### Address validation

`Sui/SuiAddress.swift`. Just a tagged `String`: `0x` prefix + 64 hex chars, lowercased. Provides `short` ("0x12345678…cd1234"). The `SuiAsset` enum (`.usdsui`, `.sui`) carries `decimals` (6 vs 9) and `toOnChain(_ amount: Double) -> UInt64` for PTB build sites that need raw u64.

### BLAKE2b

`Sui/Blake2b.swift`. Pure-Swift BLAKE2b-256 (RFC 7693). Required because CryptoKit ships no BLAKE2 and Sui's transaction digest protocol is:

```
1. intentMessage = [scope, version, app_id] || tx_bytes     // 3-byte prefix [0,0,0]
2. digest        = blake2b256(intentMessage)                // 32 bytes
3. ed25519_sig   = sign(ephemeralSK, digest)                // 64 bytes
4. SerializedSignature = [0x00] || ed25519_sig || ed25519_pk  // 97 bytes
```

Implementation details:

- `hash256(_ message: Data) -> Data` initializes state `h = IV` with `h[0] ^= 0x0101_0020` (param block: 32-byte digest, no key, fanout=1, depth=1).
- Materializes `message` into a flat `[UInt8]` to avoid `Data` slice start-index gotchas with `copyBytes`.
- Compresses 128-byte blocks; final block is zero-padded with the `last: true` flag.
- Output is `h[0..4]` little-endian (32 bytes).

`Blake2b.runSelfTest()` cross-checks against `@noble/hashes/blake2.js` known answers (empty, "abc", `[0,0,0] || "hello"`). `TaliseApp.init()` runs the self-test in DEBUG and logs divergence as `[zk] Blake2b self-test FAILED — signing will reject on chain`. Not `fatalError`'d so a buggy build still launches and a dev can diagnose.

## Sponsored transaction flow

End-to-end (`ZkLoginCoordinator.signAndSubmit`, `Auth/ZkLoginCoordinator.swift:201`):

```swift
// 1. Sponsor (Onara) wraps the caller's PTB into sponsored TransactionData.
let sponsor = try await postAuthenticated(
    path: "/api/zk/sponsor",
    body: ["transactionKindB64": transactionKindB64]
)
let txBytesData = Data(base64Encoded: sponsor["bytes"] as! String)!

// 2. iOS produces only the Ed25519 leg of the zkLoginSignature.
let intentMessage = Data([0, 0, 0]) + txBytesData
let digest        = Blake2b.hash256(intentMessage)
let key           = try EphemeralKeyStore.shared.loadOrCreate()
let rawSig        = try key.signature(for: digest)
let pubKey        = key.publicKey.rawRepresentation
let userSig       = (Data([0x00]) + rawSig + pubKey).base64EncodedString()

// 3. Backend assembles zkLoginSignature (proof + ephemeral sig + JWT metadata)
//    and broadcasts via Onara.
let exec = try await postAuthenticated(path: "/api/zk/sponsor-execute", body: [
    "bytesB64": sponsor["bytes"]!,
    "ephemeralPubKeyB64": pubKey.base64EncodedString(),
    "maxEpoch": ProofCache.shared.maxEpoch!,
    "randomness": ProofCache.shared.jwtRandomness!,
    "userSignature": userSig,
    "cachedProof": <validated dict>,        // optional
    "meta": ["kind": ..., "amountUsd": ..., "venue": ..., "roundupUsd": ...]   // optional
])
```

The `meta` block fuels rewards accounting. Send passes `("send", amount)`, EarnView passes `("invest", amount, venue)`, withdraws pass `("withdraw", 0)`. Round-up sends forward `built.roundupUsd` from `/api/send/prepare` so the server credits the second leg's points + bumps the savings tally separately from the send leg. The server independently recomputes round-up so a user cannot inflate it client-side.

A `freshProof` returned by `/api/zk/sponsor-execute` is cached for the next round (`ZkLoginCoordinator.swift:303`).

## Error handling patterns

A few patterns recur:

1. **Pull-to-refresh cancellation tolerance.** Every loader that backs a view uses `if !APIError.isCancellation(error)` before clobbering state. Example: `HomeView.loadBalance()` preserves the last known balance on -999 so the user does not see a flash of `$0.00`.

2. **Session rebind detection.** `ZkLoginCoordinator.postAuthenticated` (`:398`) inspects 401 responses for `{"code":"session_rebind_required"}` and throws `SessionError.rebindRequired`. Send call sites catch this, set an inline error, and call `session.signOut()` so the user re-auths.

3. **Optional graceful degradation.** Backend fields added after iOS shipped are decoded as `Optional` in the DTO. Example: `AutoSwapCapDTO.needsMigration: Bool?` defaults to `false` via `requiresMigration` so older server builds (lacking the field) don't surface the migration banner.

4. **Sponsor mint-on-demand fallback.** If the server reports a corrupted `cachedProof` shape, iOS drops the local cache and lets sponsor-execute mint a fresh proof on this call (`ZkLoginCoordinator.swift:280`). The fresh proof comes back as `freshProof` and is cached for next time.

5. **Best-effort vs hard failures.** `VaultAPI.sweepNow()` is intentionally `_ = try? await ...`; the user-triggered instant sweep is purely an acceleration over the 60s cron. Failing silently keeps the UI clean — the cron catches up regardless.
