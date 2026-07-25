import Foundation

/// Referral capture + attribution for iOS.
///
/// Web attribution reads a signed httpOnly cookie that `/r/<CODE>` sets. The
/// app has no cookie jar, and the sign-in leg (`/api/auth/mobile/start` →
/// `/auth/callback` → `talise://auth/callback`) never carries one, so every
/// invite that produced an App Store install was silently unattributed. The
/// device has to remember the inviter's code itself.
///
/// Flow:
///   1. An invite link (`https://www.talise.io/r/<CODE>`, now claimed in the
///      AASA file, or `talise://r/<CODE>`) reaches `DeepLink.route`, which calls
///      `capture(from:)`.
///   2. The code is held in UserDefaults for 30 days, mirroring the web
///      cookie's window, so install-now-sign-in-later still counts.
///   3. `AppSession.handleSignedIn` calls `claimPending()` with the fresh
///      bearer, which posts to `/api/auth/exchange/referral`.
///
/// The server owns every rule: it takes the referee from the bearer (so you can
/// only ever attribute yourself), refuses unless the account row is minutes old
/// (first sign-in only), refuses self-referral, and claims the referee with an
/// atomic compare-and-swap so exactly one inviter is ever credited. This type
/// is only a courier and is deliberately incapable of granting anything.
///
/// Capture + storage are nonisolated (UserDefaults, callable from wherever a
/// deep link arrives); the two calls that touch `APIClient.shared` are
/// `@MainActor`, matching the other API wrappers (WalletAPI, RulesAPI).
enum ReferralAttribution {

    // MARK: - Storage

    private static let pendingKey = "io.talise.referral.pending.code"
    private static let pendingAtKey = "io.talise.referral.pending.at"

    /// Same 30-day window as the web `talise_ref` cookie.
    private static let pendingTTL: TimeInterval = 30 * 24 * 60 * 60

    /// Mirrors `REFERRAL_CODE_RE` in web/lib/db.ts (no ambiguous O/I/L/0/1).
    private static let allowed = Set("ABCDEFGHJKMNPQRSTUVWXYZ23456789")

    /// Uppercase + validate a candidate code, or nil.
    static func normalize(_ raw: String?) -> String? {
        guard let raw else { return nil }
        let code = raw.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard code.count == 8, code.allSatisfy({ allowed.contains($0) }) else { return nil }
        return code
    }

    /// Pull a code out of any invite URL shape we hand out:
    /// `…/r/<CODE>`, `talise://r/<CODE>`, or `?ref=<CODE>`.
    static func code(from url: URL) -> String? {
        // Custom scheme puts the segment in `host`; https puts it in `path`.
        if url.scheme == "talise", url.host == "r",
           let seg = url.pathComponents.first(where: { $0 != "/" }),
           let code = normalize(seg) {
            return code
        }
        if url.path.hasPrefix("/r/") {
            let seg = String(url.path.dropFirst(3)).split(separator: "/").first
            if let code = normalize(seg.map(String.init)) { return code }
        }
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems
        if let ref = items?.first(where: { $0.name == "ref" })?.value {
            return normalize(ref)
        }
        return nil
    }

    /// Stash a code for the next sign-in, and report the click so the funnel has
    /// a numerator for users who have the app (the web `/r/` handler never runs
    /// for them once the link is a Universal Link).
    @discardableResult
    static func capture(from url: URL) -> String? {
        guard let code = code(from: url) else { return nil }
        let d = UserDefaults.standard
        d.set(code, forKey: pendingKey)
        d.set(Date().timeIntervalSince1970, forKey: pendingAtKey)
        Task { await reportEvent("invite_clicked", code: code, channel: nil) }
        return code
    }

    /// The stored code, or nil when absent or past its 30-day window.
    static func pending() -> String? {
        let d = UserDefaults.standard
        guard let code = normalize(d.string(forKey: pendingKey)) else { return nil }
        let at = d.double(forKey: pendingAtKey)
        guard at > 0, Date().timeIntervalSince1970 - at <= pendingTTL else {
            clearPending()
            return nil
        }
        return code
    }

    static func clearPending() {
        let d = UserDefaults.standard
        d.removeObject(forKey: pendingKey)
        d.removeObject(forKey: pendingAtKey)
    }

    // MARK: - Server calls

    private struct ClaimBody: Encodable { let code: String }
    private struct ClaimResult: Decodable { let ok: Bool; let reason: String? }

    private struct EventBody: Encodable {
        let name: String
        let code: String
        let surface: String
        let channel: String?
    }
    private struct EventResult: Decodable { let ok: Bool? }

    /// Hand any pending invite code to the server. Call once, right after the
    /// first sign-in, with the bearer already set.
    ///
    /// Clears the pending code on any DEFINITIVE answer (credited, or refused
    /// for a reason that will never change: stale link, already attributed, own
    /// code). A network / 5xx failure keeps it queued for the next launch.
    /// Never throws: this hangs off the sign-in path and must not block it.
    @MainActor
    @discardableResult
    static func claimPending() async -> Bool {
        guard let code = pending() else { return false }
        do {
            let res: ClaimResult = try await APIClient.shared.post(
                "/api/auth/exchange/referral", body: ClaimBody(code: code)
            )
            clearPending()
            if !res.ok {
                print("[referral] not attributed: \(res.reason ?? "unknown")")
            }
            return res.ok
        } catch {
            // Transient. The server's first-sign-in window is 30 minutes, so a
            // retry on the next launch can still land.
            print("[referral] claim deferred: \(error.localizedDescription)")
            return false
        }
    }

    /// Report that an invite left the device (`invite_sent`) or that an invite
    /// link opened the app (`invite_clicked`). Fire-and-forget telemetry;
    /// `invite_sent` is the DENOMINATOR of K-factor.
    @MainActor
    static func reportEvent(_ name: String, code: String, channel: String?) async {
        guard let code = normalize(code) else { return }
        do {
            let _: EventResult = try await APIClient.shared.post(
                "/api/referral/event",
                body: EventBody(name: name, code: code, surface: "ios", channel: channel)
            )
        } catch {
            /* telemetry only, never surface */
        }
    }

    /// Convenience for the share sheet.
    static func reportInviteSent(code: String, channel: String) {
        Task { await reportEvent("invite_sent", code: code, channel: channel) }
    }

    // MARK: - Copy fallback

    /// OFFLINE FALLBACK ONLY. The canonical invite copy lives in
    /// web/components/app/rewards/share-copy.ts and arrives on the `share`
    /// block of `/api/referral/summary`; render that whenever it is present.
    /// This mirror exists so a share still works against an older server or a
    /// cold cache. Keep the two in sync (no em-dashes, a send finalizes
    /// "in under a second").
    static let shareFallbackText =
        "Join me on Talise. Send dollars to anyone, anywhere, and it finalizes in under a second."

    /// Canonical invite URL. Matches `inviteUrl` in share-copy.ts.
    static func inviteURL(code: String) -> String {
        "https://www.talise.io/r/\(code.uppercased())"
    }

    /// Fallback share payload when the server didn't send one.
    static func shareFallback(code: String) -> String {
        "\(shareFallbackText) \(inviteURL(code: code))"
    }
}
