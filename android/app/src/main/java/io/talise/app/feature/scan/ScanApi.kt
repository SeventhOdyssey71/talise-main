package io.talise.app.feature.scan

import io.talise.app.core.net.ApiClient
import kotlinx.serialization.Serializable
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path

/**
 * Linq off-ramp DTOs + endpoints for the scan bank-payout path, shapes copied
 * verbatim from iOS `ScanBankPayout.swift` (ScanResolveResp / ScanRateResp /
 * ScanQuoteResp / ScanCreateResp / ScanStatusResp). Feature-scoped Retrofit
 * service via [ApiClient.create], same pattern the other feature packages use.
 */

// MARK: - Requests

/** `POST /api/offramp/linq/resolve` body, amount-independent name enquiry. */
@Serializable
data class ScanResolveRequest(
    val bankCode: String,
    val accountNumber: String,
)

/** `POST /api/offramp/linq/quote` body. */
@Serializable
data class ScanQuoteRequest(
    val amountNgn: Double,
    val bankCode: String,
    val accountNumber: String,
)

/** `POST /api/offramp/linq/create` body. */
@Serializable
data class ScanCreateRequest(
    val amountNgn: Double,
    val bankCode: String,
    val accountNumber: String,
    val accountName: String,
    val bankName: String? = null,
)

// MARK: - Responses

@Serializable
data class ScanResolveResponse(
    val accountName: String,
    val bankName: String = "",
    val bankCode: String = "",
    val accountNumber: String = "",
)

/** `GET /api/offramp/linq/rate`, public display rate (1 USDsui = rate NGN). */
@Serializable
data class ScanRateResponse(val rate: Double)

/** `POST /api/offramp/linq/quote`, locked figures for the entered NGN. */
@Serializable
data class ScanQuoteResponse(
    val accountName: String,
    val bankName: String = "",
    val bankCode: String = "",
    val accountNumber: String = "",
    val rate: Double,
    val amountUsdsui: Double,
    val amountNgn: Double,
)

/** `POST /api/offramp/linq/create`, returns the deposit wallet + EXACT debit. */
@Serializable
data class ScanCreateResponse(
    val orderId: String,
    val walletAddress: String,
    val amountUsdsui: Double,
    val amountNgn: Double,
    val rate: Double = 0.0,
)

/** `GET /api/offramp/linq/status/{orderId}`. */
@Serializable
data class ScanStatusResponse(
    val orderId: String,
    val status: String = "",
    val phase: String = "",
    val amountUsdsui: Double = 0.0,
    val amountNgn: Double = 0.0,
)

// MARK: - Service

interface ScanOfframpApi {
    @POST("api/offramp/linq/resolve")
    suspend fun resolve(@Body body: ScanResolveRequest): ScanResolveResponse

    @GET("api/offramp/linq/rate")
    suspend fun rate(): ScanRateResponse

    @POST("api/offramp/linq/quote")
    suspend fun quote(@Body body: ScanQuoteRequest): ScanQuoteResponse

    @POST("api/offramp/linq/create")
    suspend fun create(@Body body: ScanCreateRequest): ScanCreateResponse

    @GET("api/offramp/linq/status/{orderId}")
    suspend fun status(@Path("orderId") orderId: String): ScanStatusResponse
}

/** Shared instance for the scan feature. */
object ScanApi {
    val offramp: ScanOfframpApi by lazy { ApiClient.create(ScanOfframpApi::class.java) }
}
