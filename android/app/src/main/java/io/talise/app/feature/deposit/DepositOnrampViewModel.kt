package io.talise.app.feature.deposit

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.talise.app.core.net.ApiClient
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import retrofit2.HttpException
import java.io.IOException
import java.text.NumberFormat
import java.util.Locale

/** Which amount the user has picked — iOS `AmountChoice`. */
sealed interface AmountChoice {
    data class Preset(val value: Int) : AmountChoice
    data object Custom : AmountChoice
}

/** Mirror of iOS `DepositOnrampView`'s `@State` set, 1:1. */
data class OnrampUiState(
    val selected: AmountChoice = AmountChoice.Preset(100),
    val customText: String = "",
    val loading: Boolean = false,
    val errorMessage: String? = null,
    /** `crypto.link.com` URL to open in the browser; UI consumes then clears it. */
    val launchUrl: String? = null,
    /** Bottom capsule toast during the post-browser balance poll. */
    val pollingToast: String? = null,
    /** True once the flow should close (credit detected or poll timed out). */
    val finished: Boolean = false,
)

val OnrampUiState.isCustom: Boolean get() = selected is AmountChoice.Custom

/**
 * Numeric amount the user has picked — for chips it's the preset, for custom
 * it's the parsed text (0 on garbage). EU users on a decimal pad get "," as
 * their decimal separator; we resolve that by converting the LAST comma to a
 * period if there's no period in the string (e.g. "1500,50" -> "1500.50")
 * AFTER stripping any earlier grouping commas.
 */
val OnrampUiState.amountUsd: Double
    get() = when (val sel = selected) {
        is AmountChoice.Preset -> sel.value.toDouble()
        AmountChoice.Custom -> {
            var s = customText.trim()
            if (!s.contains(".")) {
                val last = s.lastIndexOf(',')
                if (last >= 0 && s.length - last <= 3) {
                    s = s.substring(0, last) + "." + s.substring(last + 1)
                }
            }
            s = s.replace(",", "")
            s.toDoubleOrNull() ?: 0.0
        }
    }

/**
 * Big display line — honours the user's keystrokes (decimals + partial
 * digits) but injects thousands separators on whole-number runs so 1500
 * reads as "1,500" the moment they pause.
 */
val OnrampUiState.displayAmount: String
    get() = when (val sel = selected) {
        is AmountChoice.Preset -> formatGrouped(sel.value)
        AmountChoice.Custom -> {
            if (customText.isEmpty()) "0"
            else {
                val cleaned = customText.replace(",", "")
                val dot = cleaned.indexOf('.')
                if (dot >= 0) {
                    val whole = cleaned.substring(0, dot)
                    val frac = cleaned.substring(dot + 1)
                    whole.toIntOrNull()?.let { "${formatGrouped(it)}.$frac" } ?: cleaned
                } else {
                    cleaned.toIntOrNull()?.let { formatGrouped(it) } ?: cleaned
                }
            }
        }
    }

val OnrampUiState.canPay: Boolean
    get() = amountUsd >= DepositOnrampViewModel.MIN_USD && amountUsd <= DepositOnrampViewModel.MAX_USD

/** Whole-number -> `1,000` formatter, symbol kept separate for the big display. */
internal fun formatGrouped(value: Int): String = String.format(Locale.US, "%,d", value)

internal fun formatUsd(amount: Double): String {
    val fmt = NumberFormat.getCurrencyInstance(Locale.US)
    fmt.maximumFractionDigits = 2
    return fmt.format(amount)
}

/**
 * Stripe hosted-onramp flow — Android counterpart of the logic inside iOS
 * `DepositOnrampView`: snapshot balance, create a hosted session, open the
 * `crypto.link.com` URL in the browser, then poll the balance for up to 90s
 * after the user returns and infer credit from a positive delta (Stripe
 * doesn't deep-link back into the app for completion).
 */
class DepositOnrampViewModel : ViewModel() {

    companion object {
        const val MIN_USD = 1.0
        // Soft-launch cap. Stripe's first-time-buyer KYC threshold sits just
        // above this, so $2k keeps the onramp friction-free for ~95% of pilot
        // users. Server clamp matches — see api/onramp/hosted-session/route.ts.
        const val MAX_USD = 2_000.0
        val PRESETS = listOf(100, 250, 500, 1_000)
    }

    private val onrampApi: OnrampApi = ApiClient.create(OnrampApi::class.java)

    private val _state = MutableStateFlow(OnrampUiState())
    val state: StateFlow<OnrampUiState> = _state.asStateFlow()

    /** Pre-purchase USDsui balance so the poll can detect the credit. */
    private var startingBalance: Double = 0.0

    /** True while we expect the next ON_RESUME to mean "back from Stripe". */
    private var awaitingBrowserReturn = false

    private var pollingActive = false

    fun selectPreset(value: Int) {
        _state.update { it.copy(selected = AmountChoice.Preset(value), errorMessage = null) }
    }

    fun selectCustom() {
        _state.update { s ->
            // Seed the custom field with whatever preset was previously
            // selected so the user doesn't lose the amount they had picked.
            val seeded = (s.selected as? AmountChoice.Preset)?.value?.toString() ?: s.customText
            s.copy(
                selected = AmountChoice.Custom,
                customText = if (s.isCustom) s.customText else seeded,
                errorMessage = null,
            )
        }
    }

    fun updateCustomText(text: String) {
        _state.update { it.copy(customText = text) }
    }

    fun buy() {
        val snapshot = _state.value
        if (!snapshot.canPay) {
            _state.update {
                it.copy(errorMessage = "Enter an amount between $${formatGrouped(MIN_USD.toInt())} and $${formatGrouped(MAX_USD.toInt())}.")
            }
            return
        }
        _state.update { it.copy(errorMessage = null, loading = true) }
        val amount = snapshot.amountUsd

        viewModelScope.launch {
            // Snapshot the pre-purchase USDsui balance so the polling loop
            // after the browser return can detect the credit. Don't fail the
            // purchase if the read fails — we'll just show the pending toast.
            startingBalance = try {
                ApiClient.api.balances().usdsui
            } catch (_: Exception) {
                0.0
            }

            try {
                val resp = onrampApi.hostedSession(OnrampHostedSessionRequest(amount = amount))
                _state.update { it.copy(launchUrl = resp.redirectUrl, loading = false) }
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, errorMessage = userMessage(e)) }
            }
        }
    }

    /** UI consumed [OnrampUiState.launchUrl] and opened the browser. */
    fun browserLaunched() {
        awaitingBrowserReturn = true
        _state.update { it.copy(launchUrl = null) }
    }

    /**
     * Called on every ON_RESUME. If we sent the user to Stripe, poll the
     * balance for up to 90s and infer credit from a positive delta.
     */
    fun onResumed() {
        if (!awaitingBrowserReturn) return
        awaitingBrowserReturn = false
        pollingActive = true
        _state.update { it.copy(pollingToast = "Checking for your deposit…") }

        viewModelScope.launch {
            val deadline = System.currentTimeMillis() + 90_000L
            val cadenceMs = 3_000L
            while (System.currentTimeMillis() < deadline && pollingActive) {
                val bal = try {
                    ApiClient.api.balances()
                } catch (_: Exception) {
                    null
                }
                if (bal != null) {
                    val delta = bal.usdsui - startingBalance
                    // Anything above $0.01 means new funds landed. Stripe
                    // charges a fee so the credited USDC is slightly less
                    // than the requested amount — never compare against the
                    // requested amount directly.
                    if (delta >= 0.01) {
                        pollingActive = false
                        _state.update { it.copy(pollingToast = "Added ${formatUsd(delta)} USDsui to your wallet") }
                        delay(1_400)
                        _state.update { it.copy(finished = true) }
                        return@launch
                    }
                }
                delay(cadenceMs)
            }
            // Timed out — funds may still be processing on Stripe's side.
            pollingActive = false
            _state.update { it.copy(pollingToast = "Your purchase is processing - funds usually arrive within 2 minutes.") }
            delay(1_800)
            _state.update { it.copy(finished = true) }
        }
    }

    /** Friendly one-liner for the inline error label — iOS `APIError.userMessage`. */
    private fun userMessage(e: Exception): String = when (e) {
        is HttpException -> {
            if (e.code() == 401) {
                "Please sign in again to continue."
            } else {
                val serverError = try {
                    e.response()?.errorBody()?.string()?.let { body ->
                        ApiClient.json.parseToJsonElement(body).jsonObject["error"]?.jsonPrimitive?.content
                    }
                } catch (_: Exception) {
                    null
                }
                serverError ?: "Stripe rejected the request. Please try again."
            }
        }
        is IOException -> "Network hiccup - check your connection and try again."
        else -> "Couldn't start your purchase. Please try again."
    }
}
