import Foundation

/// Runtime config sourced from Info.plist + scheme environment variables.
///
/// Local dev: set in the scheme's "Run > Arguments > Environment Variables":
///   TALISE_API_BASE_URL=http://localhost:3000
///   TALISE_GOOGLE_CLIENT_ID=<your iOS OAuth client id>
struct AppConfig {
    static let shared = AppConfig()

    let apiBaseURL: String
    let googleClientID: String
    let appVersion: String
    let verboseConsoleLogging: Bool

    private init() {
        let plist = Bundle.main.infoDictionary ?? [:]
        let env = ProcessInfo.processInfo.environment

        self.apiBaseURL =
            env["TALISE_API_BASE_URL"]
            ?? (plist["TaliseAPIBaseURL"] as? String)
            ?? "https://talise.io"

        self.googleClientID =
            env["TALISE_GOOGLE_CLIENT_ID"]
            ?? (plist["TaliseGoogleClientID"] as? String)
            ?? ""

        self.appVersion = (plist["CFBundleShortVersionString"] as? String) ?? "0.0.0"
        self.verboseConsoleLogging = env["TALISE_VERBOSE_LOGS"] == "1"
    }
}
