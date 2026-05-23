import Foundation
import SwiftUI

/// Single observable describing app-wide state. Read from views via
/// `@Environment(AppSession.self)`. Mutations happen through methods on
/// this type so we keep state transitions explicit.
@MainActor
@Observable
final class AppSession {
    enum Phase: Equatable {
        case launching
        case signedOut
        case onboarding(user: UserDTO)
        case ready(user: UserDTO)
        case locked
    }

    var phase: Phase = .launching
    var lastError: String?

    func bootstrap() async {
        guard SecureSessionStore.shared.hasToken() else {
            phase = .signedOut
            return
        }
        do {
            let me: UserDTO = try await APIClient.shared.get("/api/me")
            if me.accountType == nil {
                phase = .onboarding(user: me)
            } else {
                phase = .ready(user: me)
                // Returning users — their bearer survived but the
                // ProofCache might be cold (esp. if it predates the
                // Keychain persistence). Warm it in the background so
                // the first Send doesn't fail with "no proof cache".
                Task { await ZkLoginCoordinator.shared.ensureProofWarm() }
                // FX rates for the display-currency picker. Soft-fails
                // to USD-only if /api/fx is unreachable.
                Task { await CurrencySettings.shared.refresh() }
            }
        } catch APIError.unauthorized {
            SecureSessionStore.shared.clear()
            phase = .signedOut
        } catch {
            // No /me yet (404) or transient network issue — fall back to
            // signed-out rather than wedging launch. User can re-auth.
            SecureSessionStore.shared.clear()
            phase = .signedOut
        }
    }

    func signOut() {
        SecureSessionStore.shared.clear()
        EphemeralKeyStore.shared.wipe()
        ProofCache.shared.clear()
        phase = .signedOut
    }

    /// Called by SignInView after ZkLoginCoordinator.signIn() returns.
    func handleSignedIn(user: UserDTO) {
        if user.accountType == nil {
            phase = .onboarding(user: user)
        } else {
            phase = .ready(user: user)
        }
    }
}
