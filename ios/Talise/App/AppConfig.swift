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

    /// Feature flag: when true, the Send flow attempts to broadcast the
    /// gasless tx straight to a Sui fullnode after assembling the
    /// zkLogin signature server-side, skipping the Vercel `/api/send/
    /// gasless-submit` execute hop. Falls back to `/api/send/gasless-
    /// submit` automatically on any assemble/broadcast failure.
    ///
    /// Reads `UserDefaults.standard` key `talise.send.directBroadcast`
    /// (computed each access so a debug toggle takes effect on next
    /// send without a relaunch). Defaults to `false` until we ship.
    var directBroadcastEnabled: Bool {
        UserDefaults.standard.bool(forKey: "talise.send.directBroadcast")
    }

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
