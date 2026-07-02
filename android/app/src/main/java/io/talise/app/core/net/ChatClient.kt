package io.talise.app.core.net

import io.talise.app.config.AppConfig
import io.talise.app.core.session.TaliseEvents
import io.talise.app.core.store.SecureStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.flowOn
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

/**
 * Streaming client for the Talise Copilot — `POST /api/chat/stream`, the exact
 * same Server-Sent-Events wire the iOS Chat tab consumes:
 *
 *   request  : { "messages": [ { "role": "user"|"assistant", "content": "…" } ] }
 *   response : a `text/event-stream` of `data: <json>\n\n` frames, where each
 *              json is `{"type":"text","value":"…"}` (incremental token) or
 *              `{"type":"done"}` (terminal).
 *
 * The reply is delivered as a cold [Flow] of text deltas so the UI can render
 * the answer as it streams. Recall + persistence to Walrus Memory happen
 * server-side per turn (per-wallet namespace), so the client stays thin —
 * exactly like iOS.
 */
object ChatClient {

    @Serializable
    data class WireMessage(val role: String, val content: String)

    @Serializable
    private data class ChatRequest(val messages: List<WireMessage>)

    @Serializable
    private data class Frame(
        val type: String,
        val value: String? = null,
        @SerialName("error") val error: String? = null,
    )

    // A dedicated client with a long read timeout — a streamed answer stays open
    // for the length of the reply. Bearer is attached per-request from SecureStore.
    private val streamClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.SECONDS) // no read timeout while streaming
        .build()

    private val jsonMedia = "application/json".toMediaType()

    /**
     * Stream Copilot's reply for the given conversation. Emits text deltas in
     * order; completes when the `done` frame arrives or the stream ends.
     */
    fun stream(messages: List<WireMessage>): Flow<String> = callbackFlow {
        val payload = ApiClient.json.encodeToString(ChatRequest(messages))
        val request = Request.Builder()
            .url(AppConfig.apiBaseUrl.trimEnd('/') + "/api/chat/stream")
            .post(payload.toRequestBody(jsonMedia))
            .apply { SecureStore.bearer?.let { header("Authorization", "Bearer $it") } }
            .header("Accept", "text/event-stream")
            .build()

        val call = streamClient.newCall(request)
        try {
            call.execute().use { response ->
                if (response.code == 401) {
                    TaliseEvents.emitSessionExpired()
                    close(IllegalStateException("session expired"))
                    return@use
                }
                if (!response.isSuccessful) {
                    close(IllegalStateException("chat failed: HTTP ${response.code}"))
                    return@use
                }
                val source = response.body?.source() ?: run {
                    close(IllegalStateException("empty response"))
                    return@use
                }
                // Read the event stream line by line. Each SSE data line is
                // `data: <json>`; blank lines separate frames.
                while (!source.exhausted()) {
                    val line = source.readUtf8Line() ?: break
                    if (!line.startsWith("data:")) continue
                    val jsonStr = line.removePrefix("data:").trim()
                    if (jsonStr.isEmpty()) continue
                    val frame = runCatching { ApiClient.json.decodeFromString<Frame>(jsonStr) }.getOrNull() ?: continue
                    when (frame.type) {
                        "text" -> frame.value?.let { if (it.isNotEmpty()) trySend(it) }
                        "done" -> { close(); return@use }
                    }
                }
                close()
            }
        } catch (t: Throwable) {
            close(t)
        }

        awaitClose { call.cancel() }
    }.flowOn(Dispatchers.IO)
}
