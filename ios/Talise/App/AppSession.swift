import Foundation
import SwiftUI

/// Single observable describing app-wide state. Read from views via
/// `@Environment(AppSession.self)`. Mutations happen through methods on
/// this type so we keep state transitions explicit.
///
/// SESSION MODEL (2026-07): a signed-in session is PERSISTED and reused across
/// launches for up to ~3 days (matching the zkLogin `maxEpoch` horizon of +3),
/// gated behind a device PIN. Leaving the app and returning → PIN unlock. Once
/// the ~3-day window lapses the proof can't sign, so we force a fresh
/// Google/Apple sign-in. First sign-in per user prompts a one-time PIN setup.
@MainActor
@Observable
final class AppSession {
    enum Phase: Equatable {
        case launching
        case signedOut
        case onboarding(user: UserDTO)
        /// One-time "set your PIN" step, shown right after a fresh sign-in for a
        /// user who has no PIN on this device yet.
        case pinSetup(user: UserDTO)
        case ready(user: UserDTO)
        /// A valid, non-expired session that's waiting on the PIN unlock screen.
        case locked
    }

    var phase: Phase = .launching
    var lastError: String?
    /// The user behind the PIN lock screen (phase == .locked).
    var lockedUser: UserDTO?

    /// Convenience — current signed-in user, if any. Used by call sites that
    /// need the user id to key per-user state (e.g. PIN storage).
    var currentUser: UserDTO? {
        switch phase {
        case .onboarding(let u), .pinSetup(let u), .ready(let u): return u
        case .locked: return lockedUser
        default: return nil
        }
    }

    /// A session stays usable for ~3 days, then requires a fresh sign-in.
    private let sessionMaxAge: TimeInterval = 3 * 24 * 60 * 60
    /// Quick app-switches under this window don't re-prompt the PIN; a real
    /// backgrounding does.
    private let pinLockGrace: TimeInterval = 20
    private var backgroundedAt: Date?

    private let signInAtKey = "io.talise.session.signInAt"
    private let lastUserIdKey = "io.talise.snapshot.lastUserId"

    // MARK: - Launch

    func bootstrap() async {
        // Fresh install: the app container (UserDefaults) is wiped but the
        // Keychain survives, so a stale PIN from a previous install could make
        // `hasPin` wrongly true. Clear it once on first launch so "no PIN"
        // really means no PIN (and the user is asked to set one).
        let freshKey = "io.talise.freshInstall.v1"
        if !UserDefaults.standard.bool(forKey: freshKey) {
            UserDefaults.standard.set(true, forKey: freshKey)
            PinService.shared.clearAll()
        }

        // Restore a persisted, non-expired session and gate it behind the PIN.
        // If ANY piece is missing/expired we fall back to a clean fresh sign-in,
        // so a bad restore is never worse than the old behaviour (never a lockout).
        if let user = restorableUser(), sessionCredentialsPresent(), !sessionExpired() {
            lockedUser = user
            if PinService.shared.hasPin(userId: user.id) {
                phase = .locked
            } else {
                // No PIN on this device yet → REQUIRE the user to set one before
                // they can use the app. Never the unlock screen / biometric for a
                // user who has never set a PIN.
                phase = .pinSetup(user: user)
            }
        } else {
            clearSession()
            phase = .signedOut
        }
        // Warm FX rates on launch so a non-USD user's first amount entry converts.
        Task { await CurrencySettings.shared.refresh() }
    }

    // MARK: - Foreground / background

    /// Called when the app is fully backgrounded. Records when, so a real
    /// departure (vs a transient app-switcher peek) re-prompts the PIN.
    func appDidEnterBackground() {
        backgroundedAt = (currentUser == nil) ? nil : Date()
    }

    /// Called when the app returns to the foreground. If the session lapsed
    /// (~3 days) → sign out. Otherwise, if it sat backgrounded past the grace
    /// window and a PIN is set → lock and require the PIN. Quick switches pass
    /// through untouched.
    func appWillEnterForeground() {
        guard let since = backgroundedAt else { return }
        backgroundedAt = nil
        guard case .ready(let user) = phase else { return }
        if sessionExpired() {
            signOut()
        } else if Date().timeIntervalSince(since) >= pinLockGrace,
                  PinService.shared.hasPin(userId: user.id) {
            lockedUser = user
            phase = .locked
        }
    }

    // MARK: - PIN gate

    /// Called by the PIN unlock screen after a correct PIN.
    func unlock() {
        if let user = lockedUser { phase = .ready(user: user) }
        else { signOut() }
    }

    /// Called by the one-time set-PIN screen after the user picks a PIN.
    func completePinSetup() {
        if case .pinSetup(let user) = phase { phase = .ready(user: user) }
    }

    // MARK: - Sign in / out

    /// Called by SignInView / OnboardingRoot after `ZkLoginCoordinator.signIn()`.
    func handleSignedIn(user: UserDTO) {
        LocalSnapshotStore.saveUser(user)
        UserDefaults.standard.set(user.id, forKey: lastUserIdKey)
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: signInAtKey)
        lockedUser = user
        route(user)
    }

    /// Called by KYCView once new-user onboarding (country + account type) posts,
    /// so we advance into the one-time PIN setup instead of the old bootstrap()
    /// (which now restores rather than re-signs).
    func completeOnboarding(user: UserDTO) {
        LocalSnapshotStore.saveUser(user)
        route(user)
    }

    /// Route a freshly-authenticated user to onboarding → set-PIN → ready.
    private func route(_ user: UserDTO) {
        if user.accountType == nil {
            phase = .onboarding(user: user)
        } else if !PinService.shared.hasPin(userId: user.id) {
            phase = .pinSetup(user: user)
        } else {
            phase = .ready(user: user)
        }
    }

    func signOut() {
        clearSession()
        phase = .signedOut
    }

    // MARK: - Persistence helpers

    private func restorableUser() -> UserDTO? {
        guard let uid = UserDefaults.standard.string(forKey: lastUserIdKey) else { return nil }
        return LocalSnapshotStore.loadUser(userId: uid)
    }

    /// The minimum to sign after a restore: a bearer + a hydrated zkLogin proof
    /// window (ProofCache re-hydrates maxEpoch/proof from the Keychain on launch).
    private func sessionCredentialsPresent() -> Bool {
        SecureSessionStore.shared.read() != nil && ProofCache.shared.maxEpoch != nil
    }

    private func sessionExpired() -> Bool {
        let ts = UserDefaults.standard.double(forKey: signInAtKey)
        guard ts > 0 else { return true } // unknown age → treat as expired (safe)
        return Date().timeIntervalSince1970 - ts >= sessionMaxAge
    }

    /// Wipe every persisted credential: cached user snapshot, bearer, ephemeral
    /// key, and zkLogin proof. The shield note master is intentionally left alone
    /// — it lives in the iCloud Keychain + server escrow and is restored on the
    /// next sign-in, so a signed-out user never loses private funds. The device
    /// PIN is NOT cleared here (it's per-user Keychain and reused on re-sign-in).
    private func clearSession() {
        if let uid = currentUser?.id ?? UserDefaults.standard.string(forKey: lastUserIdKey) {
            LocalSnapshotStore.clear(userId: uid)
        }
        UserDefaults.standard.removeObject(forKey: lastUserIdKey)
        UserDefaults.standard.removeObject(forKey: signInAtKey)
        SecureSessionStore.shared.clear()
        EphemeralKeyStore.shared.wipe()
        ProofCache.shared.clear()
        lockedUser = nil
        backgroundedAt = nil
    }
}
