import Foundation

/// Programmable money — "rules" that run themselves, NON-CUSTODIALLY. A rule
/// pairs a TRIGGER (a schedule: an interval in minutes OR a day-of-month) with
/// an ACTION (v1: `send` a fixed amount to a recipient on that schedule — "pay
/// rent on the 1st").
///
/// Each rule is backed by an on-chain `standing_order` object the user owns: the
/// pot is funded up front (one-or-more payments' worth) and the recipient +
/// amount are baked on chain. `execute_due` is PERMISSIONLESS — the contract
/// releases only the pre-set amount to the pre-set recipient, and only once the
/// Clock passes the schedule. There is NO cron and NO scheduler key: the app
/// triggers any DUE rules when it opens (`executePrepare` → sign → `recordExecuted`).
/// Cancelling refunds the entire remaining pot.
///
/// Create is a two-step prepare → sign → record (exactly like team streams + the
/// goal vault):
///   • GET    /api/rules            → { rules:[…], enabled }
///   • POST   /api/rules            → PREPARE: returns Onara-sponsored
///                                    `standing_order::create` bytes to sign
///   • POST   /api/rules/record     → activate with the signed funding digest
///   • POST   /api/rules/{id}/cancel→ owner-signed `cancel` bytes (refund pot)
///   • DELETE /api/rules/{id}       → clear the row (after a signed cancel)
///   • POST   /api/rules/{id}/pause → stop a rule from firing
///   • POST   /api/rules/{id}/resume→ re-arm a paused rule
///
/// The feature is gated server-side until the automations engine is configured:
/// GET then returns `{ rules: [], enabled: false }` and POST 503s. Callers treat
/// `enabled == false` as "automations aren't live yet" and show a clean
/// "coming soon" state rather than an error.
@MainActor
enum RulesAPI {
    /// List the caller's money rules. `enabled` is false when the feature is
    /// gated off server-side.
    static func list() async throws -> RulesListResponse {
        try await APIClient.shared.get("/api/rules")
    }

    /// STEP 1 — PREPARE a scheduled-send rule. Pass `intervalMinutes` OR
    /// `dayOfMonth` (not both) for the cadence; the server resolves + screens
    /// `toRecipient`. `prefundUsd` (>= amountUsd) is how much to load into the
    /// rule's pot now — default one payment. Returns the Onara-sponsored
    /// `standing_order::create` bytes to sign + the record to echo back.
    static func prepareCreate(
        name: String,
        intervalMinutes: Int?,
        dayOfMonth: Int?,
        toRecipient: String,
        amountUsd: Double,
        prefundUsd: Double
    ) async throws -> RulePrepareResponse {
        try await APIClient.shared.post(
            "/api/rules",
            body: PrepareBody(
                name: name,
                trigger: "schedule",
                action: "send",
                intervalMinutes: intervalMinutes,
                dayOfMonth: dayOfMonth,
                toRecipient: toRecipient,
                amountUsd: amountUsd,
                prefundUsd: prefundUsd
            )
        )
    }

    /// STEP 2 — after signing the create, activate the rule with the funding
    /// `digest` + the `record` echoed by `prepareCreate`.
    static func recordCreate(
        digest: String,
        firstDueMs: Double,
        record: RuleRecord
    ) async throws -> RuleDTO {
        let res: RuleResponse = try await APIClient.shared.post(
            "/api/rules/record",
            body: RecordBody(
                digest: digest,
                firstDueMs: firstDueMs,
                name: record.name,
                trigger: record.trigger,
                intervalMinutes: record.intervalMinutes,
                dayOfMonth: record.dayOfMonth,
                toAddress: record.toAddress,
                toHandle: record.toHandle,
                amountUsd: record.amountUsd
            )
        )
        return res.rule
    }

    /// Build the owner-signed `cancel` bytes (stops + refunds the remaining pot).
    /// On success the client signs these, then calls `delete` to clear the row.
    static func cancelPrepare(id: String) async throws -> RuleCancelResponse {
        try await APIClient.shared.post("/api/rules/\(id)/cancel", body: EmptyBody())
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

    /// Build the Onara-sponsored, PERMISSIONLESS `execute_due` bytes for a due
    /// rule. The owner signs (they're the sender); the contract gates the actual
    /// release on the Clock + schedule, so signing a not-yet-due rule just aborts
    /// ENotDue. Pair with `recordExecuted` after the signed tx confirms.
    static func executePrepare(id: String) async throws -> RuleExecuteResponse {
        try await APIClient.shared.post("/api/rules/\(id)/execute", body: EmptyBody())
    }

    /// Record a confirmed on-chain release — advances the rule's next-due mirror
    /// and appends to its ledger. Idempotent (the on-chain Clock prevents a double pay).
    static func recordExecuted(id: String, digest: String) async throws -> RuleDTO {
        let res: RuleResponse = try await APIClient.shared.post(
            "/api/rules/\(id)/executed",
            body: ExecutedBody(digest: digest)
        )
        return res.rule
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
    /// True when automations are configured + live server-side.
    let enabled: Bool
}

/// The DB/ledger mirror echoed by `prepareCreate`; the client signs the bytes
/// then posts this (plus the digest + firstDueMs) to `/api/rules/record`. The
/// on-chain object is the source of truth for recipient + amount — this is just
/// what the server stores so the scheduler/UI can describe the rule.
struct RuleRecord: Codable, Hashable {
    let name: String
    let trigger: String
    let intervalMinutes: Int?
    let dayOfMonth: Int?
    let toAddress: String
    let toHandle: String?
    let amountUsd: Double
}

/// PREPARE response: the sponsor-ready `standing_order::create` bytes to sign,
/// the first due time, and the record to echo back on /record.
struct RulePrepareResponse: Codable {
    let mode: String?
    let bytes: String
    let firstDueMs: Double
    let record: RuleRecord
}

/// CANCEL response: the owner-signed `cancel` bytes (refunds the pot).
struct RuleCancelResponse: Codable {
    let mode: String?
    let bytes: String
}

/// EXECUTE response: the sponsor-ready, permissionless `execute_due` bytes to sign.
struct RuleExecuteResponse: Codable {
    let mode: String?
    let bytes: String
}

// MARK: - Request / response wrappers

private struct PrepareBody: Encodable {
    let name: String
    let trigger: String
    let action: String
    let intervalMinutes: Int?
    let dayOfMonth: Int?
    let toRecipient: String
    let amountUsd: Double
    let prefundUsd: Double
}

private struct RecordBody: Encodable {
    let digest: String
    let firstDueMs: Double
    let name: String
    let trigger: String
    let intervalMinutes: Int?
    let dayOfMonth: Int?
    let toAddress: String
    let toHandle: String?
    let amountUsd: Double
}

private struct ExecutedBody: Encodable { let digest: String }
private struct RuleResponse: Codable { let rule: RuleDTO }
private struct EmptyBody: Encodable {}
private struct OkResponse: Codable { let ok: Bool? }
