package io.talise.app.feature.home

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import io.talise.app.core.model.ActivityEntryDTO
import io.talise.app.core.model.BalancesDTO
import io.talise.app.core.net.ApiClient
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.jsonArray

/**
 * Persists the last-known Home-screen data snapshots so the app can render
 * real numbers on the very first frame instead of showing placeholders while
 * the network loads. Android port of iOS `LocalSnapshotStore`, backed by
 * DataStore preferences instead of UserDefaults.
 *
 * Keys are scoped per-user (by `userId`) so switching accounts doesn't
 * cross-pollinate. No bearer token or key material is ever stored here.
 *
 * Also owns the app-wide privacy-eye flag (iOS `@AppStorage("talise.amountsHidden")`).
 */
private val Context.homeSnapshotDataStore: DataStore<Preferences> by preferencesDataStore(name = "home_snapshots")

internal class HomeSnapshotStore(private val context: Context) {

    private fun key(base: String, userId: String) = stringPreferencesKey("io.talise.snapshot.$base.$userId")
    private fun tsKey(base: String, userId: String) = longPreferencesKey("io.talise.snapshot.$base.ts.$userId")
    private val amountsHiddenKey = booleanPreferencesKey("talise.amountsHidden")

    private suspend fun prefs(): Preferences =
        context.homeSnapshotDataStore.data.catch { emit(emptyPreferences()) }.first()

    private suspend fun ageSeconds(base: String, userId: String): Long? {
        val t = prefs()[tsKey(base, userId)] ?: return null
        return (System.currentTimeMillis() - t) / 1000
    }

    // ── Privacy eye ─────────────────────────────────────────────────────────

    val amountsHidden: Flow<Boolean> =
        context.homeSnapshotDataStore.data
            .catch { emit(emptyPreferences()) }
            .map { it[amountsHiddenKey] ?: false }

    suspend fun setAmountsHidden(hidden: Boolean) {
        runCatching { context.homeSnapshotDataStore.edit { it[amountsHiddenKey] = hidden } }
    }

    // ── Balances ────────────────────────────────────────────────────────────

    suspend fun loadBalances(userId: String): BalancesDTO? {
        val raw = prefs()[key("balances", userId)] ?: return null
        return runCatching { ApiClient.json.decodeFromString(BalancesDTO.serializer(), raw) }.getOrNull()
    }

    /**
     * Last-known balance for instant paint, but ONLY if saved within
     * [maxAgeSec]. Beyond the window callers fall back to [loadBalances].
     */
    suspend fun loadBalancesIfFresh(userId: String, maxAgeSec: Long): BalancesDTO? {
        val age = ageSeconds("balances", userId) ?: return null
        if (age > maxAgeSec) return null
        return loadBalances(userId)
    }

    suspend fun saveBalances(dto: BalancesDTO, userId: String) {
        runCatching {
            val raw = ApiClient.json.encodeToString(BalancesDTO.serializer(), dto)
            context.homeSnapshotDataStore.edit {
                it[key("balances", userId)] = raw
                it[tsKey("balances", userId)] = System.currentTimeMillis()
            }
        }
    }

    // ── Activity ────────────────────────────────────────────────────────────

    /** Maximum entries cached. Matches the /api/activity?limit= we use. */
    private val activityCap = 20

    suspend fun loadActivity(userId: String): List<ActivityEntryDTO>? {
        val raw = prefs()[key("activity", userId)] ?: return null
        // Tolerant per-row decode — a single shape change (e.g. an app update
        // that added a field) must not discard the whole cached feed.
        return runCatching {
            ApiClient.json.parseToJsonElement(raw).jsonArray.mapNotNull { el ->
                runCatching {
                    ApiClient.json.decodeFromJsonElement(ActivityEntryDTO.serializer(), el)
                }.getOrNull()
            }
        }.getOrNull()
    }

    /**
     * Last-known activity for instant paint, but ONLY if saved within
     * [maxAgeSec], the guard that stops a days-old feed from being shown as
     * "Recent". Older than the window returns null so the view loads fresh.
     */
    suspend fun loadActivityIfFresh(userId: String, maxAgeSec: Long): List<ActivityEntryDTO>? {
        val age = ageSeconds("activity", userId) ?: return null
        if (age > maxAgeSec) return null
        return loadActivity(userId)
    }

    suspend fun saveActivity(entries: List<ActivityEntryDTO>, userId: String) {
        runCatching {
            val capped = entries.take(activityCap)
            val raw = ApiClient.json.encodeToString(ListSerializer(ActivityEntryDTO.serializer()), capped)
            context.homeSnapshotDataStore.edit {
                it[key("activity", userId)] = raw
                it[tsKey("activity", userId)] = System.currentTimeMillis()
            }
        }
    }
}
