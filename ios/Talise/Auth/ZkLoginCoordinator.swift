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
        let google = GoogleSignInService()
        let oauth = try await google.signIn()

        let key = try EphemeralKeyStore.shared.loadOrCreate()
        let pubKeyB64 = key.publicKey.rawRepresentation.base64EncodedString()

        guard let maxEpoch = await fetchMaxEpoch() else {
            throw CoordinatorError.exchangeFailed(
                "Could not read current Sui epoch — is the backend reachable?"
            )
        }

        let body: [String: Any] = [
            "idToken": oauth.idToken,
            "ephemeralPubKeyB64": pubKeyB64,
            "jwtRandomness": oauth.jwtRandomness,
            "maxEpoch": maxEpoch,
        ]
        let response = try await postUnauthenticated(
            path: "/api/auth/mobile/exchange",
            body: body
        )

        guard let bearer = response["bearer"] as? String,
              let userJSON = response["user"] as? [String: Any] else {
            throw CoordinatorError.exchangeFailed("malformed response")
        }
        // Persist bearer first so subsequent calls authorize.
        try SecureSessionStore.shared.save(token: bearer)

        // Cache the pre-warmed proof + jwtRandomness + maxEpoch — the
        // sponsor-execute endpoint will look this up via the bearer.
        ProofCache.shared.maxEpoch = maxEpoch
        ProofCache.shared.jwtRandomness = oauth.jwtRandomness
        // The proof field may be missing OR JSON-null (backend couldn't
        // mint pre-warm) OR a dict (success). Only serialize if it's a
        // dict/array — otherwise JSONSerialization raises NSException
        // and try? does NOT catch Objective-C exceptions.
        if let proof = response["proof"],
           JSONSerialization.isValidJSONObject(proof) {
            ProofCache.shared.proofRaw = try? JSONSerialization.data(withJSONObject: proof)
        }

        let user = try parseUser(userJSON)
        return SignInResult(user: user)
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
    func signAndSubmit(
        transactionKindB64: String,
        intent: String
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

        // 2. Sign Sui intent message with ephemeral Ed25519.
        let intentMessage = Data([0, 0, 0]) + txBytesData
        let key = try EphemeralKeyStore.shared.loadOrCreate()
        let rawSig = try key.signature(for: intentMessage)
        let pubKey = key.publicKey.rawRepresentation
        let pubKeyB64 = pubKey.base64EncodedString()
        // Sui SerializedSignature: 0x00 flag (Ed25519) + sig + pubkey
        let userSig = (Data([0x00]) + rawSig + pubKey).base64EncodedString()

        // 3. Hand to /sponsor-execute. Backend assembles zkLoginSignature
        //    (proof + ephemeral sig + jwt metadata), POSTs to Onara,
        //    returns the digest.
        var executeBody: [String: Any] = [
            "bytesB64": bytesB64,
            "ephemeralPubKeyB64": pubKeyB64,
            "maxEpoch": maxEpoch,
            "randomness": jwtRandomness,
            "userSignature": userSig,
        ]
        if let proofData = ProofCache.shared.proofRaw,
           let proofJSON = try? JSONSerialization.jsonObject(with: proofData) {
            executeBody["cachedProof"] = proofJSON
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
    /// that are out of range, so a hard-coded fallback like 1_000_000 is
    /// what was causing the (-32602) "Invalid params" error.
    private func fetchMaxEpoch() async -> Int? {
        struct Response: Decodable { let epoch: String }
        do {
            let r: Response = try await APIClient.shared.get("/api/sui/epoch")
            guard let current = Int(r.epoch) else { return nil }
            return current + 2
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
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        req.timeoutInterval = 30
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse else {
            throw CoordinatorError.sponsorFailed("no response")
        }
        guard (200..<300).contains(http.statusCode) else {
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

/// In-memory cache for the per-session zkLogin proof + the metadata the
/// server needs to assemble a SerializedSignature on every sponsor-execute.
/// Cleared on sign-out.
@MainActor
final class ProofCache {
    static let shared = ProofCache()
    private init() {}

    var maxEpoch: Int?
    var jwtRandomness: String?
    var proofRaw: Data?

    func clear() {
        maxEpoch = nil
        jwtRandomness = nil
        proofRaw = nil
    }
}
