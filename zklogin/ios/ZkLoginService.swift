import Foundation
import AuthenticationServices
import CryptoKit
import SwiftUI
import UIKit

/// One-tap sign-in via Google + Sui zkLogin.
///
/// Responsibilities:
///   1. OAuth round-trip through Google (ASWebAuthenticationSession).
///   2. Generate + persist an ephemeral Ed25519 keypair (Curve25519 via
///      CryptoKit) so the user can sign transactions during the session.
///   3. Generate + persist a 16-byte user salt (Keychain).
///   4. Call the local bridge for the cryptographic heavy lifting that
///      Swift can't do natively (Poseidon hash for the address seed,
///      Blake2b for the final address, BCS encoding for tx signing).
///   5. Expose the derived Sui address so WalletService can plug it into
///      the existing connect flow.
///
/// Why a bridge: zkLogin's address derivation needs Poseidon (a ZK-friendly
/// hash) and the signature path needs BCS encoding. Neither is available
/// in iOS standard libraries. The bridge is a stateless ~80-line Node
/// service that uses @mysten/sui to perform those operations. The user's
/// secrets (ephemeral private key, salt) never leave the device.
@MainActor
final class ZkLoginService: NSObject, ObservableObject {
    static let shared = ZkLoginService()

    enum Status: Equatable {
        case idle
        case signingIn
        case ready(suiAddress: String)
        case failed(message: String)
    }

    @Published private(set) var status: Status = .idle

    // MARK: - Config (replace at deploy time)

    /// Google OAuth iOS Client ID. Register at console.cloud.google.com
    /// with Application type = iOS, Bundle ID = com.cible.CibleApp.
    /// Example value: "123456789-abcdef0123.apps.googleusercontent.com"
    static let googleClientID = "786432206940-hb9nbm7ie4p40g6vcseb15lnh2a870k2.apps.googleusercontent.com"

    /// Google's iOS OAuth clients use a reversed-client-ID redirect URI.
    /// Computed from `googleClientID`: strip the ".apps.googleusercontent.com"
    /// suffix, reverse the dot-separated halves, append ":/oauthredirect".
    ///
    /// Also: the reversed prefix must be registered as a URL scheme in
    /// Info.plist (CFBundleURLSchemes) so iOS routes the callback back to
    /// the app.
    static var redirectURI: String {
        let suffix = ".apps.googleusercontent.com"
        guard googleClientID.hasSuffix(suffix) else { return "" }
        let prefix = String(googleClientID.dropLast(suffix.count))
        return "com.googleusercontent.apps.\(prefix):/oauthredirect"
    }

    /// The URL scheme portion (without ":/oauthredirect"). Pass this as
    /// `callbackURLScheme` to ASWebAuthenticationSession.
    static var redirectScheme: String {
        let suffix = ".apps.googleusercontent.com"
        guard googleClientID.hasSuffix(suffix) else { return "" }
        let prefix = String(googleClientID.dropLast(suffix.count))
        return "com.googleusercontent.apps.\(prefix)"
    }

    /// Bridge service. Stateless. Per-network so a mainnet deploy can point
    /// at a separate hosted bridge if needed.
    static var bridgeBaseURL: URL { NetworkConfig.shared.current.bridgeBaseURL }

    /// Mysten prover endpoint. Sourced from NetworkConfig so the current
    /// network (testnet/mainnet) determines which prover answers.
    static var proverURL: URL { NetworkConfig.shared.current.zkProverURL }

    /// The current Sui epoch the proof is valid for. Production code should
    /// fetch `sui_getLatestSuiSystemState` and use `epoch + maxEpochOffset`.
    static let defaultMaxEpoch: UInt64 = 1_000_000

    // MARK: - Persisted state (Keychain)

    private let keychain = ZkLoginKeychain.shared
    private var ephemeralKey: Curve25519.Signing.PrivateKey?
    private var salt: String?
    private var jwt: String?
    private var jwtRandomness: String?

    // MARK: - Public read-only accessors

    var isAuthenticated: Bool {
        if case .ready = status { return true }
        return false
    }

    var connectedAddress: String? {
        if case let .ready(addr) = status { return addr }
        return nil
    }

    // MARK: - OAuth session (retained)

    private var authSession: ASWebAuthenticationSession?

    // MARK: - Lifecycle

    private override init() {
        super.init()
        // Restore prior session if Keychain has one. We rehydrate the JWT,
        // salt, ephemeral key, and randomness so that signing can resume
        // after the app is killed and relaunched (until the JWT expires).
        let storedJWT = keychain.loadString(key: "cible.zkLoginJWT")
        if let storedJWT, Self.jwtIsExpired(storedJWT) {
            // Stale credentials: require re-sign-in.
            keychain.deleteAll()
            return
        }
        self.jwt = storedJWT
        self.salt = keychain.loadString(key: "cible.zkLoginSalt")
        self.jwtRandomness = keychain.loadString(key: "cible.zkLoginRandomness")
        if let raw = keychain.load(key: "cible.zkLoginEphemeralKey"),
           let key = try? Curve25519.Signing.PrivateKey(rawRepresentation: raw) {
            self.ephemeralKey = key
        }
        if let savedAddr = UserDefaults.standard.string(forKey: "cible.zkLoginAddress"), storedJWT != nil {
            status = .ready(suiAddress: savedAddr)
        }
    }

    // MARK: - Public API

    /// Kicks off Google OAuth, prover call, address derivation. On success,
    /// `status` becomes `.ready(suiAddress:)`.
    func signInWithGoogle() {
        status = .signingIn
        Task {
            do {
                let jwt = try await runGoogleOAuth()
                self.jwt = jwt
                keychain.saveString(key: "cible.zkLoginJWT", value: jwt)

                let salt = loadOrCreateSalt()
                self.salt = salt

                let key = loadOrCreateEphemeralKey()
                self.ephemeralKey = key

                let randomness = loadOrCreateJWTRandomness()
                self.jwtRandomness = randomness

                let suiAddress = try await deriveSuiAddress(jwt: jwt, salt: salt)
                UserDefaults.standard.set(suiAddress, forKey: "cible.zkLoginAddress")
                status = .ready(suiAddress: suiAddress)
            } catch {
                status = .failed(message: error.localizedDescription)
            }
        }
    }

    func signOut() {
        ephemeralKey = nil
        salt = nil
        jwt = nil
        jwtRandomness = nil
        UserDefaults.standard.removeObject(forKey: "cible.zkLoginAddress")
        keychain.deleteAll()
        status = .idle
    }

    /// Signs a transaction PTB (BCS bytes, base64) using zkLogin and submits
    /// it to the Sui RPC. Returns the transaction digest. Throws if any step
    /// fails (OAuth lapsed, prover unreachable, RPC rejection, effects not
    /// success). Callers are expected to verify `isAuthenticated == true`
    /// before invoking.
    func signAndSubmit(ptbBcsBytesB64: String) async throws -> String {
        guard isAuthenticated else {
            throw ZkLoginError.invalidConfig("not authenticated")
        }
        return try await performSignFlow(ptbBcsBytesB64: ptbBcsBytesB64)
    }

    /// Builds a single-MoveCall PTB via the bridge and returns the BCS bytes
    /// (base64). Swift cannot build BCS PTBs natively, so the bridge handles
    /// argument encoding and serialization.
    func buildPtbViaBridge(
        sender: String,
        packageId: String,
        module: String,
        function: String,
        typeArgs: [String],
        args: [Any]
    ) async throws -> String {
        let url = Self.bridgeBaseURL.appendingPathComponent("tx/build")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.timeoutInterval = 15
        let body: [String: Any] = [
            "sender": sender,
            "packageId": packageId,
            "module": module,
            "function": function,
            "typeArgs": typeArgs,
            "args": args,
        ]
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw ZkLoginError.bridgeFailed("tx/build returned non-2xx")
        }
        guard let parsed = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let bytes = parsed["txBytesB64"] as? String else {
            throw ZkLoginError.bridgeFailed("tx/build malformed response")
        }
        return bytes
    }

    // MARK: - OAuth (ASWebAuthenticationSession)

    private func runGoogleOAuth() async throws -> String {
        // Google's iOS OAuth client type requires the authorization code
        // flow with PKCE. The implicit id_token flow is blocked for iOS
        // clients with "unsupported_response_type". So: generate a PKCE
        // verifier/challenge, get back a code, exchange it for an id_token.
        let state = randomString(length: 16)
        let nonce = randomString(length: 16)
        let codeVerifier = randomString(length: 64)
        let codeChallenge = pkceChallenge(from: codeVerifier)

        var components = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        components.queryItems = [
            URLQueryItem(name: "client_id", value: Self.googleClientID),
            URLQueryItem(name: "redirect_uri", value: Self.redirectURI),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: "openid email profile"),
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "nonce", value: nonce),
            URLQueryItem(name: "code_challenge", value: codeChallenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
        ]
        guard let authURL = components.url else {
            throw ZkLoginError.invalidConfig("could not build Google auth URL")
        }

        let authCode: String = try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(
                url: authURL,
                callbackURLScheme: Self.redirectScheme
            ) { [weak self] callbackURL, error in
                self?.authSession = nil
                if let error {
                    continuation.resume(throwing: ZkLoginError.oauthFailed(error.localizedDescription))
                    return
                }
                guard let callbackURL else {
                    continuation.resume(throwing: ZkLoginError.oauthFailed("no callback URL"))
                    return
                }

                // Code flow returns the code in the query string, not the fragment.
                let qItems = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false)?
                    .queryItems ?? []
                let pairs = Dictionary(uniqueKeysWithValues: qItems.map { ($0.name, $0.value ?? "") })

                if let returnedError = pairs["error"], !returnedError.isEmpty {
                    let desc = pairs["error_description"] ?? returnedError
                    continuation.resume(throwing: ZkLoginError.oauthFailed("Google: \(desc)"))
                    return
                }
                if let returnedState = pairs["state"], returnedState != state {
                    continuation.resume(throwing: ZkLoginError.oauthFailed("state mismatch"))
                    return
                }
                guard let code = pairs["code"], !code.isEmpty else {
                    continuation.resume(throwing: ZkLoginError.oauthFailed("no code in callback"))
                    return
                }
                continuation.resume(returning: code)
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            self.authSession = session
            session.start()
        }

        // Exchange the code for an id_token. Google's iOS OAuth clients do
        // NOT require a client_secret (unlike Web clients) — PKCE alone
        // proves the request is from the original caller.
        let idToken = try await exchangeCodeForIdToken(code: authCode, codeVerifier: codeVerifier)
        return idToken
    }

    // MARK: - Ephemeral key + salt management

    private func loadOrCreateEphemeralKey() -> Curve25519.Signing.PrivateKey {
        if let raw = keychain.load(key: "cible.zkLoginEphemeralKey"),
           let key = try? Curve25519.Signing.PrivateKey(rawRepresentation: raw) {
            return key
        }
        let new = Curve25519.Signing.PrivateKey()
        keychain.save(key: "cible.zkLoginEphemeralKey", data: new.rawRepresentation)
        return new
    }

    private func loadOrCreateSalt() -> String {
        if let saved = keychain.loadString(key: "cible.zkLoginSalt") {
            return saved
        }
        // Sui zkLogin expects salt as a decimal string fitting in BN254 scalar field.
        // Generate 16 random bytes, interpret as big-endian, convert to decimal.
        var bytes = [UInt8](repeating: 0, count: 16)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        let decimal = bytesToDecimalString(bytes)
        keychain.saveString(key: "cible.zkLoginSalt", value: decimal)
        return decimal
    }

    private func loadOrCreateJWTRandomness() -> String {
        if let saved = keychain.loadString(key: "cible.zkLoginRandomness") {
            return saved
        }
        // Mirror salt format: 16 random bytes, decimal string.
        var bytes = [UInt8](repeating: 0, count: 16)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        let decimal = bytesToDecimalString(bytes)
        keychain.saveString(key: "cible.zkLoginRandomness", value: decimal)
        return decimal
    }

    private func bytesToDecimalString(_ bytes: [UInt8]) -> String {
        // Convert byte array (big-endian) to a base-10 string. Pure Swift,
        // no BigInt dependency: repeated-divide-by-10 over the byte array.
        var digits = bytes
        var result = ""
        while !digits.allSatisfy({ $0 == 0 }) {
            var remainder: UInt32 = 0
            for i in 0..<digits.count {
                let current = (UInt32(remainder) << 8) | UInt32(digits[i])
                digits[i] = UInt8(current / 10)
                remainder = current % 10
            }
            result = "\(remainder)" + result
        }
        return result.isEmpty ? "0" : result
    }

    // MARK: - Address derivation (via bridge)

    private func deriveSuiAddress(jwt: String, salt: String) async throws -> String {
        let url = Self.bridgeBaseURL.appendingPathComponent("zklogin/address")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.timeoutInterval = 10
        let body: [String: Any] = [
            "jwt": jwt,
            "salt": salt,
            "keyClaimName": "sub",
        ]
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw ZkLoginError.bridgeFailed("bridge returned non-2xx")
        }
        guard let parsed = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let addr = parsed["address"] as? String,
              addr.hasPrefix("0x") else {
            throw ZkLoginError.bridgeFailed("bridge returned malformed address")
        }
        return addr
    }

    // MARK: - Sign + submit flow

    /// 5-step zkLogin signing:
    /// 1. Sign Sui intent message with the ephemeral Ed25519 key.
    /// 2. Fetch ZK proof from the Mysten prover.
    /// 3. Wrap proof + ephemeral signature into a zkLoginSignature via bridge.
    /// 4. Submit the tx bytes + zkLoginSignature via sui_executeTransactionBlock.
    /// 5. Return the digest if effects.status == "success".
    private func performSignFlow(ptbBcsBytesB64: String) async throws -> String {
        guard let jwt = jwt,
              let salt = salt,
              let ephemeralKey = ephemeralKey,
              let jwtRandomness = jwtRandomness else {
            throw ZkLoginError.invalidConfig("missing session credentials")
        }

        // Step 1: ephemeral signature over the intent message.
        guard let txBytes = Data(base64Encoded: ptbBcsBytesB64) else {
            throw ZkLoginError.invalidConfig("ptbBcsBytesB64 not valid base64")
        }
        // Sui intent prefix: TransactionData=0, V0=0, Sui=0.
        let intentMessage = Data([0, 0, 0]) + txBytes
        let rawSig = try ephemeralKey.signature(for: intentMessage)
        let pubkeyBytes = ephemeralKey.publicKey.rawRepresentation
        // 0x00 flag byte = Ed25519 signature scheme.
        let userSignatureB64 = (Data([0x00]) + rawSig + pubkeyBytes).base64EncodedString()
        let ephemeralPubKeyB64 = pubkeyBytes.base64EncodedString()

        // Step 2: ZK proof from Mysten prover.
        let proof = try await fetchZkProof(
            jwt: jwt,
            ephemeralPubKeyB64: ephemeralPubKeyB64,
            jwtRandomness: jwtRandomness,
            salt: salt
        )

        // Step 3: wrap into a zkLoginSignature via bridge.
        let zkLoginSignatureB64 = try await wrapZkLoginSignature(
            jwt: jwt,
            salt: salt,
            ephemeralPubKeyB64: ephemeralPubKeyB64,
            jwtRandomness: jwtRandomness,
            proof: proof,
            userSignatureB64: userSignatureB64
        )

        // Step 4 + 5: submit and return digest.
        return try await submitTransaction(
            txBytesB64: ptbBcsBytesB64,
            signatureB64: zkLoginSignatureB64
        )
    }

    private func fetchZkProof(
        jwt: String,
        ephemeralPubKeyB64: String,
        jwtRandomness: String,
        salt: String
    ) async throws -> [String: Any] {
        var req = URLRequest(url: Self.proverURL)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.timeoutInterval = 30
        let body: [String: Any] = [
            "jwt": jwt,
            "extendedEphemeralPublicKey": ephemeralPubKeyB64,
            "maxEpoch": Self.defaultMaxEpoch,
            "jwtRandomness": jwtRandomness,
            "salt": salt,
            "keyClaimName": "sub",
        ]
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let msg = String(data: data, encoding: .utf8) ?? "non-2xx"
            throw ZkLoginError.proverFailed(msg)
        }
        guard let parsed = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw ZkLoginError.proverFailed("malformed prover response")
        }
        return parsed
    }

    private func wrapZkLoginSignature(
        jwt: String,
        salt: String,
        ephemeralPubKeyB64: String,
        jwtRandomness: String,
        proof: [String: Any],
        userSignatureB64: String
    ) async throws -> String {
        let url = Self.bridgeBaseURL.appendingPathComponent("zklogin/sign")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.timeoutInterval = 15
        let body: [String: Any] = [
            "jwt": jwt,
            "salt": salt,
            "ephemeralPubKeyB64": ephemeralPubKeyB64,
            "maxEpoch": Self.defaultMaxEpoch,
            "jwtRandomness": jwtRandomness,
            "proof": proof,
            "userSignatureB64": userSignatureB64,
            "keyClaimName": "sub",
        ]
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw ZkLoginError.bridgeFailed("zklogin/sign returned non-2xx")
        }
        guard let parsed = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let signature = parsed["signature"] as? String else {
            throw ZkLoginError.bridgeFailed("zklogin/sign malformed response")
        }
        return signature
    }

    private func submitTransaction(txBytesB64: String, signatureB64: String) async throws -> String {
        let rpcURL = SuiRPC.shared.rpcURL
        var req = URLRequest(url: rpcURL)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.timeoutInterval = 30
        let params: [Any] = [
            txBytesB64,
            [signatureB64],
            ["showEffects": true],
            "WaitForLocalExecution",
        ]
        let body: [String: Any] = [
            "jsonrpc": "2.0",
            "id": 1,
            "method": "sui_executeTransactionBlock",
            "params": params,
        ]
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw ZkLoginError.bridgeFailed("RPC returned non-2xx")
        }
        guard let envelope = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw ZkLoginError.bridgeFailed("malformed RPC envelope")
        }
        if let err = envelope["error"] as? [String: Any] {
            let msg = err["message"] as? String ?? "unknown"
            throw ZkLoginError.bridgeFailed("RPC error: \(msg)")
        }
        guard let result = envelope["result"] as? [String: Any],
              let digest = result["digest"] as? String else {
            throw ZkLoginError.bridgeFailed("RPC missing digest")
        }
        if let effects = result["effects"] as? [String: Any],
           let status = effects["status"] as? [String: Any],
           let statusStr = status["status"] as? String,
           statusStr != "success" {
            let errMsg = (status["error"] as? String) ?? "tx not successful"
            throw ZkLoginError.bridgeFailed(errMsg)
        }
        return digest
    }

    // MARK: - JWT expiry

    /// Parses the `exp` claim from a JWT (no signature verification — server
    /// verifies signatures, this is purely a freshness check). Returns true
    /// if expired or unparseable.
    private static func jwtIsExpired(_ jwt: String) -> Bool {
        let parts = jwt.split(separator: ".")
        guard parts.count == 3 else { return true }
        let payload = String(parts[1])
        // Base64URL decode (JWTs use URL-safe base64 without padding).
        var b64 = payload
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        while b64.count % 4 != 0 { b64.append("=") }
        guard let data = Data(base64Encoded: b64),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let exp = dict["exp"] as? Double else {
            return true
        }
        return Date().timeIntervalSince1970 >= exp
    }

    // MARK: - Utilities

    private func randomString(length: Int) -> String {
        let chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
        return String((0..<length).map { _ in chars.randomElement()! })
    }

    // MARK: - PKCE

    /// RFC 7636 PKCE challenge: base64url(SHA256(verifier)), no padding.
    private func pkceChallenge(from verifier: String) -> String {
        let hash = SHA256.hash(data: Data(verifier.utf8))
        return Data(hash).base64URLEncodedString()
    }

    /// Exchange the auth code for an id_token (the JWT we feed to zkLogin).
    private func exchangeCodeForIdToken(code: String, codeVerifier: String) async throws -> String {
        let tokenURL = URL(string: "https://oauth2.googleapis.com/token")!
        var req = URLRequest(url: tokenURL)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        req.timeoutInterval = 15

        var body = URLComponents()
        body.queryItems = [
            URLQueryItem(name: "client_id", value: Self.googleClientID),
            URLQueryItem(name: "code", value: code),
            URLQueryItem(name: "code_verifier", value: codeVerifier),
            URLQueryItem(name: "grant_type", value: "authorization_code"),
            URLQueryItem(name: "redirect_uri", value: Self.redirectURI),
        ]
        req.httpBody = body.percentEncodedQuery?.data(using: .utf8)

        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let msg = String(data: data, encoding: .utf8) ?? "non-2xx"
            throw ZkLoginError.oauthFailed("token exchange failed: \(msg)")
        }
        guard let parsed = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let idToken = parsed["id_token"] as? String else {
            throw ZkLoginError.oauthFailed("token endpoint missing id_token")
        }
        return idToken
    }
}

private extension Data {
    /// Base64URL without padding, per RFC 4648 §5.
    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

// MARK: - Errors

enum ZkLoginError: LocalizedError {
    case invalidConfig(String)
    case oauthFailed(String)
    case proverFailed(String)
    case bridgeFailed(String)

    var errorDescription: String? {
        switch self {
        case .invalidConfig(let msg): return "zkLogin config: \(msg)"
        case .oauthFailed(let msg): return "Sign-in failed: \(msg)"
        case .proverFailed(let msg): return "Prover failed: \(msg)"
        case .bridgeFailed(let msg): return "Bridge failed: \(msg)"
        }
    }
}

// MARK: - Presentation context for ASWebAuthenticationSession

extension ZkLoginService: ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        // Find the active window. iOS 15+ via UIWindowScene.
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first
        let window = scene?.windows.first(where: { $0.isKeyWindow })
            ?? scene?.windows.first
            ?? UIWindow()
        return window
    }
}

// MARK: - Keychain helper (scoped to zkLogin keys only)

private final class ZkLoginKeychain {
    static let shared = ZkLoginKeychain()
    private init() {}

    private let service = "app.cible.zkLogin"

    func save(key: String, data: Data) {
        delete(key: key)
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]
        SecItemAdd(q as CFDictionary, nil)
    }

    func saveString(key: String, value: String) {
        save(key: key, data: Data(value.utf8))
    }

    func load(key: String) -> Data? {
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(q as CFDictionary, &result)
        if status == errSecSuccess, let data = result as? Data { return data }
        return nil
    }

    func loadString(key: String) -> String? {
        guard let data = load(key: key) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    func delete(key: String) {
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(q as CFDictionary)
    }

    func deleteAll() {
        delete(key: "cible.zkLoginEphemeralKey")
        delete(key: "cible.zkLoginSalt")
        delete(key: "cible.zkLoginJWT")
        delete(key: "cible.zkLoginRandomness")
    }
}
