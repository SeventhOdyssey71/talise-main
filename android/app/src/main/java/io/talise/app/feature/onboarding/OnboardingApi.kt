package io.talise.app.feature.onboarding

import io.talise.app.core.net.ApiClient
import kotlinx.serialization.Serializable
import retrofit2.HttpException
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Query

/**
 * Onboarding backend surface — paths/shapes copied from iOS:
 *   • GET  /api/username/check?u=<name>  → `UsernameCheckResponse` (ClaimHandleSheet)
 *   • POST /api/username/claim {username} → `UsernameClaimResponse` (HandlePickerScreen;
 *     operator-paid `<name>.talise.sui` mint; 409 = taken)
 */
interface OnboardingApi {
    @GET("api/username/check")
    suspend fun checkUsername(@Query("u") username: String): UsernameCheckResponse

    @POST("api/username/claim")
    suspend fun claimUsername(@Body body: UsernameClaimRequest): UsernameClaimResponse
}

@Serializable
data class UsernameClaimRequest(val username: String)

/** iOS `UsernameClaimResponse` — every field optional on the wire. */
@Serializable
data class UsernameClaimResponse(
    val ok: Boolean? = null,
    val username: String? = null,
    val digest: String? = null,
    val subnameNftId: String? = null,
    val error: String? = null,
)

/** iOS `UsernameCheckResponse` for /api/username/check?u=<input>. */
@Serializable
data class UsernameCheckResponse(
    val available: Boolean = false,
    val reason: String? = null,
)

@Serializable
internal data class OnboardingApiErrorBody(
    val error: String? = null,
    val message: String? = null,
)

internal val onboardingApi: OnboardingApi by lazy { ApiClient.create(OnboardingApi::class.java) }

/**
 * Server-sent message on a non-2xx — the Android analog of iOS
 * `APIError.status(code, msg)` (the backend returns `{ "error": "..." }`).
 */
internal fun HttpException.serverMessage(): String? = try {
    val raw = response()?.errorBody()?.string()
    if (raw.isNullOrBlank()) null
    else ApiClient.json
        .decodeFromString(OnboardingApiErrorBody.serializer(), raw)
        .let { it.error ?: it.message }
} catch (_: Throwable) {
    null
}
