package io.talise.app.feature.send

import io.talise.app.core.net.ApiClient
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import retrofit2.HttpException
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query
import kotlin.coroutines.cancellation.CancellationException

/**
 * Feature-scoped backend surface for the Send flow. Mirrors the endpoint
 * shapes iOS uses in `Network/CrossBorderAPI.swift`, `SendToBankView.swift`
 * and `APIModels.swift` (contacts + bank-enriched recipient resolution).
 * Auth headers ride on [ApiClient]'s shared OkHttp stack.
 */
interface SendApi {
    @GET("api/contacts")
    suspend fun contacts(): SendContactsResponse

    /** Full server resolve — carries the masked PRIMARY payout bank. */
    @GET("api/recipient/resolve")
    suspend fun resolve(@Query("q") query: String): SendResolvedRecipient

    /** Display FX rates (soft-fail; display only, never in the money path). */
    @GET("api/fx")
    suspend fun fx(): SendFxResponse

    // Off-ramp Phase 3: pay a resolved recipient's PRIMARY Nigerian bank.
    @GET("api/offramp/linq/rate")
    suspend fun linqRate(): LinqRateResponse

    @POST("api/offramp/linq/to-user")
    suspend fun linqToUser(@Body body: LinqToUserRequest): LinqToUserResponse

    @GET("api/offramp/linq/status/{orderId}")
    suspend fun linqStatus(@Path("orderId") orderId: String): LinqToUserStatusResponse

    // Cross-border transfer rail (server-authoritative quote + confirm).
    @POST("api/transfers/cross-border/quote")
    suspend fun crossBorderQuote(@Body body: CrossBorderQuoteRequest): CrossBorderQuoteDTO

    @POST("api/transfers/cross-border/confirm")
    suspend fun crossBorderConfirm(@Body body: CrossBorderConfirmRequest): CrossBorderConfirmDTO

    @GET("api/corridors")
    suspend fun corridors(): CorridorRegistryDTO
}

/** Lazily-built Retrofit service on the shared authenticated stack. */
object SendApiClient {
    val api: SendApi by lazy { ApiClient.create(SendApi::class.java) }
}

// ── Recipient resolution (bank-enriched) ────────────────────────────────────

/**
 * Server-resolved recipient. Same shape as the core `RecipientResolution`
 * plus the off-ramp `recipientBank` block iOS decodes — kept feature-local
 * so the shared model stays untouched.
 */
@Serializable
data class SendResolvedRecipient(
    val address: String,
    val displayName: String? = null,
    val display: String? = null,
    val source: String? = null,
    val recipientBank: SendRecipientBank? = null,
)

/**
 * Summary of the recipient's PRIMARY linked bank account. Only the bank
 * name + last4 surface — never the full account number.
 */
@Serializable
data class SendRecipientBank(
    val hasPrimary: Boolean = false,
    val bankName: String? = null,
    val last4: String? = null,
) {
    /** "GTBank ••••1234" / "their bank" fallback when the label is sparse. */
    val label: String
        get() {
            val name = (bankName ?: "").trim()
            val tail = (last4 ?: "").trim()
            return when {
                name.isNotEmpty() && tail.isNotEmpty() -> "$name ••••$tail"
                name.isNotEmpty() -> name
                tail.isNotEmpty() -> "••••$tail"
                else -> "their bank"
            }
        }
}

// ── Contacts ────────────────────────────────────────────────────────────────

@Serializable
data class SendContactDTO(
    val address: String,
    val name: String? = null,
    val lastSeenMs: Double = 0.0,
    val sentCount: Int = 0,
    val receivedCount: Int = 0,
) {
    val display: String get() = name ?: shortAddress(address)
}

@Serializable
data class SendContactsResponse(val contacts: List<SendContactDTO> = emptyList())

// ── FX (display only) ───────────────────────────────────────────────────────

@Serializable
data class SendFxResponse(val rates: Map<String, Double> = emptyMap())

// ── Off-ramp Phase 3 DTOs (send-to-a-user's-bank) ───────────────────────────

@Serializable
data class LinqRateResponse(val rate: Double = 0.0)

@Serializable
data class LinqToUserRequest(val recipient: String, val amountNgn: Double)

/**
 * `POST /api/offramp/linq/to-user` response. The server resolves the
 * recipient's PRIMARY bank from their @handle and returns the EXACT
 * `amountUsdsui` we must send to `walletAddress` to credit `amountNgn`.
 */
@Serializable
data class LinqToUserResponse(
    val orderId: String,
    val walletAddress: String,
    val coinType: String = "",
    val amountUsdsui: Double,
    val amountNgn: Double,
    val rate: Double = 0.0,
    val recipientName: String = "",
    val recipientBankLabel: String = "",
)

/** `GET /api/offramp/linq/status/{orderId}` — current state of the order. */
@Serializable
data class LinqToUserStatusResponse(
    val orderId: String,
    val status: String = "",
    val phase: String = "",           // initiated | processing | completed | failed
    val amountUsdsui: Double = 0.0,
    val amountNgn: Double = 0.0,
)

// ── Cross-border transfer rail DTOs ─────────────────────────────────────────

@Serializable
data class CrossBorderQuoteRequest(
    val fromCountry: String,
    val toCountry: String,
    val amount: Double,
)

@Serializable
data class CrossBorderConfirmRequest(val transferId: String)

/**
 * 200 body of POST /api/transfers/cross-border/quote.
 * `{ transferId, corridor, quote, amountUsd, tier, recipientGets }`
 */
@Serializable
data class CrossBorderQuoteDTO(
    val transferId: String,
    val corridor: CorridorDTO,
    val quote: LockedQuoteDTO,
    val amountUsd: Double = 0.0,
    val tier: Int = 0,
    val recipientGets: RecipientGetsDTO,
)

/** Corridor metadata as returned inside a quote. */
@Serializable
data class CorridorDTO(
    val id: String = "",
    val fromCcy: String = "",
    val toCcy: String = "",
    val status: String = "",          // "live" | "partner" | "planned"
    val spreadBps: Int = 0,
    val perTxCapUsd: Double? = null,
) {
    val isBookable: Boolean get() = status == "live" || status == "partner"
    val isLive: Boolean get() = status == "live"
}

/** The server-locked quote block. `expiresAt` is epoch-ms. */
@Serializable
data class LockedQuoteDTO(
    val rate: Double = 0.0,
    val spreadBps: Int = 0,
    val toAmount: Double = 0.0,
    val expiresAt: Double = 0.0,
)

/** What the recipient receives, in their payout currency. */
@Serializable
data class RecipientGetsDTO(
    val amount: Double = 0.0,
    val currency: String = "USD",
)

/** 200 body of POST /api/transfers/cross-border/confirm. */
@Serializable
data class CrossBorderConfirmDTO(
    val state: String = "",
    val transferId: String = "",
) {
    /**
     * True once the confirm has COMMITTED the transfer: funds debited and
     * the on-chain settlement leg in flight or done. The live NG corridor
     * returns `onchain_settling` from confirm, so anything from there on
     * is a successful submission.
     */
    val isCommitted: Boolean
        get() = when (state) {
            "onchain_settling", "onchain_settled", "fiat_out_pending", "settled" -> true
            else -> false
        }

    /** True when the on-chain leg is final, regardless of the local payout. */
    val isChainFinal: Boolean
        get() = when (state) {
            "onchain_settled", "fiat_out_pending", "settled" -> true
            else -> false
        }

    /** True only once the recipient's local payout has fully settled. */
    val isPayoutSettled: Boolean get() = state == "settled"
}

/** GET /api/corridors response — the full registry. */
@Serializable
data class CorridorRegistryDTO(val corridors: List<CorridorRegistryEntryDTO> = emptyList())

/** One row of the corridor registry, with country endpoints. */
@Serializable
data class CorridorRegistryEntryDTO(
    val id: String = "",
    val fromCountry: String = "",
    val fromCcy: String = "",
    val toCountry: String = "",
    val toCcy: String = "",
    val status: String = "",
    val spreadBps: Int = 0,
    val perTxCapUsd: Double? = null,
) {
    val isBookable: Boolean get() = status == "live" || status == "partner"
    val isLive: Boolean get() = status == "live"
}

// ── Typed errors ────────────────────────────────────────────────────────────

/**
 * The contract's 4xx error codes, plus transport/unknown fallbacks —
 * mirrors iOS `CrossBorderError` so the UI branches on each gate cleanly.
 */
sealed class CrossBorderError {
    data object UnknownCorridor : CrossBorderError()
    data object NotBookable : CrossBorderError()
    data object OverCap : CrossBorderError()
    data object TierBlocked : CrossBorderError()
    data object LimitExceeded : CrossBorderError()
    data object Fx : CrossBorderError()
    data object BadInput : CrossBorderError()
    data class Other(val message: String) : CrossBorderError()
    data object Cancelled : CrossBorderError()

    val description: String
        get() = when (this) {
            UnknownCorridor -> "We don't have a route to that country yet."
            NotBookable -> "This corridor isn't open yet, we're onboarding the local payout partner."
            OverCap -> "That's over the single-transfer cap for this corridor. Try a smaller amount."
            TierBlocked -> "Cross-border sends need a verified account. Finish identity verification to unlock."
            LimitExceeded -> "This would put you over your transfer limit. Upgrade your tier or send less."
            Fx -> "Couldn't lock an exchange rate right now. Try again in a moment."
            BadInput -> "Something about that transfer didn't check out. Double-check the amount and try again."
            is Other -> message
            Cancelled -> "Request was cancelled."
        }

    /** True when re-trying the SAME inputs could plausibly succeed. */
    val isTransient: Boolean
        get() = when (this) {
            Fx, Cancelled -> true
            is Other -> true
            else -> false
        }

    companion object {
        /**
         * Map an arbitrary thrown error into a typed cross-border error.
         * Pulls the `code` out of the server's `{ error, code }` 4xx body.
         */
        fun from(t: Throwable): CrossBorderError {
            if (t is CancellationException) return Cancelled
            if (t is HttpException) {
                val raw = try {
                    t.response()?.errorBody()?.string()
                } catch (_: Exception) {
                    null
                }
                if (!raw.isNullOrBlank()) {
                    try {
                        val obj = ApiClient.json.parseToJsonElement(raw).jsonObject
                        val code = obj["code"]?.jsonPrimitive?.contentOrNull
                        mapCode(code)?.let { return it }
                        val msg = obj["error"]?.jsonPrimitive?.contentOrNull
                        if (!msg.isNullOrEmpty()) return Other(msg)
                    } catch (_: Exception) {
                        // fall through to the generic mapping
                    }
                }
                return Other("HTTP ${t.code()}")
            }
            return Other(t.message ?: "Something went wrong.")
        }

        private fun mapCode(code: String?): CrossBorderError? = when (code) {
            "UNKNOWN_CORRIDOR" -> UnknownCorridor
            "NOT_BOOKABLE" -> NotBookable
            "OVER_CAP" -> OverCap
            "TIER_BLOCKED" -> TierBlocked
            "LIMIT_EXCEEDED" -> LimitExceeded
            "FX" -> Fx
            "BAD_INPUT" -> BadInput
            else -> null
        }
    }
}
