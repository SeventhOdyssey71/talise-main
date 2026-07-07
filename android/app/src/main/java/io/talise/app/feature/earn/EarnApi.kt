package io.talise.app.feature.earn

import io.talise.app.core.net.ApiClient
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import retrofit2.HttpException
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST

/**
 * Earn (Invest tab) wire surface — feature-scoped Retrofit service mirroring the
 * endpoints iOS `EarnView` uses:
 *
 *   GET  /api/yield/comparison           → venues + best (rich shape: earned,
 *                                          earningPerDay, earningSinceMs — the
 *                                          core `TaliseApi.yieldComparison()` DTO
 *                                          only carries apy/supplied/earned)
 *   POST /api/earn/supply/prepare        → { transactionKindB64 }
 *   POST /api/earn/withdraw/prepare      → { transactionKindB64 }
 *   POST /api/earn/withdraw-earned/prepare → { transactionKindB64 }
 *   POST /api/zk/sponsor                 { transactionKindB64 } → { bytes }
 *   POST /api/zk/sponsor-execute         { bytesB64, ephemeralPubKeyB64, maxEpoch,
 *                                          randomness, userSignature, meta? } → { digest }
 *
 * The prepare → sponsor → sign → execute pipeline is the Android port of iOS
 * `ZkLoginCoordinator.signAndSubmit(transactionKindB64:)`.
 */

// ── Yield comparison (rich venue shape) ─────────────────────────────────────

@Serializable
data class EarnVenueDTO(
    val venue: String,
    val apy: Double = 0.0,
    val supplied: Double? = null,
    val pendingRewards: Double? = null,
    /** Cumulative yield earned-so-far (USD). Server: currentValue − principal. */
    val earned: Double? = null,
    /** Projected per-day yield (supplied × apy / 365), server-computed. */
    val earningPerDay: Double? = null,
    /** Reconstructed principal (= currentValue − earned). */
    val principalSupplied: Double? = null,
    /** Epoch-ms the current earning streak began; resets on full withdrawal. */
    val earningSinceMs: Double? = null,
) {
    /**
     * Display-cased venue name — venue codes stay lowercased over the wire
     * ("navi" / "deepbook"); users see generic earning terminology. Mirrors
     * iOS `displayVenueName(_:)`.
     */
    val displayName: String
        get() = when (venue.lowercase()) {
            "navi" -> "Earn"
            "deepbook" -> "Trading"
            else -> venue.lowercase().replaceFirstChar { it.uppercase() }
        }
}

@Serializable
data class EarnComparisonDTO(
    val venues: List<EarnVenueDTO> = emptyList(),
    val best: EarnVenueDTO? = null,
)

// ── Prepare bodies / responses ──────────────────────────────────────────────

@Serializable
data class SupplyPrepareBody(val venue: String, val amount: Double)

@Serializable
data class WithdrawPrepareBody(val venue: String, val amount: Double? = null)

@Serializable
data class WithdrawEarnedPrepareBody(val venue: String)

@Serializable
data class BuildKindDTO(
    val transactionKindB64: String? = null,
    val roundupUsd: Double? = null,
    val error: String? = null,
)

// ── zk sponsor / execute ────────────────────────────────────────────────────

@Serializable
data class ZkSponsorBody(val transactionKindB64: String)

@Serializable
data class ZkSponsorDTO(val bytes: String? = null, val error: String? = null)

@Serializable
data class ZkExecuteMeta(
    val kind: String,
    val amountUsd: Double,
    val venue: String? = null,
)

@Serializable
data class ZkExecuteBody(
    val bytesB64: String,
    val ephemeralPubKeyB64: String,
    val maxEpoch: Int,
    val randomness: String,
    val userSignature: String,
    val meta: ZkExecuteMeta? = null,
)

@Serializable
data class ZkExecuteDTO(
    val digest: String? = null,
    val error: String? = null,
    val code: String? = null,
)

interface EarnApi {
    @GET("api/yield/comparison")
    suspend fun comparison(): EarnComparisonDTO

    @POST("api/earn/supply/prepare")
    suspend fun supplyPrepare(@Body body: SupplyPrepareBody): BuildKindDTO

    @POST("api/earn/withdraw/prepare")
    suspend fun withdrawPrepare(@Body body: WithdrawPrepareBody): BuildKindDTO

    @POST("api/earn/withdraw-earned/prepare")
    suspend fun withdrawEarnedPrepare(@Body body: WithdrawEarnedPrepareBody): BuildKindDTO

    @POST("api/zk/sponsor")
    suspend fun sponsor(@Body body: ZkSponsorBody): ZkSponsorDTO

    @POST("api/zk/sponsor-execute")
    suspend fun sponsorExecute(@Body body: ZkExecuteBody): ZkExecuteDTO
}

/** Lazily created feature-scoped service over the shared Retrofit stack. */
internal object EarnBackend {
    val api: EarnApi by lazy { ApiClient.create(EarnApi::class.java) }
}

/**
 * Pull the server's `{ "error": "…" }` message out of a Retrofit [HttpException]
 * so users see the same actionable copy iOS surfaces via `localizedDescription`.
 */
internal fun serverErrorMessage(t: Throwable): String? {
    val http = t as? HttpException ?: return null
    return try {
        http.response()?.errorBody()?.string()?.let { body ->
            ApiClient.json.parseToJsonElement(body)
                .jsonObject["error"]?.jsonPrimitive?.contentOrNull
        }
    } catch (_: Exception) {
        null
    }
}

// ── USD formatting (Android shows USD; USDsui is 1:1 USD) ───────────────────

/** Fixed 2-decimal money figure — iOS `TaliseFormat.local2` / `usd2`. */
internal fun earnUsd2(v: Double): String = "$" + "%,.2f".format(v)

/** Flexible-precision money figure — iOS `TaliseFormat.local` / `usd` (4dp under $1). */
internal fun earnUsd(v: Double): String =
    if (v < 1.0) "$" + "%,.4f".format(v) else earnUsd2(v)
