package io.talise.app.feature.contracts

import kotlinx.serialization.Serializable
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Url

/**
 * Contracts endpoints + DTOs — mirror the Decodables declared in iOS
 * `ContractsView.swift` (/api/contracts, /api/contracts/[id]) plus the
 * reused stream prepare/record/cancel shapes under api/streams.
 */

// MARK: - DTOs (match /api/contracts, /api/contracts/[id])

/**
 * A Work contract — milestone/recurring pay wrapping an underlying stream.
 * Mirrors `ProjectedContract` from GET /api/contracts.
 */
@Serializable
data class ContractDTO(
    val id: String,
    val payeeAddress: String,
    val payeeHandle: String? = null,
    val title: String,
    val rateUsd: Double,
    val cadence: String,          // hourly | daily | weekly | monthly
    val cadenceLabel: String? = null,
    val periods: Int,
    val totalUsd: Double,
    val streamId: String,
    val status: String,           // active | completed | cancelled
    val createdAt: Double,
    val paidUsd: Double? = null,
    val remainingUsd: Double? = null,
    val periodsPaid: Int? = null,
    val nextPayAt: Double? = null,
    val streamState: String? = null,
)

@Serializable
data class ContractsListResp(val contracts: List<ContractDTO> = emptyList())

@Serializable
data class ContractCreateResp(
    val ok: Boolean,
    val contract: ContractDTO? = null,
)

/**
 * POST /api/contracts/[id] {action:"cancel"}. On the escrow rail the server
 * refunds the remainder; on the on-chain rail it returns `onchainCancelPath`
 * pointing at the stream cancel endpoint the sender must sign.
 */
@Serializable
data class ContractCancelResp(
    val ok: Boolean? = null,
    val status: String? = null,
    val refunded: Boolean? = null,
    val refundUsd: Double? = null,
    val onchainCancelPath: String? = null,
)

// MARK: - Reused stream prepare/record/cancel DTOs

@Serializable
data class CtrStreamPrepareResp(
    val mode: String? = null,
    val bytes: String? = null,
    val escrowAddress: String? = null,
    val error: String? = null,
)

@Serializable
data class CtrStreamRecordResp(val id: String? = null)

@Serializable
data class CtrStreamEscrowResp(val escrowAddress: String)

@Serializable
data class CtrStreamCancelResp(
    val mode: String? = null,
    val bytes: String? = null,
    val refundUsd: Double? = null,
)

// MARK: - Request bodies

@Serializable
data class ContractActionBody(val action: String = "cancel")

@Serializable
data class CtrStreamPrepareBody(
    val to: String,
    val totalUsd: Double,
    val intervalMs: Long,
    val numTranches: Int,
)

@Serializable
data class CtrStreamRecordBody(
    val fundingDigest: String,
    val recipientAddress: String,
    val recipientHandle: String? = null,
    val totalMicros: String,
    val trancheMicros: String,
    val numTranches: Int,
    val startMs: Long,
    val intervalMs: Long,
)

@Serializable
data class ContractCreateBody(
    val streamId: String,
    val payeeAddress: String,
    val payeeHandle: String? = null,
    val title: String,
    val rateUsd: Double,
    val cadence: String,
    val periods: Int,
    val fundingDigest: String,
)

@Serializable
class ContractEmptyBody

interface ContractsApi {
    @GET("api/contracts")
    suspend fun list(): ContractsListResp

    @POST("api/contracts")
    suspend fun create(@Body body: ContractCreateBody): ContractCreateResp

    @POST("api/contracts/{id}")
    suspend fun action(@Path("id") id: String, @Body body: ContractActionBody): ContractCancelResp

    // ── Underlying stream rail ──
    @POST("api/streams/create-prepare")
    suspend fun streamCreatePrepare(@Body body: CtrStreamPrepareBody): CtrStreamPrepareResp

    @POST("api/streams/record")
    suspend fun streamRecord(@Body body: CtrStreamRecordBody): CtrStreamRecordResp

    @GET("api/streams/escrow")
    suspend fun streamEscrow(): CtrStreamEscrowResp

    /** The server-supplied `onchainCancelPath` (e.g. "/api/streams/{id}/cancel"). */
    @POST
    suspend fun streamCancelAt(@Url path: String, @Body body: ContractEmptyBody = ContractEmptyBody()): CtrStreamCancelResp
}
