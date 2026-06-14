import SwiftUI

/// A fiat corridor for the ramps (add money / cash out). Each row is a
/// country + its currency + a flag, plus how Talise serves it:
///
///   • `.bridge` — live via Bridge (USD/EUR/GBP/MXN/BRL/COP). Bridge moves
///     fiat ↔ USDsui DIRECTLY on Sui, both directions.
///   • `.local`  — served by a dedicated local rail (Nigeria/NGN via Linq),
///     off-ramp only today.
///   • `.soon`   — known corridor, not yet bookable; shown disabled so the
///     map of "where Talise is going" is honest.
struct RampCorridor: Identifiable, Equatable, Hashable {
    /// ISO 3166-1 alpha-2 (e.g. "US", "NG").
    let code: String
    /// Display name ("United States").
    let name: String
    /// ISO 4217 fiat currency ("USD").
    let currencyCode: String
    /// Emoji flag for the rounded chip.
    let flag: String
    let availability: Availability
    /// Which directions this corridor supports.
    let onramp: Bool
    let offramp: Bool

    var id: String { code }

    enum Availability: Equatable, Hashable {
        case bridge
        case local
        case soon
    }

    var isAvailable: Bool { availability != .soon }

    /// Short rail label for the row subtitle.
    var railLabel: String {
        switch availability {
        case .bridge: return "Bank transfer · USDsui on Sui"
        case .local: return "Local bank"
        case .soon: return "Coming soon"
        }
    }
}

/// The corridor catalogue. Available rows are first-class; "soon" rows keep
/// the picker honest about coverage without pretending they work.
enum RampCorridors {
    /// Bridge fiat corridors (live when Bridge is configured). Bridge delivers
    /// USDsui on Sui directly — no swap — for both add-money and cash-out.
    static let all: [RampCorridor] = [
        // ── Live via Bridge ──
        .init(code: "US", name: "United States", currencyCode: "USD", flag: "🇺🇸",
              availability: .bridge, onramp: true, offramp: true),
        .init(code: "GB", name: "United Kingdom", currencyCode: "GBP", flag: "🇬🇧",
              availability: .bridge, onramp: true, offramp: true),
        .init(code: "DE", name: "Germany", currencyCode: "EUR", flag: "🇩🇪",
              availability: .bridge, onramp: true, offramp: true),
        .init(code: "FR", name: "France", currencyCode: "EUR", flag: "🇫🇷",
              availability: .bridge, onramp: true, offramp: true),
        .init(code: "ES", name: "Spain", currencyCode: "EUR", flag: "🇪🇸",
              availability: .bridge, onramp: true, offramp: true),
        .init(code: "IT", name: "Italy", currencyCode: "EUR", flag: "🇮🇹",
              availability: .bridge, onramp: true, offramp: true),
        .init(code: "NL", name: "Netherlands", currencyCode: "EUR", flag: "🇳🇱",
              availability: .bridge, onramp: true, offramp: true),
        .init(code: "IE", name: "Ireland", currencyCode: "EUR", flag: "🇮🇪",
              availability: .bridge, onramp: true, offramp: true),
        .init(code: "MX", name: "Mexico", currencyCode: "MXN", flag: "🇲🇽",
              availability: .bridge, onramp: true, offramp: true),
        .init(code: "BR", name: "Brazil", currencyCode: "BRL", flag: "🇧🇷",
              availability: .bridge, onramp: true, offramp: true),
        // ── Live via a local rail (Linq) ──
        .init(code: "NG", name: "Nigeria", currencyCode: "NGN", flag: "🇳🇬",
              availability: .local, onramp: false, offramp: true),
        // ── On the map, not yet bookable ──
        .init(code: "KE", name: "Kenya", currencyCode: "KES", flag: "🇰🇪",
              availability: .soon, onramp: false, offramp: false),
        .init(code: "GH", name: "Ghana", currencyCode: "GHS", flag: "🇬🇭",
              availability: .soon, onramp: false, offramp: false),
        .init(code: "ZA", name: "South Africa", currencyCode: "ZAR", flag: "🇿🇦",
              availability: .soon, onramp: false, offramp: false),
        .init(code: "PH", name: "Philippines", currencyCode: "PHP", flag: "🇵🇭",
              availability: .soon, onramp: false, offramp: false),
        .init(code: "IN", name: "India", currencyCode: "INR", flag: "🇮🇳",
              availability: .soon, onramp: false, offramp: false),
    ]

    /// Corridors that support a given direction, available ones first, "soon"
    /// last — both groups alphabetical by name.
    static func forDirection(_ direction: RampDirection) -> (available: [RampCorridor], soon: [RampCorridor]) {
        let supports: (RampCorridor) -> Bool = { c in
            direction == .onramp ? c.onramp : c.offramp
        }
        // A corridor that doesn't support the direction at all but is a known
        // place still shows under "soon" so coverage reads honestly.
        let available = all
            .filter { $0.isAvailable && supports($0) }
            .sorted { $0.name < $1.name }
        let soon = all
            .filter { !($0.isAvailable && supports($0)) }
            .sorted { $0.name < $1.name }
        return (available, soon)
    }
}

enum RampDirection {
    case onramp   // add money: fiat → USDsui
    case offramp  // cash out: USDsui → fiat
}
