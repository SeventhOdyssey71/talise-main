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
        case onboarding(userId: String)
        case ready(user: UserDTO)
        case locked
    }

    var phase: Phase = .launching
    var lastError: String?

    func bootstrap() async {
        if !SecureSessionStore.shared.hasToken() {
            phase = .signedOut
            return
        }
        do {
            let me: UserDTO = try await APIClient.shared.get("/api/me")
            if me.accountType == nil {
                phase = .onboarding(userId: me.id)
            } else {
                phase = .ready(user: me)
                Task { try? await AppAttestService.shared.bootstrap(
                    bearer: SecureSessionStore.shared.read(),
                    apiBaseURL: AppConfig.shared.apiBaseURL
                ) }
            }
        } catch APIError.unauthorized {
            SecureSessionStore.shared.clear()
            phase = .signedOut
        } catch {
            lastError = error.localizedDescription
            phase = .signedOut
        }
    }

    func signOut() {
        SecureSessionStore.shared.clear()
        EphemeralKeyStore.shared.wipe()
        phase = .signedOut
    }

    func handleSignInSuccess(bearer: String, userId: String) async {
        do {
            try SecureSessionStore.shared.save(token: bearer)
            await bootstrap()
        } catch {
            lastError = error.localizedDescription
            phase = .signedOut
        }
    }
}
