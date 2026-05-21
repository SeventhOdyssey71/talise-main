import Foundation
import AuthenticationServices
import CryptoKit
import UIKit

/// Direct Google OAuth from the iOS app using PKCE. Returns the raw
/// id_token (a JWT) on success; the rest of the zkLogin pipeline lives
/// in ZkLoginCoordinator, which trades the id_token for a Talise mobile
/// bearer (and a pre-warmed proof) at /api/auth/mobile/exchange.
///
/// Why PKCE: Google's iOS OAuth client type doesn't accept a client
/// secret, and the implicit id_token flow is blocked for iOS clients.
/// PKCE proves the request originated from the same caller that started
/// the flow, replacing the need for the secret.
@MainActor
final class GoogleSignInService: NSObject, ASWebAuthenticationPresentationContextProviding {

    struct OAuthResult {
        /// JWT id_token from Google. Audience is googleClientID; sub is the
        /// stable Google user id; nonce binds the JWT to this OAuth flow.
        let idToken: String
        /// 16-byte decimal-string randomness, bound to the JWT via nonce.
        /// Used as the `jwtRandomness` parameter to the zkLogin prover.
        let jwtRandomness: String
    }

    enum SignInError: LocalizedError {
        case cancelled
        case configMissing
        case oauth(String)
        case tokenExchange(String)

        var errorDescription: String? {
            switch self {
            case .cancelled: return "Sign-in was cancelled."
            case .configMissing: return "Google client ID is not configured."
            case .oauth(let s): return "Google: \(s)"
            case .tokenExchange(let s): return "Token exchange: \(s)"
            }
        }
    }

    private var session: ASWebAuthenticationSession?

    func signIn() async throws -> OAuthResult {
        guard !AppConfig.shared.googleClientID.isEmpty else {
            throw SignInError.configMissing
        }
        let clientID = AppConfig.shared.googleClientID

        // Reversed client ID redirect, e.g. com.googleusercontent.apps.123:/oauthredirect
        let suffix = ".apps.googleusercontent.com"
        guard clientID.hasSuffix(suffix) else { throw SignInError.configMissing }
        let prefix = String(clientID.dropLast(suffix.count))
        let redirectURI = "com.googleusercontent.apps.\(prefix):/oauthredirect"
        let redirectScheme = "com.googleusercontent.apps.\(prefix)"

        // PKCE + state + nonce
        let state = Self.randomString(length: 16)
        let nonce = Self.randomString(length: 16)
        let codeVerifier = Self.randomString(length: 64)
        let codeChallenge = Self.pkceChallenge(verifier: codeVerifier)
        let jwtRandomness = SuiRandomness.generate()

        var components = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        components.queryItems = [
            URLQueryItem(name: "client_id", value: clientID),
            URLQueryItem(name: "redirect_uri", value: redirectURI),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: "openid email profile"),
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "nonce", value: nonce),
            URLQueryItem(name: "code_challenge", value: codeChallenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
        ]
        guard let authURL = components.url else {
            throw SignInError.configMissing
        }

        let authCode: String = try await withCheckedThrowingContinuation { cont in
            let session = ASWebAuthenticationSession(
                url: authURL,
                callbackURLScheme: redirectScheme
            ) { callbackURL, error in
                if let error {
                    let nsErr = error as NSError
                    if nsErr.code == ASWebAuthenticationSessionError.canceledLogin.rawValue {
                        cont.resume(throwing: SignInError.cancelled)
                    } else {
                        cont.resume(throwing: SignInError.oauth(error.localizedDescription))
                    }
                    return
                }
                guard let callbackURL else {
                    cont.resume(throwing: SignInError.oauth("missing callback"))
                    return
                }
                let items = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false)?.queryItems ?? []
                let pairs = Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value ?? "") })
                if let err = pairs["error"], !err.isEmpty {
                    cont.resume(throwing: SignInError.oauth(pairs["error_description"] ?? err))
                    return
                }
                if pairs["state"] != state {
                    cont.resume(throwing: SignInError.oauth("state mismatch"))
                    return
                }
                guard let code = pairs["code"], !code.isEmpty else {
                    cont.resume(throwing: SignInError.oauth("missing code"))
                    return
                }
                cont.resume(returning: code)
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            self.session = session
            session.start()
        }

        let idToken = try await Self.exchangeCodeForIdToken(
            code: authCode,
            codeVerifier: codeVerifier,
            clientID: clientID,
            redirectURI: redirectURI
        )
        return OAuthResult(idToken: idToken, jwtRandomness: jwtRandomness)
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow } ?? ASPresentationAnchor()
    }

    // MARK: - Helpers

    private static func exchangeCodeForIdToken(
        code: String,
        codeVerifier: String,
        clientID: String,
        redirectURI: String
    ) async throws -> String {
        var req = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        req.timeoutInterval = 15
        var body = URLComponents()
        body.queryItems = [
            URLQueryItem(name: "client_id", value: clientID),
            URLQueryItem(name: "code", value: code),
            URLQueryItem(name: "code_verifier", value: codeVerifier),
            URLQueryItem(name: "grant_type", value: "authorization_code"),
            URLQueryItem(name: "redirect_uri", value: redirectURI),
        ]
        req.httpBody = body.percentEncodedQuery?.data(using: .utf8)
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw SignInError.tokenExchange(String(data: data, encoding: .utf8) ?? "non-2xx")
        }
        guard let parsed = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let idToken = parsed["id_token"] as? String else {
            throw SignInError.tokenExchange("missing id_token in response")
        }
        return idToken
    }

    private static func randomString(length: Int) -> String {
        let chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
        return String((0..<length).map { _ in chars.randomElement()! })
    }

    private static func pkceChallenge(verifier: String) -> String {
        let hash = SHA256.hash(data: Data(verifier.utf8))
        return Data(hash).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
