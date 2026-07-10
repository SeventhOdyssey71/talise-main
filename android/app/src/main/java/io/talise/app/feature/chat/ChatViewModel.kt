package io.talise.app.feature.chat

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.talise.app.core.net.ChatClient
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.util.UUID

/** Observable UI state for the Copilot chat (mirrors iOS `ChatViewModel`'s fields). */
data class ChatUiState(
    /** Transcript shown in the UI. Newest at the end. */
    val messages: List<ChatMessage> = emptyList(),
    /** Bound to the input pill at the bottom of the chat tab. */
    val input: String = "",
    /** True while we are reading from the SSE stream. */
    val streaming: Boolean = false,
    /** Surface-level error banner. Cleared on the next submit. */
    val lastError: String? = null,
    /** Saved past chats, newest-first — shown in the compact history sheet. */
    val conversations: List<ChatConversation> = emptyList(),
)

/**
 * View model for the streaming Copilot chat — the exact port of iOS
 * `ChatViewModel.swift`. Owns the transcript, the in-flight stream job, and the
 * incremental decoder. Streaming rides `ChatClient` (`POST /api/chat/stream`);
 * the assistant's `---INTENT---{json}---END---` fence is accumulated raw,
 * stripped from the displayed prose each delta, and parsed into an
 * [AgentIntent] once the stream closes. Completed chats persist to
 * [ChatConversationStore] so they're one tap away in the history sheet, and the
 * agent always OPENS on a fresh chat.
 */
class ChatViewModel(app: Application) : AndroidViewModel(app) {

    private val _state = MutableStateFlow(ChatUiState())
    val state: StateFlow<ChatUiState> = _state.asStateFlow()

    private var streamJob: Job? = null

    /**
     * Un-stripped accumulator per in-flight assistant message. We keep the FULL
     * raw stream (including the `---INTENT---…---END---` fence) here and derive
     * the displayed `content` from it each delta — both so a fence split across
     * SSE chunks never flashes half-rendered JSON, and so we can parse the
     * intent once the stream completes. Cleared on finalize.
     */
    private val streamRaw = mutableMapOf<String, String>()

    /** The chat currently on screen. A fresh chat gets a new id, only saved once it has a real message. */
    private var currentId: String = UUID.randomUUID().toString()

    init {
        viewModelScope.launch {
            val saved = ChatConversationStore.loadAll(getApplication<Application>())
            _state.value = _state.value.copy(conversations = saved)
        }
    }

    fun setInput(text: String) {
        _state.value = _state.value.copy(input = text)
    }

    /**
     * User tapped a suggested-prompt chip. Drop the prompt into the input field
     * rather than auto-submitting — gives the user a chance to edit the wording.
     */
    fun fillPrompt(text: String) {
        _state.value = _state.value.copy(input = text)
    }

    /** Start a fresh chat (the previous one is already in `conversations`). */
    fun newChat() {
        streamJob?.cancel(); streamJob = null
        streamRaw.clear()
        currentId = UUID.randomUUID().toString()
        _state.value = _state.value.copy(messages = emptyList(), streaming = false, lastError = null)
    }

    /** Open a saved chat from the history sheet. */
    fun open(id: String) {
        streamJob?.cancel(); streamJob = null
        streamRaw.clear()
        val c = _state.value.conversations.firstOrNull { it.id == id } ?: return
        currentId = c.id
        _state.value = _state.value.copy(messages = c.messages, streaming = false, lastError = null)
    }

    /** Delete a saved chat. */
    fun deleteConversation(id: String) {
        val remaining = _state.value.conversations.filterNot { it.id == id }
        _state.value = _state.value.copy(conversations = remaining)
        viewModelScope.launch { ChatConversationStore.saveAll(getApplication<Application>(), remaining) }
        if (id == currentId) newChat()
    }

    /** Upsert the current transcript into history. No-op for a blank chat. */
    private fun persistCurrent() {
        val real = _state.value.messages.filterNot { it.role == ChatMessage.Role.Assistant && it.streaming }
        val firstUser = real.firstOrNull { it.role == ChatMessage.Role.User } ?: return
        val raw = firstUser.content.trim()
        val title = if (raw.isEmpty()) "New chat" else raw.take(48)
        val convo = ChatConversation(id = currentId, title = title, messages = real, updatedAtMs = System.currentTimeMillis())
        val list = listOf(convo) + _state.value.conversations.filterNot { it.id == currentId }
        _state.value = _state.value.copy(conversations = list)
        viewModelScope.launch { ChatConversationStore.saveAll(getApplication<Application>(), list) }
    }

    /** Message ids whose confirmed intent is executing. Guards double-runs from a re-composed card. */
    private val executingIntents = mutableSetOf<String>()

    /**
     * Run a confirmed agent plan on [viewModelScope] so real money movement
     * survives the intent card's composable (which dies when the row scrolls
     * out of the LazyColumn, another chat is opened, or the route closes).
     * The outcome is recorded on the transcript here, whether or not the card
     * is still on screen to receive [onResult].
     */
    fun executeIntent(
        messageId: String,
        plan: AgentPlanDTO,
        intent: AgentIntent,
        onResult: (results: List<AgentActionResult>?, error: String?) -> Unit,
    ) {
        if (!executingIntents.add(messageId)) return
        viewModelScope.launch {
            try {
                val results = AgentExecutor.execute(plan, intent)
                if (results.isNotEmpty()) recordExecution(messageId, results)
                onResult(results, null)
            } catch (ce: CancellationException) {
                throw ce
            } catch (t: Throwable) {
                onResult(null, t.message ?: "Couldn't complete that. Please try again.")
            } finally {
                executingIntents.remove(messageId)
            }
        }
    }

    /**
     * Record a confirmed intent's outcome on its assistant turn and persist, so
     * reopening this chat shows the receipt rather than re-prompting.
     */
    fun recordExecution(messageId: String, results: List<AgentActionResult>) {
        _state.value = _state.value.copy(
            messages = _state.value.messages.map {
                if (it.id == messageId) it.copy(executed = results) else it
            },
        )
        persistCurrent()
    }

    /**
     * Re-run the user prompt that produced this assistant turn: drop that turn
     * (and anything after it) and stream a fresh reply.
     */
    fun regenerate(messageId: String) {
        if (_state.value.streaming) return
        val messages = _state.value.messages
        val idx = messages.indexOfFirst { it.id == messageId }
        if (idx < 0 || messages[idx].role != ChatMessage.Role.Assistant) return
        if (messages.take(idx).none { it.role == ChatMessage.Role.User }) return

        val assistantId = UUID.randomUUID().toString()
        _state.value = _state.value.copy(
            messages = messages.take(idx) + ChatMessage(id = assistantId, role = ChatMessage.Role.Assistant, content = "", streaming = true),
            streaming = true,
            lastError = null,
        )
        streamJob = viewModelScope.launch { runStream(assistantId) }
    }

    /** Submit the current input. No-op if empty or already streaming. */
    fun send() {
        val text = _state.value.input.trim()
        if (text.isEmpty() || _state.value.streaming) return

        val userMessage = ChatMessage(role = ChatMessage.Role.User, content = text)
        // Insert a placeholder assistant message that we'll mutate as SSE deltas
        // arrive. Compose re-renders the same row in place.
        val assistantId = UUID.randomUUID().toString()
        _state.value = _state.value.copy(
            messages = _state.value.messages + userMessage +
                ChatMessage(id = assistantId, role = ChatMessage.Role.Assistant, content = "", streaming = true),
            input = "",
            streaming = true,
            lastError = null,
        )
        streamJob = viewModelScope.launch { runStream(assistantId) }
    }

    private suspend fun runStream(assistantId: String) {
        // Send only the settled turns — assistant turns mid-stream carry no content.
        val history = _state.value.messages
            .filter { !it.streaming || it.role == ChatMessage.Role.User }
            .map {
                ChatClient.WireMessage(
                    role = if (it.role == ChatMessage.Role.User) "user" else "assistant",
                    content = it.content,
                )
            }

        var failure: String? = null
        try {
            ChatClient.stream(history).collect { delta -> appendAssistant(delta, assistantId) }
        } catch (ce: CancellationException) {
            throw ce
        } catch (t: Throwable) {
            failure = t.message ?: "connection failed"
        }
        if (failure != null) finalizeWithError(assistantId, failure) else finalize(assistantId)
        _state.value = _state.value.copy(streaming = false)
        streamJob = null
    }

    private fun appendAssistant(text: String, id: String) {
        // The Talise agent emits structured `---INTENT---{...}---END---` blocks
        // inline. They're the agent's machine-readable payload, not text for the
        // user. Accumulate the FULL raw stream (fence included) and derive the
        // displayed content by stripping the fence each delta.
        val raw = (streamRaw[id] ?: "") + text
        streamRaw[id] = raw
        val stripped = stripIntentBlocks(raw)
        _state.value = _state.value.copy(
            messages = _state.value.messages.map {
                if (it.id == id) it.copy(content = stripped) else it
            },
        )
    }

    /**
     * Removes any `---INTENT---{json}---END---` fence (and trailing blank lines
     * it leaves) from a string. Handles partial blocks mid-stream: an open fence
     * with no closing tag yet is trimmed to the end of the buffer, so we don't
     * flash a half-rendered `---INTENT---{"steps":[…` to the user.
     */
    private fun stripIntentBlocks(s: String): String {
        var out = s
        while (true) {
            val open = out.indexOf("---INTENT---")
            if (open < 0) break
            val close = out.indexOf("---END---", startIndex = open + "---INTENT---".length)
            out = if (close >= 0) {
                out.removeRange(open, close + "---END---".length)
            } else {
                // Open fence with no close yet — we're still mid-stream. Hide
                // from the open marker to the end of the buffer.
                out.substring(0, open)
            }
            if (close < 0) break
        }
        return out.replace("\n\n\n", "\n\n").trim()
    }

    private fun finalize(assistantId: String) {
        val raw = streamRaw[assistantId]
        _state.value = _state.value.copy(
            messages = _state.value.messages.map { msg ->
                if (msg.id != assistantId) return@map msg
                // Parse the agent's intent block (if any) from the full raw
                // stream now that it's closed — the UI renders an
                // AgentIntentCard beneath the bubble.
                val intent = raw?.let { AgentIntentParser.parse(it) }
                // An empty turn with no action card means the stream closed with
                // no text + no intent. Show an honest, visible note rather than
                // silently removing it.
                val content = if (msg.content.isEmpty() && intent == null) {
                    if (raw.isNullOrEmpty()) {
                        "I didn't get a reply. Nothing came back from the server, try again."
                    } else {
                        "I got a response but couldn't read it. Try again."
                    }
                } else {
                    msg.content
                }
                msg.copy(streaming = false, intent = intent, content = content)
            },
        )
        streamRaw.remove(assistantId)
        persistCurrent()
    }

    private fun finalizeWithError(assistantId: String, message: String) {
        _state.value = _state.value.copy(
            messages = _state.value.messages.map { msg ->
                if (msg.id != assistantId) return@map msg
                msg.copy(
                    streaming = false,
                    content = msg.content.ifEmpty { "Couldn't reach the assistant. $message" },
                )
            },
            lastError = message,
        )
        streamRaw.remove(assistantId)
        persistCurrent()
    }
}
