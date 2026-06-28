import Foundation

/// Programmable money — "rules" that run themselves. A rule pairs a TRIGGER
/// (a schedule: an interval in minutes OR a day-of-month) with an ACTION (v1:
/// `send` a fixed amount to a recipient on that schedule — "pay rent on the
/// 1st"). The funds draw from a Talise-controlled "Rules Pocket" escrow the
/// user pre-funds over the normal gasless send rail; a backend cron evaluates
/// every due rule and pays out gaslessly — no per-run signing by the user.
///
///   • GET    /api/rules            → { rules:[…], escrowAddress }
///   • POST   /api/rules            → create a scheduled-send rule
///   • DELETE /api/rules/{id}       → soft-delete a rule
///   • POST   /api/rules/{id}/pause → stop a rule from firing
///   • POST   /api/rules/{id}/resume→ re-arm a paused rule
///
/// The feature is gated server-side until an escrow key is set: GET then
/// returns `{ rules: [], escrowAddress: null }` and POST 503s. Callers treat a
/// nil `escrowAddress` as "automations aren't live yet" and show a clean empty
/// state rather than an error.
@MainActor
enum RulesAPI {
    /// List the caller's money rules + the Rules Pocket escrow address (nil
    /// when the feature is gated off server-side).
    static func list() async throws -> RulesListResponse {
        try await APIClient.shared.get("/api/rules")
    }

    /// Create a scheduled-send rule. Pass `intervalMinutes` OR `dayOfMonth`
    /// (not both) for the cadence; the server resolves + screens `toRecipient`.
    /// Returns the created rule + the escrow address to pre-fund.
    static func create(
        name: String,
        intervalMinutes: Int?,
        dayOfMonth: Int?,
        toRecipient: String,
        amountUsd: Double
    ) async throws -> RuleCreateResponse {
        try await APIClient.shared.post(
            "/api/rules",
            body: CreateBody(
                name: name,
                trigger: "schedule",
                action: "send",
                intervalMinutes: intervalMinutes,
                dayOfMonth: dayOfMonth,
                toRecipient: toRecipient,
                amountUsd: amountUsd
            )
        )
    }

    static func pause(id: String) async throws -> RuleDTO {
        let res: RuleResponse = try await APIClient.shared.post("/api/rules/\(id)/pause", body: EmptyBody())
        return res.rule
    }

    static func resume(id: String) async throws -> RuleDTO {
        let res: RuleResponse = try await APIClient.shared.post("/api/rules/\(id)/resume", body: EmptyBody())
        return res.rule
    }

    static func delete(id: String) async throws {
        let _: OkResponse = try await APIClient.shared.delete("/api/rules/\(id)")
    }
}

// MARK: - DTOs

/// The send action's stored config. `amountMicros` is a BigInt-as-string (6dp
/// micros); decode the bits the UI needs and tolerate any extra keys.
struct RuleActionConfig: Codable, Hashable {
    let toAddress: String?
    let toHandle: String?
    let amountMicros: String?

    /// The payout amount in USD, parsed from the micro string.
    var amountUsd: Double? {
        guard let amountMicros, let micros = Double(amountMicros) else { return nil }
        return micros / 1_000_000
    }
}

/// Mirrors `MoneyRule` from web/lib/money-rules.ts. Most fields are optional so
/// an older/leaner server shape still decodes cleanly.
struct RuleDTO: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let triggerType: String
    let intervalMinutes: Int?
    let dayOfMonth: Int?
    let actionType: String
    let actionConfig: RuleActionConfig?
    let state: String
    let nextDueAt: Double?
    let executionCount: Int?
    let lastRunAt: Double?
    let lastStatus: String?
    let lastError: String?
    let createdAt: Double?

    var isActive: Bool { state == "active" }
    var isPaused: Bool { state == "paused" }

    /// The payout amount this rule sends each run (from the send action).
    var amountUsd: Double { actionConfig?.amountUsd ?? 0 }

    /// Who this rule pays — the resolved handle if known, else a short address.
    var recipientLabel: String {
        if let h = actionConfig?.toHandle, !h.isEmpty { return h }
        if let a = actionConfig?.toAddress, !a.isEmpty {
            return a.count > 14 ? String(a.prefix(8)) + "…" + String(a.suffix(4)) : a
        }
        return "recipient"
    }

    /// A human cadence line: "Every day", "Every 7 days", "On the 1st".
    var cadenceLine: String {
        if let dom = dayOfMonth, dom >= 1 {
            return "On the \(Self.ordinal(dom)) of each month"
        }
        guard let m = intervalMinutes, m > 0 else { return "On a schedule" }
        switch m {
        case 1: return "Every minute"
        case 60: return "Every hour"
        case 1440: return "Every day"
        case 10080: return "Every week"
        default:
            if m % 1440 == 0 { return "Every \(m / 1440) days" }
            if m % 60 == 0 { return "Every \(m / 60) hours" }
            return "Every \(m) minutes"
        }
    }

    private static func ordinal(_ n: Int) -> String {
        let suffix: String
        switch (n % 100, n % 10) {
        case (11, _), (12, _), (13, _): suffix = "th"
        case (_, 1): suffix = "st"
        case (_, 2): suffix = "nd"
        case (_, 3): suffix = "rd"
        default: suffix = "th"
        }
        return "\(n)\(suffix)"
    }
}

struct RulesListResponse: Codable {
    let rules: [RuleDTO]
    /// nil when the feature is gated off server-side (no escrow key set).
    let escrowAddress: String?

    /// True when automations are actually live (an escrow key is configured).
    var enabled: Bool { (escrowAddress ?? "").isEmpty == false }
}

struct RuleCreateResponse: Codable {
    let rule: RuleDTO
    let escrowAddress: String?
}

// MARK: - Request / response wrappers

private struct CreateBody: Encodable {
    let name: String
    let trigger: String
    let action: String
    let intervalMinutes: Int?
    let dayOfMonth: Int?
    let toRecipient: String
    let amountUsd: Double
}

private struct RuleResponse: Codable { let rule: RuleDTO }
private struct EmptyBody: Encodable {}
private struct OkResponse: Codable { let ok: Bool? }
