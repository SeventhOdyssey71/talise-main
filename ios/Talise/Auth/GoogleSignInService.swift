import Foundation
import AuthenticationServices
import UIKit

/// Google OAuth via the Talise backend's web OAuth client.
///
/// Why this is server-mediated instead of direct PKCE: zkLogin derives
/// the Sui address from the JWT's (iss, aud, sub) tuple via Shinami's
/// salt service. If the iOS app uses its own OAuth client (with its
/// own client_id, ie its own `aud` claim), Shinami returns a different
/// wallet than the web product does for the same Google account. The
/// user signs in on web and iOS with the same email and gets two
/// different Sui addresses — confusing and breaks send-to-self flows.
///
/// To unify: open `${apiBase}/api/auth/mobile/start` in an
/// ASWebAuthenticationSession. The backend runs OAuth against the
/// existing WEB client_id + secret, /auth/callback recognizes the
/// `m1.*` state prefix, mints a mobile bearer, and redirects to
/// `talise://auth/callback?token=…&userId=…`. The JWT's `aud` is
/// GOOGLE_CLIENT_ID (web), so Shinami returns the canonical web
/// wallet — same address as web sign-ins.
@MainActor
final class GoogleSignInService: NSObject, ASWebAuthenticationPresentationContextProviding {

    struct Result {
        let bearer: String
        let userId: String
    }

    enum SignInError: LocalizedError {
        case cancelled
        case configMissing
        case malformedRedirect
        case oauth(String)

        var errorDescription: String? {
            switch self {
            case .cancelled: return "Sign-in was cancelled."
            case .configMissing: return "Backend URL is not configured."
            case .malformedRedirect: return "Sign-in redirect was malformed."
            case .oauth(let s): return "Google: \(s)"
            }
        }
    }

    private var session: ASWebAuthenticationSession?

    /// `ephemeralPubKeyB64` is the device's Curve25519 ephemeral public
    /// key. The backend binds it to the OAuth state so a hostile
    /// redirect can't swap in a different key.
    ///
    /// Sent as base64URL (RFC 4648 §5) rather than standard base64.
    /// Standard base64 contains `+`, which travels through a URL
    /// query string just fine but gets decoded back to a SPACE by
    /// Next.js's URLSearchParams — corrupting the bytes server-side.
    /// base64URL uses `-` and `_` instead, which survive any URL
    /// parser cleanly.
    func signIn(ephemeralPubKeyB64: String) async throws -> Result {
        let base = AppConfig.shared.apiBaseURL
        guard !base.isEmpty else { throw SignInError.configMissing }

        let urlSafe = ephemeralPubKeyB64
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")

        var components = URLComponents(string: base + "/api/auth/mobile/start")!
        components.queryItems = [
            URLQueryItem(name: "ephemeralPubKey", value: urlSafe),
        ]
        guard let startURL = components.url else {
            throw SignInError.configMissing
        }

        return try await withCheckedThrowingContinuation { cont in
            let session = ASWebAuthenticationSession(
                url: startURL,
                callbackURLScheme: "talise"
            ) { callbackURL, error in
                if let error {
                    let ns = error as NSError
                    if ns.code == ASWebAuthenticationSessionError.canceledLogin.rawValue {
                        cont.resume(throwing: SignInError.cancelled)
                    } else {
                        cont.resume(throwing: SignInError.oauth(error.localizedDescription))
                    }
                    return
                }
                guard let callbackURL else {
                    cont.resume(throwing: SignInError.malformedRedirect)
                    return
                }
                let items = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false)?
                    .queryItems ?? []
                let pairs = Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value ?? "") })
                if let err = pairs["err"] ?? pairs["error"], !err.isEmpty {
                    cont.resume(throwing: SignInError.oauth(err))
                    return
                }
                guard let bearer = pairs["token"], !bearer.isEmpty,
                      let userId = pairs["userId"], !userId.isEmpty else {
                    cont.resume(throwing: SignInError.malformedRedirect)
                    return
                }
                cont.resume(returning: Result(bearer: bearer, userId: userId))
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            self.session = session
            session.start()
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow } ?? ASPresentationAnchor()
    }
}
