import Foundation

/// Talise Agent — the machine-readable payload the assistant emits inside a
/// `---INTENT---{json}---END---` fence. Mirrors `web/lib/chat/intent.ts`'s
/// `ChatStep` union, kept as a single flat struct so any step kind decodes
/// (extra fields ignored, missing fields nil) and re-encodes verbatim for the
/// `POST /api/agent/plan` round-trip.
///
/// Step kinds (server-side ChatStep):
///   send · swap · save · withdraw · claim_rewards
///   check_balance · check_yield · show_activity
struct AgentStep: Codable, Hashable {
    let kind: String
    var amount: Double?
    var recipient: String?
    var from: String?
    var to: String?
    var venue: String?
    var limit: Int?

    /// Read-only steps need no signature — the client runs them inline.
    /// Matches `isReadOnly` in `web/lib/chat/intent.ts`.
    var isReadOnly: Bool {
        kind == "check_balance" || kind == "check_yield" || kind == "show_activity"
    }
}

/// One parsed intent block: an ordered list of steps the agent proposes.
struct AgentIntent: Codable, Hashable {
    var steps: [AgentStep]
    var rationale: String?

    /// True when every step is read-only — the card auto-runs inline with no
    /// confirm slide (e.g. "what's my balance + recent activity").
    var isReadOnlyOnly: Bool {
        !steps.isEmpty && steps.allSatisfy { $0.isReadOnly }
    }
}

/// Extracts the agent's `---INTENT---{json}---END---` block from a raw
/// assistant message. Mirrors `parseAssistantMessage` in
/// `web/lib/chat/intent.ts` — we only need the intent half here (the prose is
/// stripped for display in `ChatViewModel`).
enum AgentIntentParser {
    private static let fence = try! NSRegularExpression(
        pattern: "---INTENT---\\s*([\\s\\S]*?)\\s*---END---",
        options: []
    )

    /// Returns the first well-formed intent in `raw`, or nil. A malformed
    /// JSON body or an empty `steps` array yields nil (never throws).
    static func parse(_ raw: String) -> AgentIntent? {
        let ns = raw as NSString
        guard
            let match = fence.firstMatch(
                in: raw, options: [], range: NSRange(location: 0, length: ns.length)
            ),
            match.numberOfRanges >= 2
        else { return nil }

        let json = ns
            .substring(with: match.range(at: 1))
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard
            let data = json.data(using: .utf8),
            let intent = try? JSONDecoder().decode(AgentIntent.self, from: data),
            !intent.steps.isEmpty
        else { return nil }
        return intent
    }
}
