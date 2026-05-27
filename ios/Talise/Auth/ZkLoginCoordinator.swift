import Foundation
import CryptoKit

/// Orchestrates the full zkLogin pipeline against the Talise backend.
///
/// Sign-in:
///   1. GoogleSignInService.signIn() → (idToken, jwtRandomness)
///   2. Generate / load ephemeral Curve25519 key
///   3. POST /api/auth/mobile/exchange { idToken, ephemeralPubKeyB64,
///        jwtRandomness, maxEpoch } → { user, bearer, proof, maxEpoch }
///   4. Persist bearer (SecureSessionStore), proof + maxEpoch + randomness
///      (ProofCache), return user
///
/// Sign+submit (sponsored, today):
///   1. Caller hands us PTB bytes (base64)
///   2. POST /api/zk/sponsor { ptbBytesB64, sender } →
///        { txBytes, sponsorSignature }
///   3. Sign txBytes with the ephemeral key (Sui intent prefix + Ed25519)
///   4. Assemble Sui-format SerializedSignature: 0x00 flag + sig + pubkey
///   5. POST /api/zk/sponsor-execute { txBytes, userSignature,
///        sponsorSignature, kind } → { digest }
///
/// The actual zkLoginSignature wrapping (proof + ephemeralSig + jwt
/// metadata) happens server-side in /api/zk/sponsor-execute. iOS only
/// produces the raw Ed25519 part — same pattern as the web app.
@MainActor
final class ZkLoginCoordinator {
    static let shared = ZkLoginCoordinator()
    private init() {}

    struct SignInResult {
        let user: UserDTO
    }

    struct SignedSubmission {
        let digest: String
    }

    enum CoordinatorError: LocalizedError {
        case exchangeFailed(String)
        case sponsorFailed(String)
        case executeFailed(String)
        case noEphemeralKey

        var errorDescription: String? {
            switch self {
            case .exchangeFailed(let s): return "Sign-in exchange failed: \(s)"
            case .sponsorFailed(let s): return "Sponsorship failed: \(s)"
            case .executeFailed(let s): return "Execute failed: \(s)"
            case .noEphemeralKey: return "Ephemeral key missing."
            }
        }
    }

    // MARK: - Sign-in

    func signIn() async throws -> SignInResult {
        // 1. Make sure we have an ephemeral key BEFORE OAuth so we can
        //    bind it into the start-state cookie.
        let key = try EphemeralKeyStore.shared.loadOrCreate()
        let pubKeyB64 = key.publicKey.rawRepresentation.base64EncodedString()

        // 2. Open the server-mediated OAuth flow. This uses the WEB
        //    GOOGLE_CLIENT_ID + secret so the resulting JWT has the
        //    same `aud` Shinami sees on web — same wallet, same Sui
        //    address. ASWebAuthenticationSession comes back with the
        //    minted mobile bearer via talise://auth/callback.
        let signed = try await GoogleSignInService().signIn(
            ephemeralPubKeyB64: pubKeyB64
        )
        try SecureSessionStore.shared.save(token: signed.bearer)

        // P1-5: kick off App Attest bootstrap immediately after the
        // bearer lands. Best-effort: if the device doesn't support
        // App Attest (sim, dev) the call no-ops; if the network is
        // flaky it'll retry next launch. Sensitive routes that
        // require X-App-Attest will still 401 until this completes
        // at least once, which is the intended behavior.
        Task.detached { [bearer = signed.bearer] in
            try? await AppAttestService.shared.bootstrap(
                bearer: bearer,
                apiBaseURL: AppConfig.shared.apiBaseURL
            )
        }

        // 3. Authoritative user record via /api/me (taliseHandle on
        //    chain, accountType, businessHandle, etc.).
        let me: UserDTO = try await APIClient.shared.get("/api/me")

        // 4. Warm the zkLogin proof so the first send skips Shinami's
        //    cold start. Best-effort; sponsor-execute will mint on
        //    demand if this fails.
        let randomness = SuiRandomness.generate()
        ProofCache.shared.jwtRandomness = randomness
        if let maxEpoch = await fetchMaxEpoch() {
            ProofCache.shared.maxEpoch = maxEpoch
            Task { await warmProof(
                pubKeyB64: pubKeyB64,
                randomness: randomness,
                maxEpoch: maxEpoch
            ) }
        }

        return SignInResult(user: me)
    }

    /// Idempotent warm-up. Called from AppSession.bootstrap so a
    /// returning user (bearer in Keychain, no fresh signIn this launch)
    /// still gets a usable ProofCache before they tap Send.
    ///
    /// Skips if the cache already has BOTH randomness + maxEpoch +
    /// proof bytes. Otherwise mints fresh.
    func ensureProofWarm() async {
        if ProofCache.shared.jwtRandomness != nil,
           ProofCache.shared.maxEpoch != nil,
           ProofCache.shared.proofRaw != nil {
            return
        }
        guard let key = try? EphemeralKeyStore.shared.loadOrCreate() else { return }
        let pubKeyB64 = key.publicKey.rawRepresentation.base64EncodedString()
        let randomness = ProofCache.shared.jwtRandomness ?? SuiRandomness.generate()
        ProofCache.shared.jwtRandomness = randomness
        guard let maxEpoch = await fetchMaxEpoch() else { return }
        ProofCache.shared.maxEpoch = maxEpoch
        await warmProof(
            pubKeyB64: pubKeyB64,
            randomness: randomness,
            maxEpoch: maxEpoch
        )
    }

    /// Best-effort proof pre-mint via /api/zk/proof.
    ///
    /// We DON'T go through APIClient + Codable here because the proof
    /// shape is a nested dict with arrays + objects (issBase64Details,
    /// proofPoints, headerBase64). Routing it through AnyCodable
    /// stringifies the inner JSON — sending that back to the server
    /// makes valibot reject with "Expected object, found string". So
    /// we read the raw JSON, extract the proof dict directly, and
    /// store its byte-identical re-serialization. That preserves the
    /// exact wire shape Shinami emitted.
    private func warmProof(pubKeyB64: String, randomness: String, maxEpoch: Int) async {
        guard let bearer = SecureSessionStore.shared.read() else { return }
        guard let url = URL(string: AppConfig.shared.apiBaseURL + "/api/zk/proof") else {
            return
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer " + bearer, forHTTPHeaderField: "Authorization")
        req.httpBody = try? JSONSerialization.data(withJSONObject: [
            "ephemeralPubKeyB64": pubKeyB64,
            "maxEpoch": maxEpoch,
            "randomness": randomness,
        ])
        req.timeoutInterval = 30
        do {
            let (data, response) = try await URLSession.shared.data(for: req)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                return
            }
            guard let top = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let proof = top["proof"] as? [String: Any],
                  JSONSerialization.isValidJSONObject(proof) else {
                return
            }
            // Byte-identical re-serialization of the dict — no
            // AnyCodable wrapping anywhere in this path.
            ProofCache.shared.proofRaw = try? JSONSerialization.data(withJSONObject: proof)
        } catch {
            // Cold cache — first send pays the Shinami latency. Fine.
        }
    }

    // MARK: - Sign + submit

    /// Sign + sponsor + submit a transaction-kind PTB through the Onara
    /// sponsored gas pipeline. `transactionKindB64` is the base64 of the
    /// PTB built locally (or via SuiKit once integrated) — the iOS app
    /// hands the kind bytes, the backend wraps them in a sponsored
    /// TransactionData with Onara as gas owner, and we sign the result.
    ///
    /// Endpoints used:
    ///   POST /api/zk/sponsor          { transactionKindB64 } → { bytes }
    ///   POST /api/zk/sponsor-execute  { bytesB64, ephemeralPubKeyB64,
    ///                                   maxEpoch, randomness, userSignature,
    ///                                   cachedProof? }       → { digest, ... }
    /// Rewards-accounting metadata. Optional; when set, the server
    /// credits points for the settled tx after Onara confirms
    /// broadcast. The kind/amount come from the iOS call site that
    /// already knows what action it's submitting — Send passes
    /// `("send", amountUsd)`, EarnView passes `("invest", amountUsd)`,
    /// withdraw passes `("withdraw", 0)`, etc.
    struct RewardsMeta {
        let kind: String      // "send" | "invest" | "withdraw" | "roundup" | "goal"
        let amountUsd: Double
        let venue: String?
        /// Phase 2 v2 — when a Send PTB includes a compound NAVI supply
        /// leg for round-up auto-save, this is the round-up amount in
        /// USDsui (server-blessed, returned from /api/send/prepare).
        /// Server credits the round-up points + bumps the savings
        /// tally separately from the send leg. Nil for sends without
        /// round-up enabled or for non-send kinds.
        let roundupUsd: Double?

        init(kind: String, amountUsd: Double, venue: String? = nil, roundupUsd: Double? = nil) {
            self.kind = kind
            self.amountUsd = amountUsd
            self.venue = venue
            self.roundupUsd = roundupUsd
        }
    }

    func signAndSubmit(
        transactionKindB64: String,
        intent: String,
        rewards: RewardsMeta? = nil
    ) async throws -> SignedSubmission {
        guard let maxEpoch = ProofCache.shared.maxEpoch,
              let jwtRandomness = ProofCache.shared.jwtRandomness else {
            throw CoordinatorError.exchangeFailed("no proof cache — sign in again")
        }

        // 1. Get sponsored tx bytes.
        let sponsor = try await postAuthenticated(
            path: "/api/zk/sponsor",
            body: ["transactionKindB64": transactionKindB64]
        )
        guard let bytesB64 = sponsor["bytes"] as? String,
              let txBytesData = Data(base64Encoded: bytesB64) else {
            throw CoordinatorError.sponsorFailed("malformed sponsor response")
        }

        // 2. Sign the Sui transaction digest with ephemeral Ed25519.
        //    Sui's protocol (matches keypair.signTransaction in @mysten/sui):
        //      digest = blake2b256([0,0,0] || tx_bytes)
        //      sig    = ed25519_sign(ephemeralSK, digest)
        //    Ed25519 itself does an internal SHA-512 round; the BLAKE2b
        //    here is Sui's outer commitment to (intent, tx). Signing the
        //    raw intent message — as iOS used to — produces a signature
        //    the validator rejects with "Invalid signature was given to
        //    the function".
        let intentMessage = Data([0, 0, 0]) + txBytesData
        let digest = Blake2b.hash256(intentMessage)
        let key = try EphemeralKeyStore.shared.loadOrCreate()
        let rawSig = try key.signature(for: digest)
        let pubKey = key.publicKey.rawRepresentation
        let pubKeyB64 = pubKey.base64EncodedString()
        // Sui SerializedSignature: 0x00 flag (Ed25519) + sig + pubkey
        let userSig = (Data([0x00]) + rawSig + pubKey).base64EncodedString()
        #if DEBUG
        // One-line diagnostic. Compare against the server-computed digest
        // (lib/zksigner or @mysten/sui's signTransaction) to confirm iOS
        // BLAKE2b agrees byte-for-byte with @noble.
        let digestHex = digest.map { String(format: "%02x", $0) }.joined()
        let txLen = txBytesData.count
        print("[zk] sign — txBytes=\(txLen)B digest=\(digestHex) pk=\(pubKeyB64)")
        #endif

        // 3. Hand to /sponsor-execute. Backend assembles zkLoginSignature
        //    (proof + ephemeral sig + jwt metadata), POSTs to Onara,
        //    returns the digest. The optional `meta` block carries the
        //    rewards-accounting hint so the server can credit points
        //    for the settled tx after broadcast.
        var executeBody: [String: Any] = [
            "bytesB64": bytesB64,
            "ephemeralPubKeyB64": pubKeyB64,
            "maxEpoch": maxEpoch,
            "randomness": jwtRandomness,
            "userSignature": userSig,
        ]
        if let r = rewards {
            var metaDict: [String: Any] = [
                "kind": r.kind,
                "amountUsd": r.amountUsd,
            ]
            if let v = r.venue { metaDict["venue"] = v }
            // Forward the server-blessed round-up amount so sponsor-
            // execute can credit the second leg's points + bump the
            // savings tally. Server validates this against its own
            // recompute (the user can't inflate by lying here — at
            // worst they earn 0 round-up points if the server reads
            // their config as disabled).
            if let ru = r.roundupUsd, ru > 0 { metaDict["roundupUsd"] = ru }
            executeBody["meta"] = metaDict
        }
        // Only forward a CACHED proof if its shape still looks like
        // what Shinami emits. Older builds wrote a stringified-JSON
        // form into the cache (AnyCodable round-trip bug); sending
        // that produces a server-side valibot error ("Expected
        // object, found string"). Dropping it here lets the server
        // mint a fresh one on this call.
        if let proofData = ProofCache.shared.proofRaw,
           let proofJSON = try? JSONSerialization.jsonObject(with: proofData) as? [String: Any],
           proofJSON["proofPoints"] is [String: Any] {
            executeBody["cachedProof"] = proofJSON
        } else {
            // Clean the corrupted bytes so we don't keep trying.
            ProofCache.shared.proofRaw = nil
        }

        let exec = try await postAuthenticated(
            path: "/api/zk/sponsor-execute",
            body: executeBody
        )
        if let err = exec["error"] as? String {
            throw CoordinatorError.executeFailed(err)
        }
        guard let digest = exec["digest"] as? String, !digest.isEmpty else {
            throw CoordinatorError.executeFailed("no digest in response")
        }

        // If the backend minted a fresh proof, cache it so the next send
        // skips the 2-4s Shinami round trip. Defensive type check —
        // Objective-C NSException for non-dict top-level is not catchable.
        if let fresh = exec["freshProof"],
           JSONSerialization.isValidJSONObject(fresh) {
            ProofCache.shared.proofRaw = try? JSONSerialization.data(withJSONObject: fresh)
        }
        return SignedSubmission(digest: digest)
    }

    // MARK: - Helpers

    /// Fetches the current Sui epoch and returns `epoch + 2` — the standard
    /// zkLogin window (~48 hours). Shinami's prover rejects maxEpoch values
    /// outside this band.
    ///
    /// Two paths in priority order:
    ///   1. Our backend `/api/sui/epoch` (fast, already-warm SuiClient)
    ///   2. Direct mainnet JSON-RPC fallback — so a dev-server outage or
    ///      stale cache doesn't block sign-in. The epoch is public chain
    ///      state; either source returns the same value.
    private func fetchMaxEpoch() async -> Int? {
        if let v = await fetchEpochViaBackend() { return v + 2 }
        if let v = await fetchEpochViaMainnetRPC() { return v + 2 }
        return nil
    }

    private func fetchEpochViaBackend() async -> Int? {
        struct Response: Decodable { let epoch: String }
        do {
            let r: Response = try await APIClient.shared.get("/api/sui/epoch")
            return Int(r.epoch)
        } catch {
            return nil
        }
    }

    /// Direct call to the public Sui mainnet fullnode RPC. Mirrors what
    /// the backend does, but skips our server so we still get sign-in
    /// even if the dev server is down or rebooting.
    private func fetchEpochViaMainnetRPC() async -> Int? {
        var req = URLRequest(url: URL(string: "https://fullnode.mainnet.sui.io:443")!)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.timeoutInterval = 8
        let body: [String: Any] = [
            "jsonrpc": "2.0",
            "id": 1,
            "method": "sui_getLatestSuiSystemState",
            "params": [],
        ]
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        do {
            let (data, _) = try await URLSession.shared.data(for: req)
            struct Envelope: Decodable {
                struct Result: Decodable { let epoch: String }
                let result: Result?
            }
            let env = try JSONDecoder().decode(Envelope.self, from: data)
            return env.result.flatMap { Int($0.epoch) }
        } catch {
            return nil
        }
    }

    /// Bare JSON POST (no bearer) — used for the sign-in exchange that
    /// produces the bearer.
    private func postUnauthenticated(
        path: String,
        body: [String: Any]
    ) async throws -> [String: Any] {
        var url = URL(string: AppConfig.shared.apiBaseURL)!
        url.append(path: path)
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        req.timeoutInterval = 20
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse else {
            throw CoordinatorError.exchangeFailed("no response")
        }
        guard (200..<300).contains(http.statusCode) else {
            let msg = String(data: data, encoding: .utf8) ?? "HTTP \(http.statusCode)"
            throw CoordinatorError.exchangeFailed(msg)
        }
        guard let parsed = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw CoordinatorError.exchangeFailed("malformed JSON")
        }
        return parsed
    }

    /// Specific error iOS surfaces when the backend returns
    /// `code: session_rebind_required` — older bearer that predates
    /// the Poseidon-nonce binding. SignInView intercepts this and
    /// auto-signs-out so the user just sees a normal re-auth prompt.
    enum SessionError: Error { case rebindRequired }

    private func postAuthenticated(
        path: String,
        body: [String: Any]
    ) async throws -> [String: Any] {
        guard let bearer = SecureSessionStore.shared.read() else {
            throw CoordinatorError.sponsorFailed("not signed in")
        }
        var url = URL(string: AppConfig.shared.apiBaseURL)!
        url.append(path: path)
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer " + bearer, forHTTPHeaderField: "Authorization")
        let payload = try JSONSerialization.data(withJSONObject: body)
        req.httpBody = payload
        req.timeoutInterval = 30
        // Mirror APIClient: attach App Attest assertion + keyId hashed over
        // the exact JSON payload. The web side (/api/zk/sponsor-execute,
        // /api/zk/sponsor) rejects calls missing these headers.
        let payloadHash = Data(SHA256.hash(data: payload))
        if let assertion = await AppAttestService.shared.assertion(forRequestHash: payloadHash) {
            req.setValue(assertion, forHTTPHeaderField: "X-App-Attest")
        }
        if let keyId = AppAttestService.shared.keyId {
            req.setValue(keyId, forHTTPHeaderField: "X-App-Attest-KeyId")
        }
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse else {
            throw CoordinatorError.sponsorFailed("no response")
        }
        guard (200..<300).contains(http.statusCode) else {
            // Detect the special "your session predates the nonce
            // binding" 401 from /api/zk/sponsor-execute. Surface as
            // SessionError.rebindRequired so the UI auto-signs-out.
            if http.statusCode == 401,
               let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               (parsed["code"] as? String) == "session_rebind_required" {
                throw SessionError.rebindRequired
            }
            let msg = String(data: data, encoding: .utf8) ?? "HTTP \(http.statusCode)"
            throw CoordinatorError.sponsorFailed(msg)
        }
        guard let parsed = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw CoordinatorError.sponsorFailed("malformed JSON")
        }
        return parsed
    }

    private func parseUser(_ json: [String: Any]) throws -> UserDTO {
        let data = try JSONSerialization.data(withJSONObject: json)
        return try JSONDecoder().decode(UserDTO.self, from: data)
    }
}

/// Keychain-backed cache for the per-session zkLogin proof + metadata
/// the server needs to assemble a SerializedSignature on every
/// sponsor-execute.
///
/// Previously in-memory only — meant the cache evaporated on every cold
/// start. Users who relaunched the app between actions hit
/// "no proof cache — sign in again" on the next Send, even though
/// they were still signed in. Now we persist a small blob (JSON of
/// maxEpoch + randomness + proof) under a Keychain item with the
/// same accessibility as the bearer, so it survives relaunches but
/// stays per-device.
@MainActor
final class ProofCache {
    static let shared = ProofCache()
    private init() { hydrate() }

    var maxEpoch: Int? {
        didSet { persist() }
    }
    var jwtRandomness: String? {
        didSet { persist() }
    }
    var proofRaw: Data? {
        didSet { persist() }
    }

    func clear() {
        maxEpoch = nil
        jwtRandomness = nil
        proofRaw = nil
        wipe()
    }

    // MARK: - Keychain backing

    private let service = "io.talise.app.proof-cache"
    private let account = "v1"

    private struct Snapshot: Codable {
        let maxEpoch: Int?
        let jwtRandomness: String?
        let proofRaw: Data?
    }

    private func hydrate() {
        guard let data = readKeychain(),
              let snap = try? JSONDecoder().decode(Snapshot.self, from: data) else {
            return
        }
        // Bypass didSet by writing the snapshot atomically without
        // re-triggering persist() three times in a row.
        let alreadyHydrated = (maxEpoch ?? -1) == (snap.maxEpoch ?? -2)
        if alreadyHydrated { return }
        maxEpoch = snap.maxEpoch
        jwtRandomness = snap.jwtRandomness
        proofRaw = snap.proofRaw
    }

    private func persist() {
        let snap = Snapshot(
            maxEpoch: maxEpoch,
            jwtRandomness: jwtRandomness,
            proofRaw: proofRaw
        )
        guard let data = try? JSONEncoder().encode(snap) else { return }
        writeKeychain(data)
    }

    private func writeKeychain(_ data: Data) {
        let delete: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(delete as CFDictionary)

        let add: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        SecItemAdd(add as CFDictionary, nil)
    }

    private func readKeychain() -> Data? {
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else { return nil }
        return data
    }

    private func wipe() {
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(q as CFDictionary)
    }
}
