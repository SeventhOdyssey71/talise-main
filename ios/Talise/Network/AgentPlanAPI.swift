import Foundation

/// Thin namespace over the Talise Agent's safety brain.
///
///   • POST /api/agent/plan  →  validate + price a proposed intent
///
/// The agent never auto-sends: it emits an intent (`AgentStep[]`), the client
/// posts it here, and the server returns a VALIDATED, priced preview —
/// recipients resolved + screened, send total cap-checked — WITHOUT moving any
/// money. The client renders an `AgentIntentCard`; only on a user slide does it
/// call the real prepare + sign endpoints. "Agent proposes → server validates →
/// human confirms." Same auth/app-access/rate-limit guardrails as the money
/// routes (see `web/app/api/agent/plan/route.ts`).
@MainActor
enum AgentPlanAPI {
    /// Validate + price an intent. Throws `APIError` on transport / HTTP error.
    static func plan(steps: [AgentStep]) async throws -> AgentPlanDTO {
        try await APIClient.shared.post("/api/agent/plan", body: PlanBody(steps: steps))
    }

    private struct PlanBody: Encodable {
        let steps: [AgentStep]
    }
}

// MARK: - DTOs (mirror `AgentPlan` in web/lib/agent/plan.ts)

/// A validated, priced preview of a proposed intent. Moves no money.
struct AgentPlanDTO: Decodable {
    /// True only if every step is ok/read_only and the cap check passes.
    let confirmable: Bool
    let steps: [PlannedStepDTO]
    /// Total USD leaving the wallet across send steps (cap checked on this).
    let totalSendUsd: Double
    /// Present when the send total would breach a tier cap.
    let limit: PlanLimitDTO?
    /// Short human summary for the confirm-card header.
    let summary: String
}

/// One validated step. `status` drives the row treatment:
///   • `ok`        — safe to confirm (write) → counted toward the slide.
///   • `read_only` — run inline, no signature.
///   • `blocked`   — a hard stop (own wallet, screen, over cap).
///   • `needs_info`— a missing/invalid param (bad amount, unresolved handle).
struct PlannedStepDTO: Decodable, Hashable {
    let kind: String
    let label: String
    let status: String
    let detail: String?
    /// Resolved recipient (send steps only) — `resolved.address` is what the
    /// executor sends to, so the client never re-resolves.
    let resolved: ResolvedRecipientDTO?
    /// USD this step moves out of the wallet (send/save/withdraw); 0 read-only.
    let amountUsd: Double?

    var isOk: Bool { status == "ok" }
    var isReadOnly: Bool { status == "read_only" }
    var isBlocked: Bool { status == "blocked" || status == "needs_info" }
}

struct ResolvedRecipientDTO: Decodable, Hashable {
    let address: String
    let displayName: String
}

struct PlanLimitDTO: Decodable, Hashable {
    let window: String   // "daily" | "monthly"
    let limit: Double
    let used: Double
    let tier: Int
}
