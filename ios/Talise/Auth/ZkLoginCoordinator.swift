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

        let maxEpoch = await fetchMaxEpoch() ?? 1_000_000

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
        if let proof = response["proof"] {
            ProofCache.shared.proofRaw = try? JSONSerialization.data(withJSONObject: proof)
        }

        let user = try parseUser(userJSON)
        return SignInResult(user: user)
    }

    // MARK: - Sign + submit

    /// Sign a sponsored transaction. `intent` is currently informational
    /// (could surface in a confirmation sheet); the actual Face ID prompt
    /// would happen in the calling view before invoking this method.
    func signAndSubmit(
        ptbBytesB64: String,
        sender: String,
        kind: String,
        intent: String
    ) async throws -> SignedSubmission {
        let sponsorBody: [String: Any] = [
            "ptbBytesB64": ptbBytesB64,
            "sender": sender,
        ]
        let sponsor = try await postAuthenticated(
            path: "/api/zk/sponsor",
            body: sponsorBody
        )
        guard let txBytes = sponsor["txBytes"] as? String,
              let sponsorSig = sponsor["sponsorSignature"] as? String,
              let txBytesData = Data(base64Encoded: txBytes) else {
            throw CoordinatorError.sponsorFailed("malformed sponsor response")
        }

        // Sui intent prefix: TransactionData(0) + V0(0) + Sui(0).
        let intentMessage = Data([0, 0, 0]) + txBytesData
        let key = try EphemeralKeyStore.shared.loadOrCreate()
        let rawSig = try key.signature(for: intentMessage)
        let pubKey = key.publicKey.rawRepresentation
        // Sui SerializedSignature: 0x00 flag (Ed25519) + sig + pubkey
        let userSig = (Data([0x00]) + rawSig + pubKey).base64EncodedString()

        let executeBody: [String: Any] = [
            "txBytes": txBytes,
            "userSignature": userSig,
            "sponsorSignature": sponsorSig,
            "kind": kind,
        ]
        let exec = try await postAuthenticated(
            path: "/api/zk/sponsor-execute",
            body: executeBody
        )
        if let success = exec["success"] as? Bool, !success {
            throw CoordinatorError.executeFailed(exec["error"] as? String ?? "unknown")
        }
        guard let digest = exec["digest"] as? String else {
            throw CoordinatorError.executeFailed("no digest in response")
        }
        return SignedSubmission(digest: digest)
    }

    // MARK: - Helpers

    private func fetchMaxEpoch() async -> Int? {
        struct Response: Decodable { let maxEpoch: Int }
        do {
            let r: Response = try await APIClient.shared.get("/api/sui/epoch")
            return r.maxEpoch
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
