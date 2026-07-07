package io.talise.app.feature.withdraw

import io.talise.app.core.model.GaslessSubmitRequest
import io.talise.app.core.model.GaslessSubmitResponse
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path

/**
 * Feature-scoped Retrofit surface for the withdraw (cash-out) flow, mirroring
 * the endpoints iOS `WithdrawFlowView` + `BridgeRampAPI` + `BridgeKYCAPI` hit:
 *
 *   Linq (Nigeria / NGN):
 *     GET  /api/offramp/linq/rate               public display rate
 *     POST /api/offramp/linq/resolve            name enquiry (bank + account)
 *     POST /api/offramp/linq/quote              locked quote
 *     POST /api/offramp/linq/create             order + deposit wallet
 *     GET  /api/offramp/linq/status/{orderId}   poll until completed/failed
 *
 *   Send rail (fund the Linq deposit wallet, fee-free to the user):
 *     POST /api/send/sponsor-prepare            with sponsorFallback = true
 *     POST /api/send/gasless-submit             mode == "gasless"
 *     POST /api/zk/sponsor-execute              mode == "sponsored"
 *
 *   Bridge (US / Europe):
 *     GET  /api/kyc/bridge/status
 *     POST /api/offramp/bridge/cashout-address
 *     POST /api/offramp/bridge/swap-to-usdc-prepare
 *     POST /api/offramp/bridge/send-usdc-prepare
 *
 * Server-gated: cash-out via Linq is behind FEATURE_CASHOUT (403/503/404 when
 * off); Bridge 503s when unconfigured. Both map to reassuring copy via
 * [friendlyOfframpError], exactly like iOS.
 */
interface WithdrawApi {
    // ── Linq ──
    @GET("api/offramp/linq/rate")
    suspend fun linqRate(): LinqRateResp

    @POST("api/offramp/linq/resolve")
    suspend fun linqResolve(@Body body: LinqResolveRequest): LinqResolveResp

    @POST("api/offramp/linq/quote")
    suspend fun linqQuote(@Body body: LinqQuoteRequest): LinqQuoteResp

    @POST("api/offramp/linq/create")
    suspend fun linqCreate(@Body body: LinqCreateRequest): LinqCreateResp

    @GET("api/offramp/linq/status/{orderId}")
    suspend fun linqStatus(@Path("orderId") orderId: String): LinqStatusResp

    // ── Send rail ──
    @POST("api/send/sponsor-prepare")
    suspend fun sponsorPrepare(@Body body: WithdrawPrepareRequest): WithdrawPrepareResp

    @POST("api/send/gasless-submit")
    suspend fun gaslessSubmit(@Body body: GaslessSubmitRequest): GaslessSubmitResponse

    @POST("api/zk/sponsor-execute")
    suspend fun sponsorExecute(@Body body: SponsorExecuteRequest): SponsorExecuteResp

    // ── Bridge ──
    @GET("api/kyc/bridge/status")
    suspend fun bridgeKycStatus(): BridgeKycStatusResp

    @POST("api/offramp/bridge/cashout-address")
    suspend fun cashOutAddress(@Body body: CashOutRequest): CashOutResp

    @POST("api/offramp/bridge/swap-to-usdc-prepare")
    suspend fun swapToUsdcPrepare(@Body body: SwapToUsdcRequest): SwapToUsdcResp

    @POST("api/offramp/bridge/send-usdc-prepare")
    suspend fun sendUsdcPrepare(@Body body: SendUsdcRequest): SendUsdcResp
}
