package io.talise.app.feature.chat

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.util.UUID

/**
 * Domain model for the Copilot chat — the Android port of iOS `ChatModels.swift`
 * + `ChatConversationStore.swift`'s `ChatConversation` + `AgentExecutor.swift`'s
 * `AgentActionResult`. Every type is `@Serializable` so the transcript persists
 * to DataStore as JSON and round-trips across app relaunches (same guarantee
 * the iOS Keychain store gives).
 */
@Serializable
data class ChatMessage(
    val id: String = UUID.randomUUID().toString(),
    val role: Role,
    val content: String = "",
    /** True while the assistant is still receiving SSE token deltas. */
    val streaming: Boolean = false,
    /** Parsed Talise Agent intent (the `---INTENT---{json}---END---` block). */
    val intent: AgentIntent? = null,
    /** Outcome of an executed intent — persisted so a reopened chat shows the receipt. */
    val executed: List<AgentActionResult>? = null,
    /** When the turn was created (epoch ms) — the small timestamp under the bubble. */
    val dateMs: Long? = System.currentTimeMillis(),
) {
    @Serializable
    enum class Role {
        @SerialName("user") User,
        @SerialName("assistant") Assistant,
    }
}

/** A saved agent conversation — a titled transcript with a timestamp. */
@Serializable
data class ChatConversation(
    val id: String = UUID.randomUUID().toString(),
    val title: String = "New chat",
    val messages: List<ChatMessage> = emptyList(),
    val updatedAtMs: Long = System.currentTimeMillis(),
)

/**
 * One executed step's outcome: a human line plus the structured bits needed to
 * render a shareable receipt (amount, who, on-chain digest). Persisted with the
 * conversation so reopening a saved chat shows the "Done" receipt instead of
 * re-prompting to confirm a transfer that already happened.
 */
@Serializable
data class AgentActionResult(
    val id: String = UUID.randomUUID().toString(),
    val line: String,
    val kind: String = "",
    val amountUsd: Double? = null,
    val recipient: String? = null,
    val venue: String? = null,
    val digest: String? = null,
    /** Shareable payment link (for a `request` step). Null for money steps. */
    val link: String? = null,
)
