package io.talise.app.feature.profile

import android.content.Context
import androidx.compose.runtime.mutableStateOf
import io.talise.app.feature.wallet.TaliseCurrency

/**
 * Display-currency preference — Android match for iOS `CurrencySettings.shared`
 * (UserDefaults-backed singleton with a published `current`). Reuses the shared
 * [TaliseCurrency] model from the wallet feature so codes/symbols stay in sync.
 */
internal object CurrencySettings {
    private const val PREFS = "talise_settings"
    private const val KEY = "display_currency"

    /** Observable current selection — Compose recomposes on [set]. */
    val current = mutableStateOf(TaliseCurrency.usd)

    fun load(context: Context) {
        val code = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY, "USD") ?: "USD"
        current.value = TaliseCurrency.find(code)
    }

    fun set(context: Context, c: TaliseCurrency) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putString(KEY, c.code).apply()
        current.value = c
    }
}
