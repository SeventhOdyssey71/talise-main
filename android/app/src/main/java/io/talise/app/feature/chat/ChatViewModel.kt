package io.talise.app.feature.chat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.talise.app.core.net.ChatClient
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.onCompletion
import kotlinx.coroutines.launch

/** One message in the Copilot thread. `streaming` marks the reply currently being typed. */
data class ChatMessage(
    val id: Long,
    val role: Role,
    val text: String,
    val streaming: Boolean = false,
) {
    enum class Role { User, Copilot }
}

data class ChatUiState(
    val messages: List<ChatMessage> = emptyList(),
    val sending: Boolean = false,
)

/**
 * Talise Copilot, drives `POST /api/chat/stream`. Mirrors the iOS Chat tab:
 * append the user turn, open the SSE stream, and grow the assistant bubble as
 * deltas arrive. Memory (recall + save to Walrus) is handled server-side per
 * turn, so there is nothing to persist on-device.
 */
class ChatViewModel : ViewModel() {
    private val _state = MutableStateFlow(ChatUiState())
    val state: StateFlow<ChatUiState> = _state.asStateFlow()

    private var nextId = 0L
    private fun id() = nextId++

    fun send(raw: String) {
        val text = raw.trim()
        if (text.isEmpty() || _state.value.sending) return

        val userMsg = ChatMessage(id(), ChatMessage.Role.User, text)
        val replyId = id()
        val reply = ChatMessage(replyId, ChatMessage.Role.Copilot, "", streaming = true)
        _state.value = _state.value.copy(
            messages = _state.value.messages + userMsg + reply,
            sending = true,
        )

        // The wire history is every prior turn plus this one (assistant turns
        // still mid-stream are excluded, they carry no content yet).
        val history = _state.value.messages
            .filter { !(it.id == replyId) && it.text.isNotEmpty() }
            .map {
                ChatClient.WireMessage(
                    role = if (it.role == ChatMessage.Role.User) "user" else "assistant",
                    content = it.text,
                )
            }

        viewModelScope.launch {
            val buffer = StringBuilder()
            ChatClient.stream(history)
                .catch {
                    if (buffer.isEmpty()) {
                        buffer.append("I lost the connection mid-thought. Try that again.")
                        updateReply(replyId, buffer.toString(), streaming = false)
                    }
                }
                .onCompletion {
                    updateReply(replyId, buffer.toString().ifEmpty { " " }, streaming = false)
                    _state.value = _state.value.copy(sending = false)
                }
                .collect { delta ->
                    buffer.append(delta)
                    updateReply(replyId, buffer.toString(), streaming = true)
                }
        }
    }

    private fun updateReply(id: Long, text: String, streaming: Boolean) {
        _state.value = _state.value.copy(
            messages = _state.value.messages.map {
                if (it.id == id) it.copy(text = text, streaming = streaming) else it
            },
        )
    }
}
