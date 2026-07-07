package io.talise.app.feature.stream

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

/**
 * Streamed USDsui payments — feature-scoped Retrofit service mirroring the
 * endpoints iOS `StreamView.swift` uses:
 *
 *   POST /api/streams/create-prepare  → { mode, bytes?, escrowAddress?, error? }
 *   GET  /api/streams/escrow          → { escrowAddress } (fallback)
 *   POST /api/streams/record          → { ok, id, state }
 *   GET  /api/streams                 → { streams: [...] }
 *   POST /api/streams/{id}/cancel     → { ok?, state?, mode?, bytes?, refunded?, refundUsd? }
 *   POST /api/streams/{id}/claim      → { ok?, mode?, bytes?, nothingToClaim? }
 *   POST /api/zk/sponsor-execute      → { digest } (sponsor-ready bytes signed locally)
 */

// ── DTOs (mirror the iOS private structs 1:1) ───────────────────────────────

@Serializable
data class StreamPrepareBody(
    val to: String,
    val totalUsd: Double,
    val intervalMs: Long,
    val numTranches: Int,
)

/**
 * /api/streams/create-prepare response. `mode` selects the funding rail:
 *   • "onchain" → sign the sponsor-ready `stream::create` `bytes` (Onara pays
 *     gas); the digest is the create tx the server parses for the Stream id.
 *   • "gasless" / "sponsored" → fund the `escrowAddress` over the normal send
 *     rail. All fields optional so every shape parses.
 */
@Serializable
data class StreamPrepareDTO(
    val mode: String? = null,
    val bytes: String? = null,
    val escrowAddress: String? = null,
    val error: String? = null,
)

@Serializable
data class StreamEscrowDTO(val escrowAddress: String)

@Serializable
data class StreamRecordBody(
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
data class StreamRecordDTO(
    val ok: Boolean? = null,
    val id: String? = null,
    val state: String? = null,
)

@Serializable
data class StreamDTO(
    val id: String,
    val state: String,
    val role: String? = null,
    val recipientHandle: String? = null,
    val recipientAddress: String? = null,
    val totalUsd: Double? = null,
    val releasedUsd: Double? = null,
    val remainingUsd: Double? = null,
    val tranchesDone: Int? = null,
    val numTranches: Int? = null,
    val nextTrancheAt: Double? = null,
    val startMs: Double? = null,
    val intervalMs: Double? = null,
)

@Serializable
data class StreamsDTO(val streams: List<StreamDTO> = emptyList())

/**
 * /api/streams/[id]/cancel response. On the on-chain rail it returns
 * `mode:"onchain"` + sponsor-ready `bytes` (the sender-signed
 * `cancel_and_withdraw`) for the client to sign+execute. The escrow rail
 * refunds server-side and just reports `refunded`.
 */
@Serializable
data class StreamCancelDTO(
    val ok: Boolean? = null,
    val state: String? = null,
    val mode: String? = null,
    val bytes: String? = null,
    val refunded: Boolean? = null,
    val refundUsd: Double? = null,
)

/**
 * /api/streams/[id]/claim response. On-chain rail returns sponsor-ready
 * `claim_accrued` `bytes` for the caller to sign+execute; `nothingToClaim`
 * when the schedule has nothing newly due.
 */
@Serializable
data class StreamClaimDTO(
    val ok: Boolean? = null,
    val mode: String? = null,
    val bytes: String? = null,
    val nothingToClaim: Boolean? = null,
)

@Serializable
class StreamEmptyBody

// ── zk execute (sponsor-ready bytes → digest) ───────────────────────────────

@Serializable
data class StreamZkExecuteBody(
    val bytesB64: String,
    val ephemeralPubKeyB64: String,
    val maxEpoch: Int,
    val randomness: String,
    val userSignature: String,
)

@Serializable
data class StreamZkExecuteDTO(
    val digest: String? = null,
    val error: String? = null,
    val code: String? = null,
)

interface StreamApi {
    @POST("api/streams/create-prepare")
    suspend fun createPrepare(@Body body: StreamPrepareBody): StreamPrepareDTO

    @GET("api/streams/escrow")
    suspend fun escrow(): StreamEscrowDTO

    @POST("api/streams/record")
    suspend fun record(@Body body: StreamRecordBody): StreamRecordDTO

    @GET("api/streams")
    suspend fun list(): StreamsDTO

    @POST("api/streams/{id}/cancel")
    suspend fun cancel(@Path("id") id: String, @Body body: StreamEmptyBody = StreamEmptyBody()): StreamCancelDTO

    @POST("api/streams/{id}/claim")
    suspend fun claim(@Path("id") id: String, @Body body: StreamEmptyBody = StreamEmptyBody()): StreamClaimDTO

    @POST("api/zk/sponsor-execute")
    suspend fun sponsorExecute(@Body body: StreamZkExecuteBody): StreamZkExecuteDTO
}

/** Lazily created feature-scoped service over the shared Retrofit stack. */
internal object StreamBackend {
    val api: StreamApi by lazy { ApiClient.create(StreamApi::class.java) }
}

/**
 * HTTP status + server `{ "error": "…" }` message from a Retrofit
 * [HttpException] — feeds [friendlyStreamError] the same inputs iOS's
 * `APIError.status(code, msg)` carries.
 */
internal fun streamHttpError(t: Throwable): Pair<Int, String?>? {
    val http = t as? HttpException ?: return null
    val msg = try {
        http.response()?.errorBody()?.string()?.let { body ->
            ApiClient.json.parseToJsonElement(body)
                .jsonObject["error"]?.jsonPrimitive?.contentOrNull
        }
    } catch (_: Exception) {
        null
    }
    return http.code() to msg
}

/**
 * Map "backend isn't live yet" responses (404 / 503 / "not configured" /
 * "disabled") to reassuring copy. Real, actionable server messages still pass
 * through verbatim. Mirrors iOS `StreamSetupView.friendlyStreamError`.
 */
internal fun friendlyStreamError(code: Int, message: String?): String {
    val lower = (message ?: "").lowercase()
    val rolloutPhrase = lower.contains("not configured") || lower.contains("disabled") ||
        lower.contains("not found") || lower.contains("unavailable")
    if (code == 404 || code == 503 || rolloutPhrase) {
        return "Streaming is rolling out, check back soon."
    }
    if (!message.isNullOrEmpty()) return message
    return "Couldn't start the stream right now."
}

// ── USD formatting (matches iOS TaliseFormat.usd / usd2) ────────────────────

internal fun streamUsd2(v: Double): String = "$" + "%,.2f".format(v)

internal fun streamUsd(v: Double): String =
    if (v < 1.0) "$" + "%,.4f".format(v) else streamUsd2(v)
