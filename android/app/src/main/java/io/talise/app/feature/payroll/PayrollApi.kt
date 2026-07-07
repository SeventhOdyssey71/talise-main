package io.talise.app.feature.payroll

import io.talise.app.core.auth.ZkLoginCoordinator
import io.talise.app.core.model.GaslessSubmitRequest
import io.talise.app.core.model.SendMeta
import io.talise.app.core.model.SponsorPrepareRequest
import io.talise.app.core.model.TeamMemberDTO
import io.talise.app.core.net.ApiClient
import io.talise.app.core.store.SecureStore
import kotlinx.serialization.Serializable
import retrofit2.HttpException
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path

/**
 * Feature-scoped Retrofit surface for Payroll / Teams, the Android counterpart
 * of iOS `PayrollAPI` + `TeamStreamAPI`.
 *
 *   - GET    /api/payouts/teams                  -> list saved teams
 *   - POST   /api/payouts/teams                  -> prepare a team save
 *   - POST   /api/payouts/teams/record           -> finalize an on-chain save
 *   - DELETE /api/payouts/teams/{id}             -> prepare a team delete
 *   - POST   /api/payouts/teams/{id}/record      -> finalize an on-chain delete
 *   - POST   /api/payouts/batch/prepare          -> build a batch payout PTB
 *   - POST   /api/payouts/batch/{batchId}/record -> record the executed digest
 *   - POST   /api/payouts/streams/create-prepare -> team stream draft + escrow
 *   - POST   /api/payouts/streams/record         -> activate with funding digest
 *
 * A "team" is a reusable, on-chain roster (a `payroll::Team` shared object)
 * the user pays together. Save/delete are sponsor-ready Move calls: the server
 * returns `mode: "onchain"` + bytes to sign, then the digest is recorded. When
 * the on-chain path is disabled server-side the same calls return `mode: "db"`
 * and there's nothing to sign (the legacy DB-only flow). Paying a team still
 * goes through the screened `batch/prepare` path, the roster carries no money.
 */
interface PayrollApiService {
    @POST("api/payouts/teams")
    suspend fun prepareSaveTeam(@Body body: SaveTeamBody): SaveTeamPrepareResponse

    @POST("api/payouts/teams/record")
    suspend fun recordSaveTeam(@Body body: RecordSaveBody): SaveTeamResponse

    @DELETE("api/payouts/teams/{id}")
    suspend fun prepareDeleteTeam(@Path("id") id: String): DeleteTeamResponse

    @POST("api/payouts/teams/{id}/record")
    suspend fun recordDeleteTeam(@Path("id") id: String, @Body body: DigestBody): OkResponse

    @POST("api/payouts/batch/prepare")
    suspend fun prepareBatch(@Body body: BatchPrepareBody): BatchPrepareResponse

    @POST("api/payouts/batch/{batchId}/record")
    suspend fun recordBatch(@Path("batchId") batchId: String, @Body body: DigestBody): OkResponse

    // Team streaming payouts, fund a pot once, then equal shares stream to every
    // team member on an interval, gaslessly, until the pot is exhausted.
    @POST("api/payouts/streams/create-prepare")
    suspend fun streamCreatePrepare(@Body body: StreamCreateBody): TeamStreamPrepareResponse

    @POST("api/payouts/streams/record")
    suspend fun streamRecord(@Body body: StreamRecordBody): StreamResponse

    // Generic execute for pre-built sponsored PTBs (batch payout / team
    // save-delete), mirrors iOS ZkLoginCoordinator.signAndExecuteRaw.
    @POST("api/zk/sponsor-execute")
    suspend fun sponsorExecute(@Body body: PayrollSponsorExecuteRequest): PayrollSponsorExecuteResponse
}

/** Lazily-created payroll service + the signing helpers shared by the flows. */
object PayrollApi {
    val service: PayrollApiService by lazy { ApiClient.create(PayrollApiService::class.java) }

    /**
     * Sign sponsor-ready bytes locally with the ephemeral zkLogin key, then
     * execute via `/api/zk/sponsor-execute`, the Android port of iOS
     * `ZkLoginCoordinator.signAndExecuteRaw(bytesB64:meta:)` (and its
     * `executeSponsorReady` wrapper). Returns the on-chain digest.
     */
    suspend fun signAndExecuteRaw(bytesB64: String, meta: PayrollTxMeta): String {
        val userSignature = ZkLoginCoordinator.signTransaction(bytesB64)
        val randomness = SecureStore.jwtRandomness ?: error("session needs a refresh, sign in again")
        val res = service.sponsorExecute(
            PayrollSponsorExecuteRequest(
                bytesB64 = bytesB64,
                ephemeralPubKeyB64 = ZkLoginCoordinator.ephemeralPubKeyB64(),
                maxEpoch = SecureStore.maxEpoch,
                randomness = randomness,
                userSignature = userSignature,
                meta = meta,
            ),
        )
        res.error?.let { throw IllegalStateException(it) }
        return res.digest ?: throw IllegalStateException("no digest in response")
    }

    /**
     * The gasless send rail (used to fund a team-stream escrow), the Android
     * port of iOS `signAndSubmitSend`: POST /api/send/sponsor-prepare, sign the
     * bytes locally, then submit on whichever rail the server chose
     * (`mode == "gasless"` -> /api/send/gasless-submit, otherwise
     * /api/zk/sponsor-execute). Same pipeline as feature/send/SendViewModel.
     */
    suspend fun signAndSubmitSend(to: String, amountUsd: Double): String {
        val prep = ApiClient.api.sponsorPrepare(SponsorPrepareRequest(to = to, amount = amountUsd))
        val bytes = prep.bytes ?: error(prep.error ?: "could not prepare the send")
        val userSignature = ZkLoginCoordinator.signTransaction(bytes)
        val randomness = SecureStore.jwtRandomness ?: error("session needs a refresh, sign in again")
        return if (prep.mode == "gasless") {
            val res = ApiClient.api.gaslessSubmit(
                GaslessSubmitRequest(
                    bytesB64 = bytes,
                    ephemeralPubKeyB64 = ZkLoginCoordinator.ephemeralPubKeyB64(),
                    maxEpoch = SecureStore.maxEpoch,
                    randomness = randomness,
                    userSignature = userSignature,
                    meta = SendMeta(kind = "send", amountUsd = amountUsd),
                ),
            )
            res.digest ?: error(res.error ?: "the send did not go through")
        } else {
            val res = service.sponsorExecute(
                PayrollSponsorExecuteRequest(
                    bytesB64 = bytes,
                    ephemeralPubKeyB64 = ZkLoginCoordinator.ephemeralPubKeyB64(),
                    maxEpoch = SecureStore.maxEpoch,
                    randomness = randomness,
                    userSignature = userSignature,
                    meta = PayrollTxMeta(kind = "send", amountUsd = amountUsd),
                ),
            )
            res.error?.let { error(it) }
            res.digest ?: error("no digest in response")
        }
    }

    /**
     * Flatten a thrown Retrofit/OkHttp error into "code + body" text so the
     * flows can match the same sentinels iOS reads (LIMIT_EXCEEDED, 429, ...).
     */
    fun errorText(t: Throwable): String {
        if (t is HttpException) {
            val body = runCatching { t.response()?.errorBody()?.string() }.getOrNull() ?: ""
            return "${t.code()} $body"
        }
        return t.message ?: ""
    }

    /**
     * Map server / signing failures to friendly copy, ported from iOS
     * `PayTeamView.friendlyPayoutError`. Inspects the error's text for the
     * known sentinels; otherwise surfaces the server's real, human reason
     * (e.g. "Couldn't resolve recipient #1 (ruru@talise).") when it looks like
     * one, else the fallback.
     */
    fun friendlyPayoutError(t: Throwable, fallback: String): String {
        val raw = errorText(t)
        val lower = raw.lowercase()
        if (raw.contains("LIMIT_EXCEEDED")) return "This exceeds your send limit."
        if (raw.contains("SCREENING_BLOCK")) return "Blocked by a compliance check."
        if (raw.contains("RESOLVE_FAILED")) {
            return "Couldn't find one of the recipients, check the handles."
        }
        if (lower.contains("rate_limited") || lower.contains("429")) {
            return "Too many attempts, try again shortly."
        }
        // Surface the server's real, human reason when the body carries one.
        val serverMessage = extractServerError(raw)
        if (!serverMessage.isNullOrBlank() && serverMessage.length <= 160) return serverMessage
        val direct = (t.message ?: "").trim()
        if (direct.isNotEmpty() && direct.length <= 160 && t !is HttpException) return direct
        return fallback
    }

    /** Pull `"error": "..."` out of an error-body blob without a full decode. */
    private fun extractServerError(raw: String): String? {
        val match = Regex("\"error\"\\s*:\\s*\"([^\"]+)\"").find(raw) ?: return null
        return match.groupValues[1]
    }
}

// MARK: - DTOs

@Serializable
data class BatchRecipient(
    val to: String,
    val amount: Double,
    val label: String? = null,
)

@Serializable
data class BatchPrepareBody(
    val recipients: List<BatchRecipient>,
    val asset: String = "USDsui",
    val teamName: String? = null,
    val teamId: String? = null,
)

@Serializable
data class BatchPrepareResponse(
    val batchId: String,
    val bytes: String,
    val recipientCount: Int,
    val totalUsd: Double,
)

@Serializable
data class SaveTeamBody(
    val name: String,
    val members: List<TeamMemberDTO>,
)

/** Response to a save PREPARE. `mode` is "onchain" (sign `bytes`, then record)
 *  or "db" / absent (the team is already saved -> `team`; nothing to sign). We
 *  only ever sign when mode is explicitly "onchain", so an older backend that
 *  returns just `{team}` decodes cleanly and is treated as the DB path.
 *  `edit`/`chainObjectId` distinguish create vs. edit for the record step. */
@Serializable
data class SaveTeamPrepareResponse(
    val mode: String? = null,
    val team: io.talise.app.core.model.TeamDTO? = null,
    val bytes: String? = null,
    val edit: Boolean? = null,
    val chainObjectId: String? = null,
    val name: String? = null,
)

@Serializable
data class RecordSaveBody(
    val digest: String,
    val name: String,
    val members: List<TeamMemberDTO>,
    val chainObjectId: String? = null,
)

@Serializable
data class SaveTeamResponse(val team: io.talise.app.core.model.TeamDTO)

/** Response to a delete PREPARE. "db" -> already removed; "onchain" -> sign
 *  `bytes` then record. */
@Serializable
data class DeleteTeamResponse(
    val mode: String? = null,
    val bytes: String? = null,
    val ok: Boolean? = null,
    val removed: Boolean? = null,
)

@Serializable
data class DigestBody(val digest: String)

@Serializable
data class OkResponse(val ok: Boolean? = null)

// MARK: - Team streams

@Serializable
data class StreamCreateBody(
    val teamId: String,
    val totalUsd: Double,
    val numTranches: Int,
    val intervalMinutes: Int,
)

@Serializable
data class StreamRecordBody(
    val streamId: String,
    val digest: String,
)

@Serializable
data class TeamStreamPrepareResponse(
    val streamId: String,
    val escrowAddress: String,
    val totalUsd: Double,
    val perMemberUsd: Double,
    val trancheUsd: Double,
    val numTranches: Int,
    val memberCount: Int,
    val intervalMs: Double,
)

@Serializable
data class TeamStreamMemberDTO(
    val address: String,
    val handle: String? = null,
)

@Serializable
data class TeamStreamDTO(
    val id: String,
    val teamId: String? = null,
    val teamName: String,
    val members: List<TeamStreamMemberDTO> = emptyList(),
    val memberCount: Int,
    val totalUsd: Double,
    val trancheUsd: Double,
    val perMemberUsd: Double,
    val numTranches: Int,
    val tranchesDone: Int,
    val releasedUsd: Double,
    val intervalMs: Double,
    val startMs: Double,
    val nextTrancheAt: Double,
    val state: String,
    val fundingDigest: String? = null,
    val createdAt: Double,
)

@Serializable
data class StreamResponse(val stream: TeamStreamDTO)

// MARK: - Sponsor execute

/** Sponsor-execute meta block. Both fields optional so an empty `{}` matches
 *  iOS `executeSponsorReady` for team save/delete (no rewards meta). */
@Serializable
data class PayrollTxMeta(
    val kind: String? = null,
    val amountUsd: Double? = null,
)

@Serializable
data class PayrollSponsorExecuteRequest(
    val bytesB64: String,
    val ephemeralPubKeyB64: String,
    val maxEpoch: Int,
    val randomness: String,
    val userSignature: String,
    val meta: PayrollTxMeta,
)

@Serializable
data class PayrollSponsorExecuteResponse(
    val digest: String? = null,
    val error: String? = null,
)
