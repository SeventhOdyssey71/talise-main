package io.talise.app.feature.ramps

import io.talise.app.core.auth.ZkLoginCoordinator
import io.talise.app.core.net.ApiClient
import io.talise.app.core.store.SecureStore
import kotlinx.serialization.Serializable
import retrofit2.HttpException
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST

/**
 * Feature-scoped Retrofit surface for the ramps, the Android counterpart of iOS
 * `BridgeRampAPI` + `BridgeKYCAPI`.
 *
 *   - On-ramp  -> POST /api/onramp/v2/session   (fiat -> USDsui on Sui)
 *   - Off-ramp -> POST /api/offramp/bridge/cashout-address (USDsui -> fiat)
 *   - KYC      -> POST /api/kyc/bridge/start · GET /api/kyc/bridge/status
 *
 * The destination Sui address (on-ramp) and the source funds (off-ramp) are
 * the signed-in user's, locked server-side, the client never passes them.
 * Both are env-gated server-side: when Bridge isn't configured the on-ramp
 * session 404s (flag off) and the off-ramp 503s, which the flow views render
 * as a clean "not available yet" state.
 */
interface RampsApi {
    @POST("api/onramp/v2/session")
    suspend fun onrampSession(@Body body: OnrampSessionRequest): OnrampSessionResponse

    @POST("api/offramp/bridge/cashout-address")
    suspend fun cashOutAddress(@Body body: CashOutRequest): CashOutResponse

    @POST("api/offramp/bridge/swap-to-usdc-prepare")
    suspend fun swapToUsdc(@Body body: SwapToUsdcRequest): SwapToUsdcResponse

    @POST("api/offramp/bridge/send-usdc-prepare")
    suspend fun sendUsdc(@Body body: SendUsdcRequest): SendUsdcResponse

    @POST("api/kyc/bridge/start")
    suspend fun kycStart(@Body body: RampsEmptyBody): BridgeKYCStartResponse

    @GET("api/kyc/bridge/status")
    suspend fun kycStatus(): BridgeKYCStatusResponse

    // Generic execute for pre-built sponsored PTBs (swap / withdraw), mirrors
    // iOS ZkLoginCoordinator.signAndExecuteRaw's POST /api/zk/sponsor-execute.
    @POST("api/zk/sponsor-execute")
    suspend fun sponsorExecute(@Body body: RampsSponsorExecuteRequest): RampsSponsorExecuteResponse
}

/** Lazily-created ramps service + the sign-and-execute helper shared by the flows. */
object RampsClient {
    val api: RampsApi by lazy { ApiClient.create(RampsApi::class.java) }

    /**
     * Sign sponsor-ready bytes locally with the ephemeral zkLogin key, then
     * execute via `/api/zk/sponsor-execute`, the Android port of iOS
     * `ZkLoginCoordinator.signAndExecuteRaw(bytesB64:meta:)`. Returns the
     * on-chain digest. The server assembles the zkLogin proof from its stored
     * JWT + salt (no client proof cache).
     */
    suspend fun signAndExecuteRaw(bytesB64: String, meta: RampsTxMeta): String {
        val userSignature = ZkLoginCoordinator.signTransaction(bytesB64)
        val randomness = SecureStore.jwtRandomness ?: error("session needs a refresh, sign in again")
        val res = api.sponsorExecute(
            RampsSponsorExecuteRequest(
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
     * Flatten a thrown Retrofit/OkHttp error into "code + body" text so the
     * flows can match the same sentinels iOS reads from
     * `(error as NSError).localizedDescription` (e.g. "404", "NO_ROUTE").
     */
    fun errorText(t: Throwable): String {
        if (t is HttpException) {
            val body = runCatching { t.response()?.errorBody()?.string() }.getOrNull() ?: ""
            return "${t.code()} $body"
        }
        return t.message ?: ""
    }
}

// MARK: - On-ramp

@Serializable
data class OnrampSessionRequest(
    val amountCents: Int,
    val provider: String = "bridge",
    val sourceCurrency: String,
)

/** Mirrors the server `SessionResult` (+ optional `kycUrl`). For Bridge,
 *  `depositInstructions` carries the bank coordinates to fund; `kycUrl` is the
 *  hosted identity flow when verification isn't complete. */
@Serializable
data class OnrampSessionResponse(
    val kycUrl: String? = null,
    val widgetUrl: String? = null,
    val depositInstructions: BridgeDepositInstructions? = null,
)

@Serializable
data class BridgeDepositInstructions(
    val currency: String,
    val paymentRails: List<String>? = null,
    val bankName: String? = null,
    val bankAddress: String? = null,
    val accountNumber: String? = null,
    val routingNumber: String? = null,
    val accountType: String? = null,
    val beneficiaryName: String? = null,
    val beneficiaryAddress: String? = null,
    val iban: String? = null,
    val bic: String? = null,
    val depositMessage: String? = null,
)

// MARK: - Off-ramp

/** Cash-out bank details. US wire uses `accountNumber` + `routingNumber`;
 *  SEPA/EUR uses `iban` + `bic` + name parts + `country` (ISO alpha-3). */
@Serializable
data class CashOutRequest(
    val rail: String,          // "wire" | "sepa"
    val currency: String,      // "usd" | "eur"
    val accountOwnerName: String,
    val accountNumber: String? = null,
    val routingNumber: String? = null,
    val checkingOrSavings: String? = null,
    val firstName: String? = null,
    val lastName: String? = null,
    val iban: String? = null,
    val bic: String? = null,
    val country: String? = null,
    // Account-holder address, Bridge requires it for US ACH payout accounts.
    val street: String? = null,
    val city: String? = null,
    val state: String? = null,
    val postalCode: String? = null,
)

@Serializable
data class CashOutResponse(
    /** The persistent Sui address to send USDsui to in order to cash out. */
    val address: String,
    val currency: String,
    val destinationPaymentRail: String,
    val note: String? = null,
    // Payout bank summary (when an existing route is reused), shown so the
    // user can confirm which account the wire lands in.
    val bankName: String? = null,
    val accountLast4: String? = null,
    val accountOwnerName: String? = null,
    val accountType: String? = null,
    /** USDC pocket balance, raw u64 micros string (6 decimals). */
    val usdcMicros: String? = null,
)

@Serializable
data class SwapToUsdcRequest(val amountUsdsui: Double)

@Serializable
data class SwapToUsdcResponse(
    val bytes: String,
    val mode: String,
    val amountUsdsui: Double,
    val estimatedUsdcMicros: String,
)

@Serializable
data class SendUsdcRequest(val amountUsdc: Double, val currency: String)

@Serializable
data class SendUsdcResponse(
    val bytes: String,
    val mode: String,
    val amountUsdc: Double,
    val destinationPaymentRail: String,
)

// MARK: - Bridge KYC

@Serializable
class RampsEmptyBody

/** Result of `POST /api/kyc/bridge/start`. `kycUrl` + `tosUrl` are the hosted
 *  flows to open in the browser; `status` is the Talise-collapsed KYC status. */
@Serializable
data class BridgeKYCStartResponse(
    val provider: String? = null,
    val status: String,
    val kycUrl: String? = null,
    val tosUrl: String? = null,
    val kycLinkId: String? = null,
    val customerId: String? = null,
)

/** Result of `GET /api/kyc/bridge/status`. */
@Serializable
data class BridgeKYCStatusResponse(
    val started: Boolean,
    val status: String,
    val kycStatus: String? = null,
    val tosStatus: String? = null,
    val customerId: String? = null,
    val stale: Boolean? = null,
)

/** Talise's collapsed KYC status ladder (mirrors the server `OnrampKycStatus`). */
enum class KYCStatus(val raw: String) {
    Unverified("unverified"),
    Pending("pending"),
    Approved("approved"),
    Rejected("rejected"),
    Expired("expired");

    val label: String
        get() = when (this) {
            Unverified -> "Not verified"
            Pending -> "In review"
            Approved -> "Verified"
            Rejected -> "Not approved"
            Expired -> "Expired"
        }

    /** True while Bridge is still working through identity / ToS, the view
     *  should keep polling. */
    val isInFlight: Boolean get() = this == Pending

    companion object {
        fun from(raw: String?): KYCStatus =
            entries.firstOrNull { it.raw == (raw ?: "unverified") } ?: Unverified
    }
}

// MARK: - Sponsor execute

@Serializable
data class RampsTxMeta(
    val kind: String,
    val amountUsd: Double? = null,
)

@Serializable
data class RampsSponsorExecuteRequest(
    val bytesB64: String,
    val ephemeralPubKeyB64: String,
    val maxEpoch: Int,
    val randomness: String,
    val userSignature: String,
    val meta: RampsTxMeta,
)

@Serializable
data class RampsSponsorExecuteResponse(
    val digest: String? = null,
    val error: String? = null,
)
