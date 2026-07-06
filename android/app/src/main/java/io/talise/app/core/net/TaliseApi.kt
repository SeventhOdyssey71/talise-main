package io.talise.app.core.net

import io.talise.app.core.model.ActivityResponse
import io.talise.app.core.model.BalancesDTO
import io.talise.app.core.model.EpochResponse
import io.talise.app.core.model.ExchangeRequest
import io.talise.app.core.model.ExchangeResponse
import io.talise.app.core.model.GaslessSubmitRequest
import io.talise.app.core.model.GaslessSubmitResponse
import io.talise.app.core.model.NonceRequest
import io.talise.app.core.model.NonceResponse
import io.talise.app.core.model.RecipientResolution
import io.talise.app.core.model.SponsorPrepareRequest
import io.talise.app.core.model.SponsorPrepareResponse
import io.talise.app.core.model.TeamsResponse
import io.talise.app.core.model.UserDTO
import io.talise.app.core.model.YieldComparison
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Query

/**
 * The backend surface the first screens need — same endpoints as iOS/web.
 * Add the rest (send/sponsor-prepare, zk/sponsor-execute, earn prepare, payouts batch,
 * rewards, ramps) as their flows are built; the shapes are documented in PLAN.md §4.
 */
interface TaliseApi {
    @GET("api/me")
    suspend fun me(): UserDTO

    @GET("api/balances")
    suspend fun balances(@Query("fresh") fresh: Int = 1): BalancesDTO

    @GET("api/activity")
    suspend fun activity(@Query("limit") limit: Int = 20): ActivityResponse

    @GET("api/recipient/resolve")
    suspend fun resolveRecipient(@Query("q") query: String): RecipientResolution

    // Gasless USDsui send: prepare returns signable bytes; submit broadcasts.
    @POST("api/send/sponsor-prepare")
    suspend fun sponsorPrepare(@Body body: SponsorPrepareRequest): SponsorPrepareResponse

    @POST("api/send/gasless-submit")
    suspend fun gaslessSubmit(@Body body: GaslessSubmitRequest): GaslessSubmitResponse

    @GET("api/yield/comparison")
    suspend fun yieldComparison(): YieldComparison

    @GET("api/payouts/teams")
    suspend fun teams(): TeamsResponse

    @GET("api/sui/epoch")
    suspend fun epoch(): EpochResponse

    @POST("api/auth/mobile/nonce")
    suspend fun nonce(@Body body: NonceRequest): NonceResponse

    @POST("api/auth/mobile/exchange")
    suspend fun exchange(@Body body: ExchangeRequest): ExchangeResponse
}
