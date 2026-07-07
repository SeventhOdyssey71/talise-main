package io.talise.app.feature.withdraw

import io.talise.app.core.net.ApiClient
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.text.NumberFormat
import java.util.Locale

/**
 * Withdraw (cash-out) wire DTOs + corridor catalogue, ported 1:1 from iOS
 * `WithdrawFlowView.swift` (Linq DTOs), `BridgeRampAPI.swift` and
 * `RampCorridor.swift`. Feature-scoped: nothing here leaks into core/.
 */

// ── Navigation ──────────────────────────────────────────────────────────────

/** Route string the orchestrator must register in TaliseRoot as Routes.WITHDRAW. */
object WithdrawRoutes {
    const val WITHDRAW = "withdraw"
}

// ── Linq off-ramp DTOs (Nigeria / NGN) ──────────────────────────────────────

/** `POST /api/offramp/linq/quote` response. */
@Serializable
data class LinqQuoteResp(
    val accountName: String = "",
    val bankName: String = "",
    val bankCode: String = "",
    val accountNumber: String = "",
    val rate: Double = 0.0,
    val amountUsdsui: Double = 0.0,
    val amountNgn: Double = 0.0,
)

/** `POST /api/offramp/linq/create` response. */
@Serializable
data class LinqCreateResp(
    val orderId: String,
    val linqOrderId: String = "",
    val walletAddress: String,
    val coinType: String = "",
    val amountUsdsui: Double = 0.0,
    val amountNgn: Double = 0.0,
    val rate: Double = 0.0,
    val depositWindowMinutes: Int = 0,
)

/** `GET /api/offramp/linq/status/{orderId}` response. */
@Serializable
data class LinqStatusResp(
    val orderId: String = "",
    val status: String = "",
    val phase: String = "", // initiated | processing | completed | failed
    val amountUsdsui: Double = 0.0,
    val amountNgn: Double = 0.0,
)

/** `POST /api/offramp/linq/resolve` response (name enquiry). */
@Serializable
data class LinqResolveResp(
    val accountName: String = "",
    val bankName: String = "",
    val bankCode: String = "",
    val accountNumber: String = "",
)

/** `GET /api/offramp/linq/rate` response (public display rate). */
@Serializable
data class LinqRateResp(val rate: Double = 0.0)

@Serializable
data class LinqResolveRequest(val bankCode: String, val accountNumber: String)

/**
 * Quote body. The backend accepts either amountNgn (NGN display currency) or
 * amountUsdsui (USD/other display currencies); the unused one stays null and
 * is omitted from the JSON (explicitNulls = false on the shared Json).
 */
@Serializable
data class LinqQuoteRequest(
    val amountNgn: Double? = null,
    val amountUsdsui: Double? = null,
    val bankCode: String,
    val accountNumber: String,
)

@Serializable
data class LinqCreateRequest(
    val amountNgn: Double? = null,
    val amountUsdsui: Double? = null,
    val bankCode: String,
    val accountNumber: String,
    val accountName: String,
    val bankName: String? = null,
)

// ── Send rail (sponsor-prepare with fallback + sponsor-execute) ─────────────

/** Like core `SponsorPrepareRequest` but with the `sponsorFallback` flag iOS sends for cash-out. */
@Serializable
data class WithdrawPrepareRequest(
    val to: String,
    val amount: Double,
    val asset: String = "USDsui",
    val sponsorFallback: Boolean = true,
)

@Serializable
data class WithdrawPrepareResp(
    val bytes: String? = null,
    val mode: String? = null,
    val error: String? = null,
)

@Serializable
data class WithdrawMeta(
    val kind: String,
    val amountUsd: Double? = null,
)

/** `POST /api/zk/sponsor-execute` body (no cachedProof; the server proves from its stored JWT+salt). */
@Serializable
data class SponsorExecuteRequest(
    val bytesB64: String,
    val ephemeralPubKeyB64: String,
    val maxEpoch: Int,
    val randomness: String,
    val userSignature: String,
    val meta: WithdrawMeta? = null,
)

@Serializable
data class SponsorExecuteResp(
    val digest: String? = null,
    val error: String? = null,
)

// ── Bridge off-ramp DTOs (US / Europe) ──────────────────────────────────────

/** `GET /api/kyc/bridge/status` response. */
@Serializable
data class BridgeKycStatusResp(
    val started: Boolean = false,
    val status: String = "unverified",
    val kycStatus: String? = null,
    val tosStatus: String? = null,
    val customerId: String? = null,
    val stale: Boolean? = null,
)

/**
 * Cash-out bank details. US wire uses accountNumber + routingNumber (+ address);
 * SEPA/EUR uses iban + bic + name parts + country (ISO alpha-3).
 */
@Serializable
data class CashOutRequest(
    val rail: String,          // "wire" | "sepa"
    val currency: String,      // "usd" | "eur"
    val accountOwnerName: String,
    val accountNumber: String? = null,
    val routingNumber: String? = null,
    val checkingOrSavings: String? = null,
    val firstName: String? = null,
    val lastName: String? = null,
    val iban: String? = null,
    val bic: String? = null,
    val country: String? = null,
    val street: String? = null,
    val city: String? = null,
    val state: String? = null,
    val postalCode: String? = null,
)

@Serializable
data class CashOutResp(
    val address: String = "",
    val currency: String = "",
    val destinationPaymentRail: String = "",
    val note: String? = null,
    val bankName: String? = null,
    val accountLast4: String? = null,
    val accountOwnerName: String? = null,
    val accountType: String? = null,
    /** USDC pocket balance, raw u64 micros string (6 decimals). */
    val usdcMicros: String? = null,
)

@Serializable
data class SwapToUsdcRequest(val amountUsdsui: Double)

@Serializable
data class SwapToUsdcResp(
    val bytes: String,
    val mode: String = "",
    val amountUsdsui: Double = 0.0,
    val estimatedUsdcMicros: String = "",
)

@Serializable
data class SendUsdcRequest(val amountUsdc: Double, val currency: String)

@Serializable
data class SendUsdcResp(
    val bytes: String,
    val mode: String = "",
    val amountUsdc: Double = 0.0,
    val destinationPaymentRail: String = "",
)

// ── Corridors (iOS RampCorridor.swift) ──────────────────────────────────────

enum class RampDirection { Onramp, Offramp }

enum class CorridorAvailability { Bridge, Local, Soon }

/**
 * A fiat corridor for the ramps. `code` is ISO 3166-1 alpha-2 ("EU" for the
 * Eurozone); `currencyCode` is ISO 4217.
 */
data class RampCorridor(
    val code: String,
    val name: String,
    val currencyCode: String,
    val availability: CorridorAvailability,
    val onramp: Boolean,
    val offramp: Boolean,
) {
    val isAvailable: Boolean get() = availability != CorridorAvailability.Soon

    /** Short rail label for the row subtitle. */
    val railLabel: String
        get() = when (availability) {
            CorridorAvailability.Bridge -> "Bank transfer · USDC on Sui"
            CorridorAvailability.Local -> "Local bank"
            CorridorAvailability.Soon -> "Coming soon"
        }
}

/**
 * Feature gating for the ramps, mirroring iOS `RampFlags`. Bridge corridors
 * (US cash-out / add-money) stay hidden while KYC + the US flow are paused.
 */
object RampFlags {
    const val bridgeLive = false
}

/** The corridor catalogue, ported verbatim from iOS `RampCorridors.all`. */
object RampCorridors {
    val all: List<RampCorridor> = listOf(
        // Live via Bridge (USD/GBP)
        RampCorridor("US", "United States", "USD", CorridorAvailability.Bridge, onramp = true, offramp = true),
        RampCorridor("GB", "United Kingdom", "GBP", CorridorAvailability.Bridge, onramp = true, offramp = false),
        // Live via a local rail (Linq)
        RampCorridor("NG", "Nigeria", "NGN", CorridorAvailability.Local, onramp = false, offramp = true),
        // On the map, not yet bookable
        RampCorridor("KE", "Kenya", "KES", CorridorAvailability.Soon, onramp = false, offramp = false),
        RampCorridor("GH", "Ghana", "GHS", CorridorAvailability.Soon, onramp = false, offramp = false),
        RampCorridor("ZA", "South Africa", "ZAR", CorridorAvailability.Soon, onramp = false, offramp = false),
        RampCorridor("PH", "Philippines", "PHP", CorridorAvailability.Soon, onramp = false, offramp = false),
        RampCorridor("IN", "India", "INR", CorridorAvailability.Soon, onramp = false, offramp = false),
        RampCorridor("ID", "Indonesia", "IDR", CorridorAvailability.Soon, onramp = false, offramp = false),
        RampCorridor("VN", "Vietnam", "VND", CorridorAvailability.Soon, onramp = false, offramp = false),
        RampCorridor("EG", "Egypt", "EGP", CorridorAvailability.Soon, onramp = false, offramp = false),
    )

    /**
     * Corridors that support a given direction: bookable ones first, "soon"
     * last, both alphabetical. An unset country defaults to NG (Nigeria-first).
     */
    fun forDirection(direction: RampDirection, userCountry: String?): Pair<List<RampCorridor>, List<RampCorridor>> {
        val raw = (userCountry ?: "").trim()
        val cc = (raw.ifEmpty { "NG" }).uppercase()
        fun supports(c: RampCorridor) = if (direction == RampDirection.Onramp) c.onramp else c.offramp
        fun live(c: RampCorridor): Boolean = when (c.availability) {
            CorridorAvailability.Local -> cc == c.code
            CorridorAvailability.Bridge -> {
                if (!RampFlags.bridgeLive) false
                else if (direction == RampDirection.Offramp) true
                else c.code == cc
            }
            CorridorAvailability.Soon -> false
        }
        fun bookable(c: RampCorridor) = live(c) && supports(c)
        val available = all.filter(::bookable).sortedBy { it.name }
        val soon = all.filter { !bookable(it) }.sortedBy { it.name }
        return available to soon
    }
}

// ── Banks (iOS BankWithdrawView.banks) ──────────────────────────────────────

/** One bank option for the picker; `bankCode` is the plain NIBSS code Linq accepts. */
data class OfframpBank(val name: String, val bankCode: String) {
    val id: String get() = bankCode
}

/** Common Nigerian banks, name + plain NIBSS code (Linq codes), verbatim from iOS. */
val offrampBanks: List<OfframpBank> = listOf(
    OfframpBank("Access Bank", "044"),
    OfframpBank("Guaranty Trust Bank", "058"),
    OfframpBank("First Bank of Nigeria", "011"),
    OfframpBank("Zenith Bank", "057"),
    OfframpBank("United Bank For Africa", "033"),
    OfframpBank("Wema Bank", "035"),
    OfframpBank("Sterling Bank", "232"),
    OfframpBank("Fidelity Bank", "070"),
    OfframpBank("First City Monument Bank", "214"),
    OfframpBank("Stanbic IBTC Bank", "039"),
    OfframpBank("Kuda", "090267"),
    OfframpBank("OPay", "100004"),
    OfframpBank("PalmPay", "100033"),
    OfframpBank("Moniepoint", "090405"),
)

// ── Formatting helpers (iOS TaliseFormat.usd2 / BankWithdrawView.ngnGrouped) ─

/** "$1,234.50", fixed 2 decimals, en_US grouping. */
fun usd2(v: Double): String {
    val fmt = NumberFormat.getNumberInstance(Locale.US)
    fmt.minimumFractionDigits = 2
    fmt.maximumFractionDigits = 2
    return "$" + fmt.format(v)
}

/** Grouped NGN figure (no currency symbol; the caller prefixes the naira sign). */
fun ngnGrouped(v: Double): String {
    val fmt = NumberFormat.getNumberInstance(Locale.US)
    fmt.minimumFractionDigits = 0
    fmt.maximumFractionDigits = if (v < 100) 2 else 0
    return fmt.format(v)
}

/** "****1234" masking, iOS `maskAccount`. */
fun maskAccount(a: String): String = if (a.length <= 4) "****" else "****" + a.takeLast(4)

/** Map rollout / config errors to reassuring copy; pass real ones through. iOS `friendlyOfframpError`. */
fun friendlyOfframpError(code: Int, message: String?): String {
    val lower = (message ?: "").lowercase()
    if (code == 503 || lower.contains("not configured") || lower.contains("fx_unavailable")) {
        return "Bank withdrawals are rolling out, check back soon."
    }
    if (code == 422 && lower.contains("verify")) {
        return "We couldn't verify that bank account. Check the number and bank."
    }
    if (lower.contains("\"error\"") && message != null) {
        // Body is JSON like {"error":"..."}; pull the message out.
        runCatching {
            val obj = ApiClient.json.parseToJsonElement(message).jsonObject
            val e = obj["error"]?.jsonPrimitive?.contentOrNull
            if (!e.isNullOrEmpty()) return e
        }
    }
    if (code == 404) return "Bank withdrawals aren't available yet."
    // Only surface a server message if it's short and not an HTML error page.
    if (!message.isNullOrEmpty() && message.length <= 120 &&
        !lower.contains("<html") && !lower.contains("<!doctype")
    ) {
        return message
    }
    return "Something went wrong. Please try again."
}
