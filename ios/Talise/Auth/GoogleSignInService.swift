import Foundation
import AuthenticationServices
import UIKit

/// Drives the OAuth dance against the existing /web backend.
///
/// Strategy: open ASWebAuthenticationSession at
/// `${API}/auth/google?mobile=1&nonce=<n>&ephemeralPubKey=<b64>`. Backend
/// owns the entire Google + Shinami + DB flow exactly as it does for web,
/// then redirects to `talise://auth/callback?token=<bearer>&userId=<id>`.
///
/// We catch the redirect, persist the token via SecureSessionStore, and
/// surface the userId to the AppRoot coordinator.
@MainActor
final class GoogleSignInService: NSObject, ASWebAuthenticationPresentationContextProviding {

    struct SignInResult {
        let bearer: String
        let userId: String
    }

    enum SignInError: Error {
        case cancelled
        case malformedRedirect
        case underlying(Error)
    }

    func signIn(nonce: String, ephemeralPubKeyB64: String) async throws -> SignInResult {
        var components = URLComponents(string: AppConfig.shared.apiBaseURL + "/auth/google")!
        components.queryItems = [
            URLQueryItem(name: "mobile", value: "1"),
            URLQueryItem(name: "nonce", value: nonce),
            URLQueryItem(name: "ephemeralPubKey", value: ephemeralPubKeyB64),
        ]
        guard let authURL = components.url else { throw SignInError.malformedRedirect }

        return try await withCheckedThrowingContinuation { cont in
            let session = ASWebAuthenticationSession(
                url: authURL,
                callbackURLScheme: "talise"
            ) { callbackURL, error in
                if let error {
                    let nsErr = error as NSError
                    if nsErr.code == ASWebAuthenticationSessionError.canceledLogin.rawValue {
                        cont.resume(throwing: SignInError.cancelled)
                    } else {
                        cont.resume(throwing: SignInError.underlying(error))
                    }
                    return
                }
                guard let url = callbackURL,
                      let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
                      let bearer = items.first(where: { $0.name == "token" })?.value,
                      let userId = items.first(where: { $0.name == "userId" })?.value else {
                    cont.resume(throwing: SignInError.malformedRedirect)
                    return
                }
                cont.resume(returning: SignInResult(bearer: bearer, userId: userId))
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
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
