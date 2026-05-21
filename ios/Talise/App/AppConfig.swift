import Foundation

/// Runtime config sourced from Info.plist (so the same binary works
/// against dev / staging / prod via build settings).
struct AppConfig {
    static let shared = AppConfig()

    let apiBaseURL: String
    let appVersion: String

    private init() {
        let plist = Bundle.main.infoDictionary ?? [:]
        self.apiBaseURL = (plist["TaliseAPIBaseURL"] as? String)
            ?? ProcessInfo.processInfo.environment["TALISE_API_BASE_URL"]
            ?? "https://talise.io"
        self.appVersion = (plist["CFBundleShortVersionString"] as? String) ?? "0.0.0"
    }
}
