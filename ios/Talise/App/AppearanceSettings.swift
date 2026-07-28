import Foundation
import SwiftUI

/// Light / dark / follow-system preference.
///
/// The palette itself is adaptive (see `TaliseColor` — every token is a
/// light/dark pair resolved per trait), so this only decides which trait the
/// app renders in. `.system` returns nil, which lets SwiftUI inherit iOS's
/// own setting.
enum TaliseAppearance: String, CaseIterable, Identifiable {
    case system, light, dark

    var id: String { rawValue }

    var label: String {
        switch self {
        case .system: return "System"
        case .light:  return "Light"
        case .dark:   return "Dark"
        }
    }

    var icon: String {
        switch self {
        case .system: return "circle.lefthalf.filled"
        case .light:  return "sun.max"
        case .dark:   return "moon"
        }
    }

    /// nil = follow the device. SwiftUI's `.preferredColorScheme(nil)` is
    /// exactly "no override", so `.system` needs no special-casing upstream.
    var colorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .light:  return .light
        case .dark:   return .dark
        }
    }
}

@MainActor
@Observable
final class AppearanceSettings {
    static let shared = AppearanceSettings()

    private let key = "io.talise.app.appearance"

    /// Defaults to `.dark` — the app shipped dark-only, so an existing user
    /// who updates keeps the exact look they had until they choose otherwise.
    private(set) var current: TaliseAppearance

    private init() {
        let stored = UserDefaults.standard.string(forKey: key)
        self.current = stored.flatMap(TaliseAppearance.init(rawValue:)) ?? .dark
    }

    func set(_ appearance: TaliseAppearance) {
        current = appearance
        UserDefaults.standard.set(appearance.rawValue, forKey: key)
    }
}
