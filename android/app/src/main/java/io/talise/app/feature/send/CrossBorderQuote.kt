package io.talise.app.feature.send

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlin.math.ceil
import kotlin.math.max

/**
 * Cross-border send support (master plan §8) — the Android port of iOS
 * `CrossBorderQuote.swift`.
 *
 * Everything here is ADDITIVE and dormant for single-currency sends: when
 * the recipient's display currency matches the sender's, `isCrossCurrency`
 * is false and the Amount/Review screens render exactly as before. Talise
 * still settles in USDsui (1:1 USD) on chain — this file owns the math
 * that turns one FX snapshot into a transparent, locked quote.
 */

// ── Currency catalogue (feature-local; iOS TaliseCurrency + allKnown) ───────

/** User-facing display currency. */
data class SendCurrency(val code: String, val symbol: String, val name: String)

object SendCurrencies {
    /** The display currencies iOS supports plus the corridor extras. */
    val allSupported: List<SendCurrency> = listOf(
        SendCurrency("USD", "$", "US Dollar"),
        SendCurrency("NGN", "₦", "Nigerian Naira"),
        SendCurrency("GHS", "₵", "Ghanaian Cedi"),
        SendCurrency("KES", "KSh", "Kenyan Shilling"),
        SendCurrency("EUR", "€", "Euro"),
        SendCurrency("GBP", "£", "British Pound"),
        SendCurrency("CAD", "CA$", "Canadian Dollar"),
        SendCurrency("ZAR", "R", "South African Rand"),
        SendCurrency("JPY", "¥", "Japanese Yen"),
        SendCurrency("SGD", "S$", "Singapore Dollar"),
        SendCurrency("PHP", "₱", "Philippine Peso"),
        SendCurrency("IDR", "Rp", "Indonesian Rupiah"),
        SendCurrency("VND", "₫", "Vietnamese Dong"),
    )

    val usd: SendCurrency = allSupported[0]

    fun find(code: String): SendCurrency =
        allSupported.firstOrNull { it.code == code } ?: usd

    /** Zero-decimal (large-unit) currencies render without ".00". */
    private val zeroDecimal = setOf("JPY", "VND", "IDR", "KRW")

    /**
     * Recipient-side symbolic formatting with decimals suited to the
     * currency (¥/₫/Rp → 0 decimals, the rest → 2).
     */
    fun recipientSymbolic(amount: Double, currency: SendCurrency): String {
        val decimals = if (zeroDecimal.contains(currency.code)) 0 else 2
        return sendSymbolic(amount, currency, decimals)
    }
}

// ── FX rates (display only — never in the send/limit money path) ────────────

/**
 * Process-local FX snapshot, hydrated from `GET /api/fx`. Soft-fails to a
 * USD-only baseline so single-currency sends are never blocked by a rate
 * fetch. Mirrors iOS `CurrencySettings.rates` for the send flow's needs.
 */
object SendFx {
    var rates: Map<String, Double> by mutableStateOf(mapOf("USD" to 1.0))
        private set

    fun rate(code: String): Double = rates[code] ?: 1.0

    suspend fun refresh() {
        runCatching { SendApiClient.api.fx() }
            .onSuccess { if (it.rates.isNotEmpty()) rates = it.rates }
    }
}

// ── Quote model ─────────────────────────────────────────────────────────────

/**
 * A locked cross-border quote, computed once when the Review screen appears
 * and held for [holdSeconds]. Every field is presentation-ready.
 *
 * Money model, all USDsui-denominated internally (1:1 USD):
 *   senderUsdsui — what leaves the sender's wallet before spread.
 *   spreadUsdsui — the explicit fee (a slice of senderUsdsui).
 *   netUsdsui    — senderUsdsui minus spreadUsdsui, the value delivered.
 */
class ClientCrossBorderQuote(
    val senderCurrency: SendCurrency,
    val recipientCurrency: SendCurrency,
    amountUsdsui: Double,
    senderFxRate: Double,
    recipientFxRate: Double,
    val spreadBps: Int = DEFAULT_SPREAD_BPS,
    val holdSeconds: Long = 30,
    val lockedAt: Long = System.currentTimeMillis(),
) {
    /** USDsui units the sender is moving — the on-chain settlement value. */
    val senderUsdsui: Double = max(0.0, amountUsdsui)

    /** Sender-currency rate vs USD (units of sender ccy per 1 USD). */
    private val senderRate: Double = if (senderFxRate > 0) senderFxRate else 1.0

    /** Recipient-currency rate vs USD. */
    private val recipientRate: Double = if (recipientFxRate > 0) recipientFxRate else 1.0

    /** Explicit spread fee, in USDsui — surfaced as a fee line, never hidden. */
    val spreadUsdsui: Double = senderUsdsui * (spreadBps.toDouble() / 10_000.0)

    /** Locked sender → recipient rate, derived from the two USD legs. */
    val lockedRate: Double = recipientRate / senderRate

    /** Net USDsui delivered to the recipient (after spread). */
    val netUsdsui: Double get() = max(0.0, senderUsdsui - spreadUsdsui)

    /** Total debit from the sender, in their own currency units. */
    val senderDebitLocal: Double get() = senderUsdsui * senderRate

    /** Spread fee expressed in the sender's currency. */
    val spreadLocal: Double get() = spreadUsdsui * senderRate

    /** Guaranteed receive amount, in the recipient's currency units. */
    val recipientReceiveLocal: Double get() = netUsdsui * recipientRate

    /** Seconds remaining on the hold, clamped to 0. */
    fun secondsRemaining(now: Long = System.currentTimeMillis()): Int {
        val elapsedMs = now - lockedAt
        return max(0, ceil((holdSeconds * 1000.0 - elapsedMs) / 1000.0).toInt())
    }

    /** True once the hold has lapsed and the quote must be re-locked. */
    fun isExpired(now: Long = System.currentTimeMillis()): Boolean =
        now - lockedAt >= holdSeconds * 1000

    /** "1 ₦ = $0.00067" style locked-rate string. */
    val rateLine: String
        get() {
            val recip = sendSymbolic(lockedRate, recipientCurrency, rateDecimals(lockedRate))
            return "1 ${senderCurrency.symbol} = $recip"
        }

    /** Sensible decimal count so the rate never collapses to "0.00". */
    private fun rateDecimals(v: Double): Int = when {
        v == 0.0 -> 2
        v >= 100 -> 0
        v >= 1 -> 2
        v >= 0.01 -> 4
        else -> 6
    }

    companion object {
        /** Default cross-border spread — ~25 bps (Paga off-ramp reference). */
        const val DEFAULT_SPREAD_BPS: Int = 25

        /**
         * Best-effort inference of a recipient's home display currency from
         * the resolved display name / handle. Returns [fallback] when there
         * is no signal — single-currency sends are then unchanged.
         */
        fun inferRecipientCurrency(
            resolved: SendResolvedRecipient?,
            fallback: SendCurrency,
        ): SendCurrency {
            if (resolved == null) return fallback
            val hint = (resolved.displayName ?: resolved.display ?: "").lowercase()
            if (hint.isEmpty()) return fallback
            for ((token, code) in corridorTokens) {
                if (hint.endsWith(".$token") ||
                    hint.endsWith("@$token") ||
                    hint.contains(".$token.") ||
                    hint.contains(".$token@")
                ) {
                    return SendCurrencies.find(code)
                }
            }
            return fallback
        }

        /** Handle/locale token → ISO currency code. */
        private val corridorTokens: List<Pair<String, String>> = listOf(
            "ng" to "NGN", "ngn" to "NGN",
            "ke" to "KES", "kes" to "KES",
            "gh" to "GHS", "ghs" to "GHS",
            "za" to "ZAR", "zar" to "ZAR",
            "jp" to "JPY", "jpy" to "JPY",
            "sg" to "SGD", "sgd" to "SGD",
            "ph" to "PHP", "php" to "PHP",
            "id" to "IDR", "idr" to "IDR",
            "vn" to "VND", "vnd" to "VND",
            "us" to "USD", "usd" to "USD",
        )
    }
}

// ── SendDraft cross-currency state ──────────────────────────────────────────

/** Resolve the recipient's display currency for this draft. */
fun SendDraft.resolvedRecipientCurrency(): SendCurrency {
    recipientCurrencyCode?.let { code ->
        SendCurrencies.allSupported.firstOrNull { it.code == code }?.let { return it }
    }
    return ClientCrossBorderQuote.inferRecipientCurrency(resolved, currency)
}

/** True when the recipient is paid out in a different currency. */
val SendDraft.isCrossCurrency: Boolean
    get() = resolvedRecipientCurrency().code != currency.code

/** Build a locked quote for the current `amountUsdsui`. Nil-equivalent for same-currency. */
fun SendDraft.makeCrossBorderQuote(): ClientCrossBorderQuote? {
    if (amountUsdsui <= 0) return null
    val recipient = resolvedRecipientCurrency()
    if (recipient.code == currency.code) return null
    return ClientCrossBorderQuote(
        senderCurrency = currency,
        recipientCurrency = recipient,
        amountUsdsui = amountUsdsui,
        senderFxRate = SendFx.rate(currency.code),
        recipientFxRate = SendFx.rate(recipient.code),
    )
}

/**
 * Recipient-side amount for the live Amount screen (before the quote is
 * locked). Mirrors the post-spread receive figure. Null for same-currency.
 */
fun SendDraft.liveRecipientReceiveLocal(): Pair<Double, SendCurrency>? {
    val typed = rawAmount.toDoubleOrNull() ?: return null
    if (typed <= 0) return null
    val recipient = resolvedRecipientCurrency()
    if (recipient.code == currency.code) return null
    val senderRate = SendFx.rate(currency.code)
    val recipientRate = SendFx.rate(recipient.code)
    if (senderRate <= 0) return null
    val usd = typed / senderRate
    val spread = usd * (ClientCrossBorderQuote.DEFAULT_SPREAD_BPS.toDouble() / 10_000.0)
    val net = max(0.0, usd - spread)
    return Pair(net * recipientRate, recipient)
}
