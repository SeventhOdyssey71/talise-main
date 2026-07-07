package io.talise.app.feature.wallet

import android.app.Application
import android.content.Context
import android.content.SharedPreferences
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.talise.app.core.net.ApiClient
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import retrofit2.http.GET

/**
 * State + data for the Currency pockets screen — the Android match for the
 * `@State` set on iOS `CurrencyPocketsView` plus the slice of `CurrencySettings`
 * (display code + FX rates) the view reads.
 */
data class WalletUiState(
    /** Fetched on appear so the hero + pocket rows render real money. Soft-fails to 0. */
    val usdBalance: Double = 0.0,
    val loading: Boolean = true,
    /** Pull-to-refresh in flight — iOS `.refreshable`. */
    val refreshing: Boolean = false,
    /** USD → code rates, iOS `CurrencySettings.rates`. Defaults to the USD baseline. */
    val rates: Map<String, Double> = mapOf("USD" to 1.0),
    /** Currency codes the user has pinned as pockets. Persisted across launches. */
    val pocketCodes: List<String> = emptyList(),
    /** Display currency code, iOS `CurrencySettings.current.code`. */
    val displayCode: String = "USD",
)

class WalletViewModel(app: Application) : AndroidViewModel(app) {
    private val prefs: SharedPreferences =
        app.getSharedPreferences("io.talise.app", Context.MODE_PRIVATE)

    private val _state = MutableStateFlow(
        WalletUiState(
            rates = FxRateStore.cached(prefs) ?: mapOf("USD" to 1.0),
            pocketCodes = CurrencyPocketStore.load(prefs),
            displayCode = prefs.getString(DISPLAY_CURRENCY_KEY, null) ?: "USD",
        )
    )
    val state: StateFlow<WalletUiState> = _state.asStateFlow()

    init {
        load()
    }

    /** iOS `load()`: balance soft-fails to whatever we had, then FX refreshes when stale. */
    fun load() {
        viewModelScope.launch {
            fetch()
            _state.update { it.copy(loading = false) }
        }
    }

    /** iOS `.refreshable { await load() }`. */
    fun refresh() {
        viewModelScope.launch {
            _state.update { it.copy(refreshing = true) }
            fetch()
            _state.update { it.copy(loading = false, refreshing = false) }
        }
    }

    private suspend fun fetch() {
        runCatching { ApiClient.api.balances() }
            .onSuccess { b -> _state.update { it.copy(usdBalance = b.usdsui) } }
        // Opportunistically refresh FX if the cache is stale so the pocket
        // rows don't quietly show day-old rates.
        if (FxRateStore.isStale(prefs)) {
            runCatching { walletFxApi.fx() }.getOrNull()
                ?.rates?.takeIf { it.isNotEmpty() }
                ?.let { r ->
                    _state.update { it.copy(rates = r) }
                    FxRateStore.save(prefs, r)
                }
        }
    }

    fun addPocket(code: String) {
        val codes = _state.value.pocketCodes
        if (codes.contains(code)) return
        val next = codes + code
        _state.update { it.copy(pocketCodes = next) }
        CurrencyPocketStore.save(prefs, next)
    }

    companion object {
        /** Same key CurrencySettings persists to on iOS ("io.talise.app.displayCurrency"). */
        const val DISPLAY_CURRENCY_KEY = "displayCurrency"
    }
}

// MARK: - Pocket persistence (iOS `CurrencyPocketStore`)

/**
 * Tiny SharedPreferences-backed store for the user's pinned pocket codes. Kept
 * separate from any display-currency preference so this additive feature owns
 * its own state.
 */
internal object CurrencyPocketStore {
    private const val KEY = "currencyPockets"

    fun load(prefs: SharedPreferences): List<String> {
        val stored = prefs.getString(KEY, null)?.split(",")?.filter { it.isNotBlank() } ?: emptyList()
        // Validate against supported set so a removed currency can't wedge the list.
        val supported = TaliseCurrency.allSupported.mapTo(mutableSetOf()) { it.code }
        val valid = stored.filter { supported.contains(it) }
        return valid.ifEmpty { defaultPockets(prefs) }
    }

    fun save(prefs: SharedPreferences, codes: List<String>) {
        prefs.edit().putString(KEY, codes.joinToString(",")).apply()
    }

    /** First-run default: the display currency plus USD, so the list is never empty. */
    private fun defaultPockets(prefs: SharedPreferences): List<String> {
        val display = prefs.getString(WalletViewModel.DISPLAY_CURRENCY_KEY, null) ?: "USD"
        return if (display == "USD") listOf("USD") else listOf(display, "USD")
    }
}

// MARK: - FX rate cache (iOS `CurrencySettings` rates persistence)

/**
 * Persists every successful `/api/fx` response so the next cold start renders
 * with real conversion factors instead of the 1.0 fallback, and tracks age so
 * a stale offline cache doesn't quietly persist for days (4h TTL, as iOS).
 */
internal object FxRateStore {
    private const val RATES_KEY = "fxRates"
    private const val RATES_AT_KEY = "fxRatesAt"
    private const val TTL_MS = 4L * 60 * 60 * 1000
    private val serializer = MapSerializer(String.serializer(), Double.serializer())

    fun cached(prefs: SharedPreferences): Map<String, Double>? =
        prefs.getString(RATES_KEY, null)
            ?.let { runCatching { ApiClient.json.decodeFromString(serializer, it) }.getOrNull() }
            ?.takeIf { it.isNotEmpty() }

    fun save(prefs: SharedPreferences, rates: Map<String, Double>) {
        prefs.edit()
            .putString(RATES_KEY, ApiClient.json.encodeToString(serializer, rates))
            .putLong(RATES_AT_KEY, System.currentTimeMillis())
            .apply()
    }

    fun isStale(prefs: SharedPreferences): Boolean {
        val ts = prefs.getLong(RATES_AT_KEY, 0L)
        return ts == 0L || System.currentTimeMillis() - ts > TTL_MS
    }
}

// MARK: - FX rates endpoint (iOS `CurrencySettings.refresh` → GET /api/fx)

@Serializable
internal data class WalletFxResponse(val rates: Map<String, Double> = emptyMap())

internal interface WalletFxApi {
    @GET("api/fx")
    suspend fun fx(): WalletFxResponse
}

internal val walletFxApi: WalletFxApi by lazy { ApiClient.create(WalletFxApi::class.java) }
