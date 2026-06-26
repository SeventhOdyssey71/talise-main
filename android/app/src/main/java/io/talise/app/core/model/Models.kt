package io.talise.app.core.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Wire DTOs — mirror the iOS `APIModels.swift`. Field names match the JSON the
 * shared backend returns; `@SerialName` is used where Kotlin naming differs.
 * `ignoreUnknownKeys` is set on the Json instance so additive server fields don't break decode.
 */

@Serializable
data class UserDTO(
    val id: String? = null,
    val email: String? = null,
    val name: String? = null,
    val picture: String? = null,
    @SerialName("pfpUrl") val pfpUrl: String? = null,
    val country: String? = null,
    @SerialName("suiAddress") val suiAddress: String? = null,
    @SerialName("accountType") val accountType: String? = null,
    @SerialName("businessName") val businessName: String? = null,
    @SerialName("taliseHandle") val taliseHandle: String? = null,
    @SerialName("taliseSubname") val taliseSubname: String? = null,
    val features: UserFeatures? = null,
) {
    val displayName: String get() = name ?: businessName ?: email?.substringBefore("@") ?: "You"
    val handle: String? get() = taliseSubname ?: taliseHandle
}

@Serializable
data class UserFeatures(
    val cashout: Boolean = false,
    @SerialName("scanToPay") val scanToPay: Boolean = false,
)

@Serializable
data class BalancesDTO(
    val address: String? = null,
    val usdsui: Double = 0.0,
    val sui: Double = 0.0,
    @SerialName("suiPriceUsd") val suiPriceUsd: Double = 0.0,
    @SerialName("totalUsd") val totalUsd: Double = 0.0,
)

@Serializable
data class ActivityOtherCoin(
    val coinType: String,
    val symbol: String,
    val amount: String,
    val decimals: Int,
)

@Serializable
data class OfframpInfo(
    val provider: String,
    val amountNgn: Double = 0.0,
    val bankName: String? = null,
    val accountLast4: String? = null,
    val status: String = "",
    val rate: Double = 0.0,
    val orderId: String = "",
)

@Serializable
data class TeamPayoutInfo(
    val name: String,
    val recipientCount: Int = 0,
)

@Serializable
data class ActivityEntryDTO(
    val digest: String,
    val timestampMs: Double = 0.0,
    val direction: String = "sent",
    val amountUsdsui: Double? = null,
    val amountSui: Double? = null,
    val counterparty: String? = null,
    val counterpartyName: String? = null,
    val venue: String? = null,
    val otherCoin: ActivityOtherCoin? = null,
    val roundupUsdsui: Double? = null,
    val offramp: OfframpInfo? = null,
    val team: TeamPayoutInfo? = null,
)

@Serializable
data class ActivityResponse(val entries: List<ActivityEntryDTO> = emptyList())

@Serializable
data class RecipientResolution(
    val address: String,
    val displayName: String? = null,
    val display: String? = null,
    val source: String? = null,
) {
    val label: String get() = displayName ?: display ?: address
}

// --- Earn / yield ---
@Serializable
data class YieldVenue(
    val venue: String,
    val apy: Double = 0.0,
    val supplied: Double? = null,
    val earned: Double? = null,
)

@Serializable
data class YieldComparison(
    val venues: List<YieldVenue> = emptyList(),
    val best: YieldVenue? = null,
)

// --- Payroll / teams ---
@Serializable
data class TeamMemberDTO(
    val recipient: String,
    val amount: Double? = null,
    val label: String? = null,
)

@Serializable
data class TeamDTO(
    val id: String,
    val name: String,
    val members: List<TeamMemberDTO> = emptyList(),
    val createdAt: Double? = null,
    val updatedAt: Double? = null,
    val chainObjectId: String? = null,
)

@Serializable
data class TeamsResponse(val teams: List<TeamDTO> = emptyList())

// --- Auth ---
@Serializable
data class ExchangeRequest(
    val idToken: String,
    val ephemeralPubKeyB64: String,
    val jwtRandomness: String,
    val maxEpoch: Int,
    val provider: String = "google",
)

@Serializable
data class ExchangeResponse(
    val bearer: String,
    val user: UserDTO? = null,
    val existing: Boolean = false,
)

@Serializable
data class EpochResponse(val epoch: String)

@Serializable
data class NonceRequest(
    val ephemeralPubKeyB64: String,
    val maxEpoch: Int,
    val randomness: String,
)

@Serializable
data class NonceResponse(val nonce: String)
