import Foundation
import UIKit

/// FIRST-PARTY PRODUCT ANALYTICS for the iOS app.
///
/// iOS was a total black box: no app-open signal, no funnel, no idea whether
/// anyone came back. This is the emitter that fixes that. It posts batches to
/// our own `POST /api/events` — the same endpoint web and Android use — so
/// there is no third-party SDK inside a wallet app and no vendor holding a
/// per-user behavioural stream.
///
/// Taxonomy lives in `web/lib/analytics/events.ts`; `Event` below mirrors those
/// strings verbatim. If you add one there, add it here.
///
/// PRIVACY, enforced by this type's API rather than by convention:
///   • `track` accepts `amountUsd` and BANDS it before it leaves the device
///     (`amountBand`). There is no way to send an exact amount from a call site.
///   • No email, name, handle, address, recipient, memo, IDFA/IDFV, or device
///     identifier is ever attached. `anonId` is a random UUID we mint and store
///     in UserDefaults; deleting the app resets it.
///   • Errors are reported as short machine codes, never as messages (a
///     server error message can contain an address or an amount).
///
/// COST: events queue and flush as one request (2s debounce, or immediately at
/// 20 events / on background). Failures are dropped, never retried in a loop —
/// analytics must never fight the network on a user's data plan.
@MainActor
final class Growth {
    static let shared = Growth()
    private init() {}

    // MARK: - Taxonomy (mirrors web/lib/analytics/events.ts)

    enum Event: String {
        // Lifecycle / retention
        case appOpen = "app_open"
        case appFirstOpen = "app_first_open"
        case screenView = "screen_view"
        // Signup funnel
        case signupStarted = "signup_started"
        case signupAuthCompleted = "signup_auth_completed"
        case onboardingStep = "onboarding_step"
        case onboardingCompleted = "onboarding_completed"
        case handleClaimed = "handle_claimed"
        case kycStarted = "kyc_started"
        case kycCompleted = "kyc_completed"
        // Money in
        case depositStarted = "deposit_started"
        case depositFailed = "deposit_failed"
        case funded = "funded"
        case depositCompleted = "deposit_completed"
        // Money out
        case sendStarted = "send_started"
        case sendReviewed = "send_reviewed"
        case sendCompleted = "send_completed"
        case sendFailed = "send_failed"
        case firstSend = "first_send"
        case cashoutStarted = "cashout_started"
        case cashoutCompleted = "cashout_completed"
        case cashoutFailed = "cashout_failed"
        // Revenue-bearing
        case swapCompleted = "swap_completed"
        case earnSupplied = "earn_supplied"
        case perpClosed = "perp_closed"
        // Virality
        case inviteSent = "invite_sent"
        // Push
        case pushPermissionGranted = "push_permission_granted"
        case pushPermissionDenied = "push_permission_denied"
        case notificationOpened = "notification_opened"
    }

    enum Status: String {
        case started, ok, error, cancelled
    }

    // MARK: - Identity

    private let anonKey = "io.talise.growth.anonId"
    private let sessionKey = "io.talise.growth.sessionId"
    private let sessionAtKey = "io.talise.growth.sessionAt"
    private let firstOpenKey = "io.talise.growth.firstOpen"
    private let sessionIdleWindow: TimeInterval = 30 * 60

    /// Random, app-scoped, not derived from the device. Reset by a reinstall.
    private var anonId: String {
        if let existing = UserDefaults.standard.string(forKey: anonKey) { return existing }
        let fresh = UUID().uuidString
        UserDefaults.standard.set(fresh, forKey: anonKey)
        return fresh
    }

    /// Rotates after 30 idle minutes, which is what makes "one app_open per
    /// session" a meaningful DAU unit.
    private var sessionId: String {
        let now = Date().timeIntervalSince1970
        let last = UserDefaults.standard.double(forKey: sessionAtKey)
        var id = UserDefaults.standard.string(forKey: sessionKey)
        if id == nil || now - last > sessionIdleWindow {
            id = UUID().uuidString
            UserDefaults.standard.set(id, forKey: sessionKey)
        }
        UserDefaults.standard.set(now, forKey: sessionAtKey)
        return id ?? UUID().uuidString
    }

    /// True exactly once per install — the "new device" signal that makes
    /// install → signup conversion measurable.
    private func claimFirstOpen() -> Bool {
        if UserDefaults.standard.object(forKey: firstOpenKey) != nil { return false }
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: firstOpenKey)
        return true
    }

    // MARK: - Amount banding

    /// Bucket a USD amount. Mirrors `amountBand()` in
    /// web/lib/analytics/events.ts — the server accepts KNOWN bands only, so a
    /// mismatch here silently drops the dimension rather than leaking a number.
    static func band(_ usd: Double?) -> String? {
        guard let usd, usd.isFinite else { return nil }
        let v = abs(usd)
        if v == 0 { return "0" }
        if v < 1 { return "<1" }
        if v < 5 { return "1-4" }
        if v < 20 { return "5-19" }
        if v < 50 { return "20-49" }
        if v < 100 { return "50-99" }
        if v < 500 { return "100-499" }
        if v < 1_000 { return "500-999" }
        if v < 5_000 { return "1k-5k" }
        return "5k+"
    }

    // MARK: - Error codes

    /// Collapse an Error into a SHORT, non-identifying code.
    ///
    /// This exists so no call site is tempted to pass
    /// `error.localizedDescription`: a server message can embed an address, an
    /// amount, or a bank name, none of which belong in an analytics table. The
    /// HTTP status and the error's category are all a funnel needs.
    static func errorCode(_ error: Error) -> String {
        if APIError.isCancellation(error) { return "cancelled" }
        if let api = error as? APIError {
            switch api {
            case .status(let code, _): return "http_\(code)"
            case .unauthorized: return "unauthorized"
            case .noSession: return "no_session"
            case .pinningFailed: return "pinning"
            case .decode: return "decode"
            case .invalidResponse: return "bad_response"
            case .transport: return "transport"
            case .cancelled: return "cancelled"
            }
        }
        let ns = error as NSError
        return ns.domain == NSURLErrorDomain ? "url_\(ns.code)" : "unknown"
    }

    // MARK: - Queue

    private struct Payload: Encodable {
        let event: String
        let ts: Int64
        let anonId: String
        let sessionId: String
        let platform: String
        let appVersion: String
        var surface: String?
        var step: String?
        var status: String?
        var errorCode: String?
        var amountBand: String?
        var currency: String?
        var corridor: String?
        var feeUsd: Double?
        var inviteId: String?
        /// Only ever carries `refCode`. The server hashes it immediately and
        /// stores `ref_code_hash`; the plaintext code is never persisted.
        var attribution: [String: String]?
        var props: [String: String]?
    }

    private struct Batch: Encodable {
        let anonId: String
        let sessionId: String
        let platform: String
        let appVersion: String
        let events: [Payload]
    }

    private var queue: [Payload] = []
    private var flushTask: Task<Void, Never>?
    private let maxQueued = 20
    private let debounce: TimeInterval = 2

    // MARK: - Emit

    /// Record an event. Fire-and-forget: never throws, never awaits, never
    /// blocks a UI or money path.
    func track(
        _ event: Event,
        surface: String? = nil,
        step: String? = nil,
        status: Status? = nil,
        errorCode: String? = nil,
        amountUsd: Double? = nil,
        currency: String? = nil,
        corridor: String? = nil,
        feeUsd: Double? = nil,
        inviteId: String? = nil,
        refCode: String? = nil,
        props: [String: String]? = nil
    ) {
        let payload = Payload(
            event: event.rawValue,
            ts: Int64(Date().timeIntervalSince1970 * 1000),
            anonId: anonId,
            sessionId: sessionId,
            platform: "ios",
            appVersion: AppConfig.shared.appVersion,
            surface: surface,
            step: step,
            status: status?.rawValue,
            errorCode: errorCode,
            // Banded here, on the device, so an exact amount cannot leave.
            amountBand: Growth.band(amountUsd),
            currency: currency,
            corridor: corridor,
            feeUsd: feeUsd,
            inviteId: inviteId,
            attribution: refCode.map { ["refCode": $0] },
            props: props
        )
        queue.append(payload)
        if queue.count >= maxQueued {
            flush()
        } else {
            scheduleFlush()
        }
    }

    /// One `app_open` per session window. Call on launch and on every
    /// foreground — the session check makes repeat calls free, so callers don't
    /// need to reason about it. THIS is the event DAU/WAU/MAU and D1/D7/D30
    /// retention are computed from.
    func appOpen(fromNotification: Bool = false) {
        // Decide FIRST, before anything reads `sessionId` (which refreshes the
        // idle window as a side effect and would make every open look stale).
        let now = Date().timeIntervalSince1970
        let last = UserDefaults.standard.double(forKey: sessionAtKey)
        let isNewSession = UserDefaults.standard.string(forKey: sessionKey) == nil
            || now - last > sessionIdleWindow
        let isFirstEver = claimFirstOpen()

        if isFirstEver { track(.appFirstOpen) }
        if isNewSession {
            track(.appOpen, props: fromNotification ? ["push": "1"] : nil)
        }
        if fromNotification { track(.notificationOpened) }
    }

    /// Record an invite the user actually SENT. `inviteId` is a fresh random id
    /// per share, which is what makes "invites sent" a correct K-factor
    /// denominator; `refCode` lets the server tie later clicks on
    /// `talise.io/r/<CODE>` back to this inviter (as a hash — the public invite
    /// URL can't carry a per-send id, so clicks attribute by code).
    func inviteSent(code: String, channel: String) {
        track(
            .inviteSent,
            surface: channel,
            status: .ok,
            inviteId: UUID().uuidString,
            refCode: code
        )
    }

    /// A milestone that must be counted once per user. The server enforces
    /// exactly-once via `growth_user_firsts` (COALESCE on first write), so it's
    /// safe — and correct — to call this on every occurrence.
    func milestone(_ event: Event, amountUsd: Double? = nil, surface: String? = nil) {
        track(event, surface: surface, status: .ok, amountUsd: amountUsd)
    }

    // MARK: - Flush

    private func scheduleFlush() {
        guard flushTask == nil else { return }
        flushTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64((self?.debounce ?? 2) * 1_000_000_000))
            await MainActor.run { self?.flushTask = nil; self?.flush() }
        }
    }

    /// Send whatever is queued. Call on background so the last events of a
    /// session — the drop-off signal — actually land.
    func flush() {
        guard !queue.isEmpty else { return }
        let batch = Batch(
            anonId: anonId,
            sessionId: sessionId,
            platform: "ios",
            appVersion: AppConfig.shared.appVersion,
            events: queue
        )
        queue.removeAll()
        flushTask?.cancel()
        flushTask = nil

        guard let url = URL(string: AppConfig.shared.apiBaseURL + "/api/events"),
              let body = try? JSONEncoder().encode(batch)
        else { return }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // Attach the bearer when we have one so the server can resolve the
        // user id itself. Absent = anonymous, which is correct pre-signup.
        if let bearer = SecureSessionStore.shared.read() {
            req.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
        }
        req.httpBody = body
        req.timeoutInterval = 10

        // Detached, unowned session: analytics must not share APIClient's
        // in-flight dedup or its retry/pinning path, and must never surface an
        // error. A dropped batch is strictly better than a retry storm.
        Task.detached(priority: .background) {
            _ = try? await URLSession.shared.data(for: req)
        }
    }
}
