import Foundation
import SwiftUI

/// User-facing display currency. Talise always settles in USDsui on
/// chain (1:1 USD); this picker just changes what the UI renders.
struct TaliseCurrency: Identifiable, Equatable, Hashable, Codable {
    let code: String       // ISO 4217: USD, NGN, GHS, KES, EUR, GBP, CAD, ZAR
    let symbol: String     // $, ₦, ₵, KSh, €, £, CA$, R
    let name: String       // "US Dollar", "Nigerian Naira", …
    var id: String { code }

    static let allSupported: [TaliseCurrency] = [
        .init(code: "USD", symbol: "$",   name: "US Dollar"),
        .init(code: "NGN", symbol: "₦",   name: "Nigerian Naira"),
        .init(code: "GHS", symbol: "₵",   name: "Ghanaian Cedi"),
        .init(code: "KES", symbol: "KSh", name: "Kenyan Shilling"),
        .init(code: "EUR", symbol: "€",   name: "Euro"),
        .init(code: "GBP", symbol: "£",   name: "British Pound"),
        .init(code: "CAD", symbol: "CA$", name: "Canadian Dollar"),
        .init(code: "ZAR", symbol: "R",   name: "South African Rand"),
    ]

    static let usd = allSupported[0]

    static func find(code: String) -> TaliseCurrency {
        allSupported.first(where: { $0.code == code }) ?? .usd
    }
}

/// App-wide currency preference. Persists to UserDefaults; observable
/// via SwiftUI's @Environment(\.currencySettings) pattern.
///
/// On first launch we default to the country's currency when the
/// user's row carries one — Nigerian users default to NGN, etc. If
/// no match, fall back to USD.
@MainActor
@Observable
final class CurrencySettings {
    static let shared = CurrencySettings()

    private let defaultsKey = "io.talise.app.displayCurrency"
    private(set) var current: TaliseCurrency
    private(set) var rates: [String: Double] = ["USD": 1]
    private(set) var ratesLoaded = false

    private init() {
        let stored = UserDefaults.standard.string(forKey: defaultsKey)
        self.current = stored.map(TaliseCurrency.find) ?? .usd
    }

    func set(_ currency: TaliseCurrency) {
        current = currency
        UserDefaults.standard.set(currency.code, forKey: defaultsKey)
    }

    /// One-shot rate fetch — call from AppSession.bootstrap. Idempotent;
    /// soft-fails to USD-only.
    func refresh() async {
        struct Response: Decodable {
            let rates: [String: Double]
        }
        do {
            let r: Response = try await APIClient.shared.get("/api/fx")
            rates = r.rates
            ratesLoaded = true
        } catch {
            // Keep whatever we had (USD baseline).
        }
    }

    /// Convert a USD amount to the user's display currency. Returns
    /// (amount, currency) so callers don't need a separate symbol
    /// lookup.
    func convert(usd: Double) -> (amount: Double, currency: TaliseCurrency) {
        let rate = rates[current.code] ?? 1
        return (usd * rate, current)
    }

    /// Country-code → currency-code heuristic. Used when the user
    /// completes onboarding so a Nigerian user defaults to NGN
    /// without having to flip the toggle themselves.
    static func defaultCurrency(forCountry code: String?) -> TaliseCurrency {
        let map: [String: String] = [
            "NG": "NGN", "GH": "GHS", "KE": "KES",
            "ZA": "ZAR", "GB": "GBP", "UK": "GBP",
            "DE": "EUR", "FR": "EUR", "ES": "EUR", "IT": "EUR",
            "CA": "CAD",
        ]
        guard let c = code, let cur = map[c.uppercased()] else { return .usd }
        return TaliseCurrency.find(code: cur)
    }
}
