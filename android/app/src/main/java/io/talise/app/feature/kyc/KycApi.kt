package io.talise.app.feature.kyc

import io.talise.app.core.net.ApiClient
import kotlinx.serialization.Serializable
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST

/**
 * Onboarding + Bridge identity-verification endpoints for this feature.
 *
 * Onboarding (iOS `KYCView.submit()` / `claimTaliseHandle()`):
 *   • POST /api/onboarding      — persist country + account type.
 *   • POST /api/username/claim  — sponsored SuiNS subname mint (409 = taken).
 *
 * Bridge KYC (iOS `BridgeKYCAPI`):
 *   • POST /api/kyc/bridge/start  — creates/returns the hosted Bridge KYC +
 *     Terms-of-Service links and the current status.
 *   • GET  /api/kyc/bridge/status — polls Bridge for the freshest status (we
 *     don't rely on webhooks reaching the device).
 *
 * One Bridge customer serves BOTH on-ramp and off-ramp, so verifying here is
 * what unlocks USD/EUR cash-out. Env-gated server-side: 503 when Bridge isn't
 * configured (callers render a clean "not available yet" state).
 */
interface KycService {
    @POST("api/onboarding")
    suspend fun onboarding(@Body body: OnboardRequest): OnboardResponse

    @POST("api/username/claim")
    suspend fun claimUsername(@Body body: UsernameClaimRequest): UsernameClaimResponse

    @POST("api/kyc/bridge/start")
    suspend fun bridgeStart(@Body body: EmptyBody): BridgeKycStartResponse

    @GET("api/kyc/bridge/status")
    suspend fun bridgeStatus(): BridgeKycStatusResponse
}

/** Call-surface mirror of the iOS `BridgeKYCAPI` enum. */
object BridgeKycApi {
    private val service: KycService by lazy { ApiClient.create(KycService::class.java) }

    suspend fun start(): BridgeKycStartResponse = service.bridgeStart(EmptyBody())

    suspend fun status(): BridgeKycStatusResponse = service.bridgeStatus()
}

@Serializable
class EmptyBody

@Serializable
data class OnboardRequest(
    val country: String,
    val accountType: String,
)

@Serializable
data class OnboardResponse(
    val ok: Boolean? = null,
)

@Serializable
data class UsernameClaimRequest(
    val username: String,
)

@Serializable
data class UsernameClaimResponse(
    val ok: Boolean? = null,
    val username: String? = null,
    val digest: String? = null,
    val subnameNftId: String? = null,
    val error: String? = null,
)

/**
 * Result of `POST /api/kyc/bridge/start`. `kycUrl` + `tosUrl` are the hosted
 * flows to open in the browser; `status` is the Talise-collapsed KYC status.
 */
@Serializable
data class BridgeKycStartResponse(
    val provider: String? = null,
    val status: String,
    val kycUrl: String? = null,
    val tosUrl: String? = null,
    val kycLinkId: String? = null,
    val customerId: String? = null,
)

/** Result of `GET /api/kyc/bridge/status`. */
@Serializable
data class BridgeKycStatusResponse(
    val started: Boolean,
    val status: String,
    val kycStatus: String? = null,
    val tosStatus: String? = null,
    val customerId: String? = null,
    val stale: Boolean? = null,
)

/** Talise's collapsed KYC status ladder (mirrors the server `OnrampKycStatus`). */
enum class KycStatus(val raw: String) {
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

    /**
     * True while Bridge is still working through identity / ToS — callers
     * should keep polling.
     */
    val isInFlight: Boolean get() = this == Pending

    companion object {
        fun from(raw: String?): KycStatus =
            entries.firstOrNull { it.raw == raw } ?: Unverified
    }
}
