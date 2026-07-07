package io.talise.app.feature.chat

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import io.talise.app.core.net.ApiClient
import kotlinx.coroutines.flow.first
import kotlinx.serialization.encodeToString

/**
 * On-device store for the agent's conversations — the Android counterpart of
 * iOS `ChatConversationStore` (Keychain-backed there, DataStore preferences
 * here). One preference key holds a JSON array of [ChatConversation],
 * newest-first, capped, so past chats are one tap away without piling up into
 * one endless transcript (the agent always opens on a fresh chat).
 */
private val Context.chatConversationsDataStore by preferencesDataStore(name = "talise_chat_conversations")

object ChatConversationStore {
    const val CONVERSATION_CAP = 30
    const val MESSAGE_CAP = 60

    private val ALL = stringPreferencesKey("all")

    suspend fun loadAll(context: Context): List<ChatConversation> {
        val raw = context.chatConversationsDataStore.data.first()[ALL] ?: return emptyList()
        val all = runCatching {
            ApiClient.json.decodeFromString<List<ChatConversation>>(raw)
        }.getOrDefault(emptyList())
        return all.sortedByDescending { it.updatedAtMs }
    }

    suspend fun saveAll(context: Context, conversations: List<ChatConversation>) {
        val trimmed = conversations
            .sortedByDescending { it.updatedAtMs }
            .take(CONVERSATION_CAP)
            .map { it.copy(messages = it.messages.takeLast(MESSAGE_CAP)) }
        val encoded = runCatching {
            ApiClient.json.encodeToString(trimmed)
        }.getOrNull() ?: return
        context.chatConversationsDataStore.edit { it[ALL] = encoded }
    }
}
