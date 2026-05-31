import Foundation

/// Persists the last-known Home-screen data snapshots so the app can
/// render real numbers on the very first frame instead of showing
/// redacted placeholders while the network loads.
///
/// Storage: `UserDefaults.standard` (JSON-encoded Codable), mirroring
/// the CurrencySettings / AppConfig patterns elsewhere in this codebase.
/// Keys are scoped per-user (by `userId`) so switching accounts doesn't
/// cross-pollinate.
///
/// Security note: `UserDTO` carries email + name/picture but NO bearer
/// token, wallet keys, or payment credentials — safe for UserDefaults.
/// The bearer stays in Keychain (SecureSessionStore).
enum LocalSnapshotStore {

    // MARK: - Keys

    private static func key(_ base: String, userId: String) -> String {
        "io.talise.snapshot.\(base).\(userId)"
    }

    // MARK: - BalancesDTO

    static func loadBalances(userId: String) -> BalancesDTO? {
        guard let data = UserDefaults.standard.data(
            forKey: key("balances", userId: userId)
        ) else { return nil }
        return try? JSONDecoder().decode(BalancesDTO.self, from: data)
    }

    static func saveBalances(_ dto: BalancesDTO, userId: String) {
        guard let data = try? JSONEncoder().encode(dto) else { return }
        UserDefaults.standard.set(data, forKey: key("balances", userId: userId))
    }

    // MARK: - Activity

    /// Maximum entries cached. Matches the /api/activity?limit= we use.
    private static let activityCap = 20

    static func loadActivity(userId: String) -> [ActivityEntryDTO]? {
        guard let data = UserDefaults.standard.data(
            forKey: key("activity", userId: userId)
        ) else { return nil }
        return try? JSONDecoder().decode([ActivityEntryDTO].self, from: data)
    }

    static func saveActivity(_ entries: [ActivityEntryDTO], userId: String) {
        let capped = Array(entries.prefix(activityCap))
        guard let data = try? JSONEncoder().encode(capped) else { return }
        UserDefaults.standard.set(data, forKey: key("activity", userId: userId))
    }

    // MARK: - UserDTO

    static func loadUser(userId: String) -> UserDTO? {
        guard let data = UserDefaults.standard.data(
            forKey: key("user", userId: userId)
        ) else { return nil }
        return try? JSONDecoder().decode(UserDTO.self, from: data)
    }

    static func saveUser(_ dto: UserDTO) {
        guard let data = try? JSONEncoder().encode(dto) else { return }
        UserDefaults.standard.set(data, forKey: key("user", userId: dto.id))
    }

    // MARK: - Clear

    /// Wipes all snapshot data for a given user. Call on sign-out so
    /// stale data doesn't persist after the account is removed from the
    /// device.
    static func clear(userId: String) {
        for base in ["balances", "activity", "user"] {
            UserDefaults.standard.removeObject(
                forKey: key(base, userId: userId)
            )
        }
    }
}
