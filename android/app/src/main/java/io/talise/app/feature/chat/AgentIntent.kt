package io.talise.app.feature.chat

import io.talise.app.core.net.ApiClient
import kotlinx.serialization.Serializable

/**
 * Talise Agent — the machine-readable payload the assistant emits inside a
 * `---INTENT---{json}---END---` fence. Mirrors iOS `AgentIntent.swift` and
 * `web/lib/chat/intent.ts`'s `ChatStep` union, kept as a single flat class so
 * any step kind decodes (extra fields ignored, missing fields null) and
 * re-encodes verbatim for the `POST /api/agent/plan` round-trip.
 *
 * Step kinds (server-side ChatStep):
 *   send · swap · save · withdraw · claim_rewards · cash_out · request
 *   check_balance · check_yield · show_activity
 */
@Serializable
data class AgentStep(
    val kind: String,
    val amount: Double? = null,
    val recipient: String? = null,
    val from: String? = null,
    val to: String? = null,
    val venue: String? = null,
    val limit: Int? = null,
    /** Optional note on a `request` (payment-link) step. */
    val note: String? = null,
    /**
     * The exact amount the user said in their LOCAL currency + its ISO code.
     * When present, the server computes the precise usd so "1000 naira" lands
     * back at ~N1000 (mirrors web ChatStep). Round-trips through /api/agent/plan.
     */
    val localAmount: Double? = null,
    val localCurrency: String? = null,
) {
    /** Read-only steps need no signature — the client runs them inline. */
    val isReadOnly: Boolean
        get() = kind == "check_balance" || kind == "check_yield" || kind == "show_activity"
}

/** One parsed intent block: an ordered list of steps the agent proposes. */
@Serializable
data class AgentIntent(
    val steps: List<AgentStep> = emptyList(),
    val rationale: String? = null,
) {
    /**
     * True when every step is read-only — the card auto-runs inline with no
     * confirm step (e.g. "what's my balance + recent activity").
     */
    val isReadOnlyOnly: Boolean
        get() = steps.isNotEmpty() && steps.all { it.isReadOnly }
}

/**
 * Extracts the agent's `---INTENT---{json}---END---` block from a raw
 * assistant message. Mirrors `parseAssistantMessage` in `web/lib/chat/intent.ts`,
 * we only need the intent half here (the prose is stripped for display in
 * `ChatViewModel`).
 */
object AgentIntentParser {
    private val fence = Regex("---INTENT---\\s*([\\s\\S]*?)\\s*---END---")

    /**
     * Returns the first well-formed intent in `raw`, or null. A malformed
     * JSON body or an empty `steps` array yields null (never throws).
     */
    fun parse(raw: String): AgentIntent? {
        val match = fence.find(raw) ?: return null
        val json = match.groupValues.getOrNull(1)?.trim() ?: return null
        val intent = runCatching {
            ApiClient.json.decodeFromString<AgentIntent>(json)
        }.getOrNull() ?: return null
        return if (intent.steps.isEmpty()) null else intent
    }
}
