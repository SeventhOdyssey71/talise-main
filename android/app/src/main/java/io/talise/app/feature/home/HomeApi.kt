package io.talise.app.feature.home

import io.talise.app.core.model.ActivityResponse
import io.talise.app.core.model.BalancesDTO
import io.talise.app.core.net.ApiClient
import kotlinx.serialization.Serializable
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Query
import kotlin.math.pow

/**
 * Home-scoped backend surface, mirrors the iOS calls HomeView + TokenBucketView
 * make beyond the shared [io.talise.app.core.net.TaliseApi]:
 *   - `/api/balances?fresh=1` + `/api/activity?limit&fresh=1` (cache-bypass reads)
 *   - `/api/wallet/balances` + `/api/wallet/sweep` (token bucket)
 *   - `/api/zk/sponsor` + `/api/zk/sponsor-execute` (iOS ZkLoginCoordinator.signAndSubmit)
 *   - `/api/stream/watch` (post-tx digest watch, fire-and-forget)
 */
internal interface HomeApi {
    @GET("api/balances")
    suspend fun balances(@Query("fresh") fresh: Int? = null): BalancesDTO

    @GET("api/activity")
    suspend fun activity(@Query("limit") limit: Int = 20, @Query("fresh") fresh: Int? = null): ActivityResponse

    @GET("api/wallet/balances")
    suspend fun walletBalances(): WalletBalancesResponse

    @POST("api/wallet/sweep")
    suspend fun walletSweep(@Body body: WalletSweepRequest): WalletSweepResponse

    @POST("api/zk/sponsor")
    suspend fun zkSponsor(@Body body: ZkSponsorRequest): ZkSponsorResponse

    @POST("api/zk/sponsor-execute")
    suspend fun zkSponsorExecute(@Body body: ZkSponsorExecuteRequest): ZkSponsorExecuteResponse

    @POST("api/stream/watch")
    suspend fun watchDigest(@Body body: WatchDigestRequest): WatchDigestResponse
}

/** Lazily-built singleton so the ViewModel and HistoryView share one Retrofit service. */
internal val homeApi: HomeApi by lazy { ApiClient.create(HomeApi::class.java) }

// ── Wallet (token bucket) DTOs — mirror iOS APIModels.swift ────────────────

/**
 * One row in `GET /api/wallet/balances`, one coin type held in the user's
 * PLAIN wallet (not the vault). `amount` is the raw u64 as a string for
 * BigInt safety.
 */
@Serializable
internal data class WalletCoinBalance(
    val coinType: String,
    val amount: String,
    val isUsdsui: Boolean = false,
    val symbol: String? = null,
    val decimals: Int? = null,
    val logoUrl: String? = null,
    val usdValue: Double? = null,
) {
    /** Raw amount as a Double for ergonomic dust-filtering. */
    val amountDouble: Double get() = amount.toDoubleOrNull() ?: 0.0

    /** Human-readable balance using the on-chain decimals (default 9). */
    val humanAmount: Double get() = amountDouble / 10.0.pow((decimals ?: 9).toDouble())
}

@Serializable
internal data class WalletBalancesResponse(
    val address: String = "",
    val balances: List<WalletCoinBalance> = emptyList(),
)

@Serializable
internal data class WalletSweepCoin(
    val coinType: String,
    val amount: String,
)

@Serializable
internal data class WalletSweepRequest(val coins: List<WalletSweepCoin>)

/**
 * `bytesB64` is the transaction KIND for the zk sponsor pipeline. `estUsdsuiOut`
 * is the quoted USDsui output (raw u64, 6-dp) net of fees, used for rewards.
 */
@Serializable
internal data class WalletSweepResponse(
    val bytesB64: String,
    val sender: String? = null,
    val estUsdsuiOut: String? = null,
) {
    val estUsdOut: Double
        get() = (estUsdsuiOut?.toDoubleOrNull() ?: 0.0) / 1_000_000.0
}

// ── zk sponsor pipeline DTOs — mirror iOS ZkLoginCoordinator.signAndSubmit ──

@Serializable
internal data class ZkSponsorRequest(val transactionKindB64: String)

@Serializable
internal data class ZkSponsorResponse(
    val bytes: String? = null,
    val error: String? = null,
)

@Serializable
internal data class ZkTxMeta(
    val kind: String,
    val amountUsd: Double? = null,
)

@Serializable
internal data class ZkSponsorExecuteRequest(
    val bytesB64: String,
    val ephemeralPubKeyB64: String,
    val maxEpoch: Int,
    val randomness: String,
    val userSignature: String,
    val meta: ZkTxMeta? = null,
)

@Serializable
internal data class ZkSponsorExecuteResponse(
    val digest: String? = null,
    val error: String? = null,
)

// ── Post-tx digest watch ────────────────────────────────────────────────────

@Serializable
internal data class WatchDigestRequest(val digest: String)

@Serializable
internal data class WatchDigestResponse(val ok: Boolean? = null)
