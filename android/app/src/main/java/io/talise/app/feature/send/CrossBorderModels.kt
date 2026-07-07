package io.talise.app.feature.send

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/**
 * Cross-border catalogue + draft — the Android port of iOS
 * `CrossBorder/CrossBorderModels.swift` and `CrossBorderFlowView.swift`'s
 * draft/step shapes.
 */

/** A pickable cross-border destination — country, payout currency, flag. */
data class CrossBorderCountry(
    /** ISO 3166-1 alpha-2 (e.g. "NG", "JP") — `toCountry` in the registry. */
    val code: String,
    val name: String,
    /** ISO 4217 payout currency ("NGN", "JPY"). */
    val currencyCode: String,
    /** Emoji flag for header texts. */
    val flag: String,
) {
    val currency: SendCurrency get() = SendCurrencies.find(currencyCode)
}

/** A pickable sender-side country (where fiat is collected). */
data class CrossBorderOrigin(
    val code: String,
    val name: String,
    val currencyCode: String,
    val flag: String,
) {
    val currency: SendCurrency get() = SendCurrencies.find(currencyCode)
}

object CrossBorderCatalogue {
    /** Sender-side countries with at least one registered corridor. */
    val origins: List<CrossBorderOrigin> = listOf(
        CrossBorderOrigin("US", "United States", "USD", "🇺🇸"),
        CrossBorderOrigin("JP", "Japan", "JPY", "🇯🇵"),
        CrossBorderOrigin("SG", "Singapore", "SGD", "🇸🇬"),
    )

    /**
     * All destinations the corridor registry names. Bookability is layered
     * on at runtime from `/api/corridors`, so a "planned" route appears
     * disabled rather than missing.
     */
    val destinations: List<CrossBorderCountry> = listOf(
        CrossBorderCountry("NG", "Nigeria", "NGN", "🇳🇬"),
        CrossBorderCountry("KE", "Kenya", "KES", "🇰🇪"),
        CrossBorderCountry("GH", "Ghana", "GHS", "🇬🇭"),
        CrossBorderCountry("ZA", "South Africa", "ZAR", "🇿🇦"),
        CrossBorderCountry("JP", "Japan", "JPY", "🇯🇵"),
        CrossBorderCountry("PH", "Philippines", "PHP", "🇵🇭"),
        CrossBorderCountry("ID", "Indonesia", "IDR", "🇮🇩"),
        CrossBorderCountry("VN", "Vietnam", "VND", "🇻🇳"),
        CrossBorderCountry("US", "United States", "USD", "🇺🇸"),
    )

    fun destination(code: String): CrossBorderCountry? =
        destinations.firstOrNull { it.code == code }

    fun origin(code: String?): CrossBorderOrigin? {
        if (code == null) return null
        return origins.firstOrNull { it.code == code.uppercase() }
    }

    /**
     * Resolve the sender's source country/currency from their profile
     * country. Falls back to the US (USD) origin — the live beachhead.
     */
    fun resolveOrigin(profileCountry: String?): CrossBorderOrigin =
        origin(profileCountry) ?: origins[0]
}

/** Zero-decimal payout currencies — no meaningless ".00". */
object CrossBorderFormat {
    private val zeroDecimalCurrencies = setOf("JPY", "VND", "IDR", "KRW", "NGN", "KES")

    fun decimals(currencyCode: String): Int =
        if (zeroDecimalCurrencies.contains(currencyCode)) 0 else 2

    /** Symbolic amount for a payout currency ("¥15,000", "₦1,650"). */
    fun payout(amount: Double, currencyCode: String): String {
        val currency = SendCurrencies.find(currencyCode)
        return sendSymbolic(amount, currency, decimals(currencyCode))
    }
}

/**
 * State the cross-border flow accumulates — iOS `CrossBorderDraft`. This
 * rail is server-authoritative end-to-end, so the draft holds the server's
 * locked quote verbatim rather than computing FX on device.
 */
class CrossBorderDraft(origin: CrossBorderOrigin) {
    /** Sender side — where fiat is collected. */
    var origin by mutableStateOf(origin)

    /** Destination the user picked. Null until they choose one. */
    var destination by mutableStateOf<CrossBorderCountry?>(null)

    /** Recipient text + the resolved on-chain address. */
    var recipientInput by mutableStateOf("")
    var resolved by mutableStateOf<SendResolvedRecipient?>(null)

    /** User-entered amount string, in the SOURCE currency. */
    var rawAmount by mutableStateOf("")

    /** The server-locked quote — source of truth for review + confirm. */
    var quote by mutableStateOf<CrossBorderQuoteDTO?>(null)

    /** Terminal outcome after confirm. */
    var confirmResult by mutableStateOf<CrossBorderConfirmDTO?>(null)

    /** Surfaced error (typed code from the contract, or transport). */
    var error by mutableStateOf<CrossBorderError?>(null)

    /** Parsed numeric amount in the source currency, or 0. */
    val amountSource: Double get() = rawAmount.trim().toDoubleOrNull() ?: 0.0
}

/** Cursor for the cross-border flow — separate from [SendStep]. */
enum class CrossBorderStep {
    Recipient,
    Amount,
    Review,
    Sending,
    Complete,
    Failure,
}
