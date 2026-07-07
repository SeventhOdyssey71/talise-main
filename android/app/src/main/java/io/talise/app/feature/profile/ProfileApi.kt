package io.talise.app.feature.profile

import io.talise.app.core.net.ApiClient
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import retrofit2.HttpException
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

/**
 * Profile-scoped backend surface — endpoint paths/shapes copied 1:1 from the iOS
 * network layer (`ProfileView` inline calls, `BankAccountsView` DTOs, `BridgeKYCAPI`,
 * `ClaimHandleSheet`, `RetargetHandleSheet`).
 */

/** LOCKED for now: Bridge identity verification (KYC) is paused — mirrors iOS `kycEnabled = false`. */
internal const val PROFILE_KYC_ENABLED = false

// MARK: - Rewards summary (stats strip)

@Serializable
internal data class ProfileRewardsTier(
    val id: String = "bronze",
    val label: String = "Bronze",
    val pointsToNext: Int? = null,
    val nextLabel: String? = null,
)

/** Subset of `GET /api/referral/summary` the Profile stats strip reads (tier + points). */
@Serializable
internal data class ProfileRewardsSummary(
    val code: String = "",
    val pointsTotal: Int = 0,
    val referralCount: Int = 0,
    val tier: ProfileRewardsTier? = null,
)

// MARK: - Generic shapes

@Serializable
internal class EmptyBody

@Serializable
internal data class ProfileOkResp(val ok: Boolean = false)

// MARK: - NFT avatar picker

@Serializable
internal data class NftItem(
    val objectId: String,
    val name: String = "",
    val imageUrl: String = "",
)

@Serializable
internal data class NftsResp(val nfts: List<NftItem> = emptyList())

@Serializable
internal data class AvatarBody(
    val imageUrl: String? = null,
    val clear: Boolean? = null,
)

@Serializable
internal data class AvatarResp(val ok: Boolean? = null, val pfpUrl: String? = null)

// MARK: - Bank accounts (off-ramp Phase 2)
//
//   GET    /api/me/bank                → [BankAccountDTO]
//   POST   /api/me/bank/link/prepare   → BankLinkPrepareResp
//   POST   /api/me/bank/link/confirm   → BankAccountDTO
//   DELETE /api/me/bank/[id]           → { ok }

/** One linked bank account as stored server-side. `attested` earns the "verified" check. */
@Serializable
internal data class BankAccountDTO(
    val id: String,
    val bankCode: String = "",
    val bankName: String = "",
    val accountName: String = "",
    val last4: String = "",
    val attested: Boolean = false,
)

/**
 * `/link/prepare` response. The server returns EITHER `bytes` — a sponsored attestation
 * tx to sign + submit — OR `attestMessage` — a string to sign as a personal message.
 */
@Serializable
internal data class BankLinkPrepareResp(
    val bytes: String? = null,
    val attestMessage: String? = null,
    val accountName: String = "",
    val bankName: String = "",
    val bankCode: String = "",
    val accountNumber: String = "",
    val last4: String = "",
)

@Serializable
internal data class BankLinkPrepareBody(val bankCode: String, val accountNumber: String)

@Serializable
internal data class BankLinkConfirmBody(
    val bankCode: String,
    val accountNumber: String,
    val accountName: String,
    val digest: String,
)

// MARK: - Handle claim

@Serializable
internal data class UsernameCheckResp(val available: Boolean = false, val reason: String? = null)

@Serializable
internal data class UsernameClaimBody(val username: String)

@Serializable
internal data class UsernameClaimResp(
    val ok: Boolean? = null,
    val username: String? = null,
    val digest: String? = null,
    val subnameNftId: String? = null,
    val error: String? = null,
)

// MARK: - Handle retarget

@Serializable
internal data class RetargetNameDTO(
    val nft: String,
    val name: String = "",
    val fromTarget: String? = null,
)

/**
 * `/api/handle/retarget` response — polymorphic on the server (probe diff OR sponsored
 * bytes build), collapsed into one optional-field DTO like iOS's `PassthroughJSON` read.
 */
@Serializable
internal data class RetargetResp(
    val alreadyAligned: Boolean? = null,
    val names: List<RetargetNameDTO>? = null,
    val bytes: String? = null,
    val mode: String? = null,
)

// MARK: - Bridge KYC

@Serializable
internal data class BridgeKycStartResp(
    val provider: String? = null,
    val status: String = "unverified",
    val kycUrl: String? = null,
    val tosUrl: String? = null,
    val kycLinkId: String? = null,
    val customerId: String? = null,
)

@Serializable
internal data class BridgeKycStatusResp(
    val started: Boolean = false,
    val status: String = "unverified",
    val kycStatus: String? = null,
    val tosStatus: String? = null,
    val customerId: String? = null,
    val stale: Boolean? = null,
)

/** Talise's collapsed KYC status ladder — mirrors iOS `KYCStatus`. */
internal enum class KycStatus(val raw: String, val label: String) {
    UNVERIFIED("unverified", "Not verified"),
    PENDING("pending", "In review"),
    APPROVED("approved", "Verified"),
    REJECTED("rejected", "Not approved"),
    EXPIRED("expired", "Expired");

    /** True while Bridge is still working through identity / ToS — keep polling. */
    val isInFlight: Boolean get() = this == PENDING

    companion object {
        fun from(raw: String?): KycStatus = entries.firstOrNull { it.raw == raw } ?: UNVERIFIED
    }
}

// MARK: - zkLogin signature plumbing

@Serializable
internal data class ZkMeta(val kind: String)

@Serializable
internal data class SponsorExecuteBody(
    val bytesB64: String,
    val ephemeralPubKeyB64: String,
    val maxEpoch: Int,
    val randomness: String,
    val userSignature: String,
    val meta: ZkMeta? = null,
)

@Serializable
internal data class SponsorExecuteResp(val digest: String? = null, val error: String? = null)

@Serializable
internal data class AssembleSignatureBody(
    val bytesB64: String,
    val ephemeralPubKeyB64: String,
    val maxEpoch: Int,
    val randomness: String,
    val userSignature: String,
)

@Serializable
internal data class AssembleSignatureResp(val signature: String? = null, val error: String? = null)

// MARK: - Retrofit interface

internal interface ProfileApi {
    @GET("api/referral/summary")
    suspend fun rewardsSummary(): ProfileRewardsSummary

    @POST("api/account/delete")
    suspend fun deleteAccount(@Body body: EmptyBody): ProfileOkResp

    @GET("api/me/nfts")
    suspend fun nfts(): NftsResp

    @POST("api/me/avatar")
    suspend fun setAvatar(@Body body: AvatarBody): AvatarResp

    @GET("api/me/bank")
    suspend fun bankAccounts(): List<BankAccountDTO>

    @POST("api/me/bank/link/prepare")
    suspend fun bankLinkPrepare(@Body body: BankLinkPrepareBody): BankLinkPrepareResp

    @POST("api/me/bank/link/confirm")
    suspend fun bankLinkConfirm(@Body body: BankLinkConfirmBody): BankAccountDTO

    @DELETE("api/me/bank/{id}")
    suspend fun removeBankAccount(@Path("id") id: String): ProfileOkResp

    @GET("api/username/check")
    suspend fun usernameCheck(@Query("u") u: String): UsernameCheckResp

    @POST("api/username/claim")
    suspend fun usernameClaim(@Body body: UsernameClaimBody): UsernameClaimResp

    @POST("api/kyc/bridge/start")
    suspend fun kycStart(@Body body: EmptyBody): BridgeKycStartResp

    @GET("api/kyc/bridge/status")
    suspend fun kycStatus(): BridgeKycStatusResp

    @POST("api/handle/retarget")
    suspend fun retarget(@Query("probe") probe: Int?, @Body body: EmptyBody): RetargetResp

    @POST("api/zk/sponsor-execute")
    suspend fun sponsorExecute(@Body body: SponsorExecuteBody): SponsorExecuteResp

    @POST("api/zk/assemble-signature")
    suspend fun assembleSignature(@Body body: AssembleSignatureBody): AssembleSignatureResp
}

internal val profileApi: ProfileApi by lazy { ApiClient.create(ProfileApi::class.java) }

// MARK: - HTTP error helpers (Android match for iOS `APIError.status(code, msg)`)

/** HTTP status code of a Retrofit failure, or null for transport errors. */
internal fun httpCode(t: Throwable): Int? = (t as? HttpException)?.code()

/** Server error body — the `{"error": "..."}` string when present, else the raw body. */
internal fun httpErrorMessage(t: Throwable): String? {
    val http = t as? HttpException ?: return null
    return try {
        val raw = http.response()?.errorBody()?.string()?.takeIf { it.isNotBlank() } ?: return null
        runCatching {
            ApiClient.json.parseToJsonElement(raw).jsonObject["error"]?.jsonPrimitive?.contentOrNull
        }.getOrNull() ?: raw
    } catch (_: Exception) {
        null
    }
}

/** Map config/rollout errors to reassuring copy; pass short real ones through. iOS `friendlyError`. */
internal fun friendlyBankError(code: Int?, message: String?): String {
    val lower = (message ?: "").lowercase()
    if (code == 503 || lower.contains("not configured")) {
        return "Bank linking is rolling out, check back soon."
    }
    if (code == 422) {
        return "We couldn't verify that account. Check the number and bank."
    }
    if (code == 409) {
        return "That account is already linked to your handle."
    }
    if (!message.isNullOrEmpty() && message.length <= 120 &&
        !lower.contains("<html") && !lower.contains("<!doctype")
    ) {
        return message
    }
    return "Something went wrong. Please try again."
}
