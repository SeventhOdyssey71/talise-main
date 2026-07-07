package io.talise.app.feature.requests

import io.talise.app.core.net.ApiClient
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import retrofit2.HttpException
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path

/**
 * Payment requests, "ask anyone for $X". The Android counterpart of iOS
 * `RequestsAPI` (Network/RequestsAPI.swift). The funds aren't escrowed,
 * settlement is a direct USDsui payment to the requester, verified on-chain.
 *
 *   POST   /api/requests       create { amountUsd, currency?, note? } -> { ok, request, payUrl }
 *   GET    /api/requests       list mine, newest first
 *   DELETE /api/requests/{id}  cancel an open request
 */
interface RequestsService {
    @GET("api/requests")
    suspend fun list(): RequestsListResponse

    @POST("api/requests")
    suspend fun create(@Body body: CreateRequestBody): RequestCreateResponse

    @DELETE("api/requests/{id}")
    suspend fun cancel(@Path("id") id: String): CancelRequestResponse
}

object RequestsApi {
    val service: RequestsService by lazy { ApiClient.create(RequestsService::class.java) }
}

// MARK: - DTOs

/** Mirrors iOS `RequestDTO` / `WorkRequest` from web/lib/requests.ts. */
@Serializable
data class RequestDTO(
    val id: String,
    val amountUsd: Double,
    val currency: String = "USD",
    val requesterNote: String? = null,
    val status: String = "open",
    val expiresAt: Double? = null,
    val createdAt: Double? = null,
    val paidAt: Double? = null,
    val payDigest: String? = null,
) {
    val isOpen: Boolean get() = status == "open"
    val isPaid: Boolean get() = status == "paid"

    /**
     * The public pay link for this request (talise.io/req/<id>). The create
     * response carries an authoritative `payUrl`; this is a stable fallback
     * for rows loaded from the list.
     */
    val payUrl: String get() = "https://www.talise.io/req/$id"
}

@Serializable
data class RequestCreateResponse(
    val ok: Boolean = true,
    val request: RequestDTO,
    val payUrl: String,
)

@Serializable
data class CreateRequestBody(
    val amountUsd: Double,
    val currency: String? = null,
    val note: String? = null,
)

@Serializable
data class RequestsListResponse(val requests: List<RequestDTO> = emptyList())

@Serializable
data class CancelRequestResponse(val ok: Boolean? = null, val status: String? = null)

// MARK: - Error copy

/**
 * Honest fallback for the generic catch in money flows, the Android port of
 * iOS `APIError.honestMoneyError`: translate the real underlying error into a
 * short, true reason instead of a blanket "couldn't do it right now" line.
 */
internal fun honestMoneyError(t: Throwable, fallback: String): String {
    val raw = serverErrorMessage(t) ?: t.message.orEmpty()
    val lower = raw.lowercase()

    // Gas sponsor budget exhausted, or upstream gas station down.
    if (lower.contains("gas") || lower.contains("sponsor")
        || lower.contains("no_healthy_upstream") || lower.contains("budget")
    ) {
        return "Payments are briefly paused, please try again in a moment."
    }
    // Wallet balance, only when it's NOT a gas message (handled above).
    if (lower.contains("balance") || lower.contains("insufficient")) {
        return "You don't have enough USDsui for this."
    }
    // Otherwise: a trimmed, true message, never markup or a stack blob.
    val safe = raw.trim()
    if (safe.isNotEmpty() && !safe.startsWith("<") && safe.length <= 120) return safe
    return fallback
}

/** Extract the `error`/`message` field from a Talise-shaped `{"error":"..."}` body. */
private fun serverErrorMessage(t: Throwable): String? {
    val http = t as? HttpException ?: return null
    val body = runCatching { http.response()?.errorBody()?.string() }
        .getOrNull()?.trim().orEmpty()
    if (!body.startsWith("{")) return null
    return runCatching {
        val obj = ApiClient.json.parseToJsonElement(body).jsonObject
        obj["error"]?.jsonPrimitive?.contentOrNull
            ?: obj["message"]?.jsonPrimitive?.contentOrNull
    }.getOrNull()?.takeIf { it.isNotEmpty() }
}
